# Preview deployments

Every pull request gets a Vercel preview of `apps/web`. Almost all of them behave exactly
like production: the same static site, pointed at the same live API.

**One kind does not.** The weekly vendor-update PR shows preview images the production API
*cannot produce*, behind a banner saying so. This document explains why that exception
exists, when it applies, and what each environment actually serves — because "the preview
shows different pictures than production" is alarming if you don't know it's deliberate.

See [`deployment.md`](deployment.md) for the variables and secrets behind all of this, and
[`ARCHITECTURE.md`](ARCHITECTURE.md) for why there are two origins in the first place.

---

## The thing every preview shares

The site is static. It holds no layouts and renders no pictures; it calls
`PRODUCTION_API_BASE_URL` for both. A preview build of a branch therefore shows **your
branch's UI against production's data** — which is what makes previews useful, and what
creates the one problem below.

Preview images come from the API's renderer, and that renderer draws with **the Pixel
Agents commit pinned in the image the API was built from**. Not the pin on your branch.
That distinction is invisible and harmless for every ordinary PR, because ordinary PRs
don't change the pin.

---

## The vendor-update pipeline

`vendor-update.yml` moves `vendor/pixel-agents` and proves the move is safe.

```mermaid
flowchart TD
    T(["weekly cron<br/>or workflow_dispatch"]) --> A

    A["A. vendor-update.yml<br/>git submodule update --remote<br/>fixed branch chore/vendor-pixel-agents<br/>— reuses the open PR if there is one"]

    A -->|"SHA unchanged"| STOP(["no PR, exit 0"])
    A -->|"SHA moved"| C

    C["C. differential harness<br/>render every layout twice:<br/>OLD pin, then NEW pin"]

    SEED["seed/ — 4 layouts in the repo<br/>hermetic, always runs"] --> C
    LIVE["B. /api/v1/export/layouts.ndjson<br/>every public layout, from the live API"] --> C

    C -->|"PNGs from both pins"| E
    C -->|"verdicts"| D

    E["E. publish candidate renders<br/>PNGs → orphan branch vendor-previews<br/>manifest.json → the PR branch"]
    E --> D

    D["D. report + verdict<br/>only layouts that passed on OLD<br/>and fail on NEW count as regressions"]

    D --> PR["PR body · job summary · check status"]
    PR --> H(["a human reads it and merges"])
```

The gate renders everything **twice** so it can answer *"did this update break it?"* rather
than *"is it broken?"* — an index of real submissions always contains a few already-broken
layouts, and reporting those would leave the check permanently red for reasons merging
cannot fix.

Step **E** is what this document is about. Those candidate PNGs already exist — the gate
had to draw them to reach a verdict — so publishing them costs nothing and solves a
problem that would otherwise make the PR unreviewable.

---

## The problem step E solves

A vendor-update PR changes which Pixel Agents draws the office. Its preview calls the
production API, which is still on the **old** pin. So without intervention:

> The one view where seeing the change matters is the one view that shows the vendor you
> are replacing.

You would be reviewing a pin bump by looking at pictures drawn by the pin it replaces.

```mermaid
flowchart LR
    subgraph noOverride ["Without the override"]
        direction LR
        W1["vendor PR preview"] -->|"thumbnail request"| W2["production API"]
        W2 -->|"renders with<br/>OLD pin 9794e07"| W3["the pictures<br/>you are replacing"]
    end

    subgraph yesOverride ["With it"]
        direction LR
        V1["vendor PR preview"] -->|"reads<br/>vendor-preview/manifest.json"| V2["candidate renders<br/>on vendor-previews branch"]
        V2 -->|"drawn with<br/>NEW pin 0f823e2"| V3["what the update<br/>actually looks like"]
    end
```

---

## Where the pixels come from: two producers

This is the part that surprises people, so it is worth stating flatly:

- **The old pin's images are rendered by the API**, on demand, per request.
- **The new pin's images are rendered by the CI pipeline**, once, minutes earlier, and
  served as static files from a git branch.

The API never draws the new pin. It cannot — the deployed renderer only has the commit
baked into the image it was built from. That is precisely why the candidate renders have to
be produced somewhere else.

```mermaid
flowchart TB
    subgraph oldPin ["OLD pin — what production serves, always"]
        direction TB
        O1["layout JSON in Postgres"] --> O2["API<br/>GET /api/v1/layouts/:slug/thumbnail.png"]
        O2 --> O3["renderer container<br/>Vite + Chromium<br/>pin baked into the image"]
        O3 --> O4["PNG rendered on request<br/>content-addressed cache"]
    end

    subgraph newPin ["NEW pin — only on a vendor-update PR"]
        direction TB
        N1["layout JSON<br/>GET /api/v1/export/layouts.ndjson"] --> N2["GitHub Actions runner<br/>Vite + Chromium<br/>candidate pin, checked out fresh"]
        N2 --> N3["PNG written to gate/png/"]
        N3 --> N4["force-pushed to the<br/>orphan branch vendor-previews"]
        N4 --> N5["static file on<br/>raw.githubusercontent.com"]
    end
```

Note where the two pipelines *do* meet: the API supplies the layout JSON to both. It acts
as the **data source** for the CI render, never as its renderer. Rendering and data are
split, which is what lets the gate draw your real layouts against a pin your API has never
seen.

### The browser just picks a URL

Nothing clever happens client-side. `previewSource.resolve(slug)` returns one of three
answers and the image element points wherever it says.

```mermaid
flowchart LR
    IMG["an image on a layout card"] --> R{"previewSource.resolve(slug)"}
    R -->|"kind: api"| A["PRODUCTION_API_BASE_URL<br/>/api/v1/layouts/:slug/thumbnail.png<br/>rendered on demand — OLD pin"]
    R -->|"kind: candidate"| C["raw.githubusercontent.com<br/>/vendor-previews/SHA/:slug.png<br/>rendered in CI — NEW pin"]
    R -->|"kind: failed"| F["a placeholder — the new pin<br/>cannot draw this layout at all"]
```

### It is the same renderer, not a lookalike

`services/renderer/src/harness/run.ts` imports `startDevServer` and `Renderer` from
`services/renderer/src/` directly. There is no second implementation to drift. The gate has
to measure what production does, and the only honest way to do that is to run production's
code against a different pin.

Measured on one layout, from three independent machines:

| Producer | Pin | Bytes | SHA-256 |
|---|---|---|---|
| CI (GitHub Actions) | `0f823e2` | 15009 | `f1d320ffae60…` |
| The deployed renderer | `9794e07` | 15009 | `f1d320ffae60…` |
| A developer laptop | `9794e07` | 15009 | `f1d320ffae60…` |

Byte-identical. Two things follow. Renders are **deterministic** — the same layout and the
same pin give the same PNG anywhere — which is what makes comparing PNG hashes a usable
signal for *"this layout renders differently now"*. And this particular bump changed nothing
visually, which is why its report listed no visually-changed layouts.

Do not read that last part as the general case. When upstream changes sprites, the CI image
and the API image differ — that is the entire point, and it is what the banner is warning
you about.

### Two consequences of being static

**They are a snapshot, not live.** The candidate PNGs are frozen at the moment the workflow
ran. A layout submitted afterwards is not in the manifest and falls through to the API
(`kind: 'api'`) — unmeasured, not broken. Re-running the workflow refreshes the set.

**They do not accumulate.** `vendor-previews` is force-pushed as a single commit each run,
so the previous set becomes unreachable and is eventually collected. Images on an older
vendor PR's preview will 404 once a newer run lands. That is deliberate: a weekly job that
kept every render would grow the repository without bound.

---

## Decision: publish only what changed, capped at 50

This is the rule that keeps the whole mechanism from becoming a problem as the index grows,
so it is worth stating as a decision rather than leaving it to be inferred from the code.

### What is published

| Layout renders… | Published? | What the page shows |
|---|---|---|
| **the same** on both pins | **No** | The API's image — which *is* the candidate's render |
| **differently** | Yes, up to the cap | The candidate's PNG |
| **not at all** on the candidate | Yes — a marker, no image | A "cannot be drawn" placeholder |
| beyond the cap | No | The API's image, with the banner saying how many were left out |

### Why unchanged layouts are not published

Because publishing them would be sending a copy of a file the page can already fetch.

Renders are deterministic — the same layout on the same pin produces the same PNG on any
machine, [measured across three](#it-is-the-same-renderer-not-a-lookalike). So when the
candidate draws a layout exactly as the baseline did, the image the API is already serving
**is** the candidate's render. Showing it is not a compromise or a fallback; it is the same
bytes.

Without this rule the workflow republished the entire index on every bump — at 1,000
layouts, ~15 MB weekly to convey, in the normal case, nothing. The last real bump rendered
4 layouts, changed 0, and published 4 images that were byte-identical to what the API was
already serving.

### Why there is a cap, and why it is 50

Upstream changing a palette or a shared sprite alters every layout at once. **The 51st
example of the same recoloured chair teaches a reviewer nothing the 5th did.** The cap
bounds the published set by *what is worth looking at* rather than by how big the index
happens to be — so the payload is the same at 100 layouts and at 100,000, and this never
needs revisiting.

Failures are filled in first: a layout the candidate cannot draw at all is the more urgent
thing to see, and it costs no bytes because there is no image, only a marker.

### The counts are always the truth

`layouts` in the manifest is a *sample*; `changed`, `failed` and `shown` describe the whole
population. The banner uses them, so a truncated set announces itself:

> **800 layouts** render differently under candidate Pixel Agents 0f823e2 — too many to
> show. A sample of 50 is displayed here; the rest keep the API's current images.

A sample that does not admit to being one invites the reader to conclude the other 750 were
fine. The gate's report and check status count all 800 regardless — the cap governs how many
*pictures* are published, never what the verdict is measured over.

### What this bounds

| | Before | After |
|---|---|---|
| Images per typical bump | = index size | **0** |
| Images per sprite change | = index size | **≤ 50** |
| Payload at 10,000 layouts | ~150 MB | **≤ 750 KB** |
| Requests to `raw.githubusercontent.com` | 100s per *visitor* | ~50 per *reviewer* |
| Binaries committed to `main` | none | none |

Nothing scales with the index, which is why hosting was left alone: at this size neither
[GitHub's raw rate limits](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)
nor [Vercel's deployment limits](https://vercel.com/docs/limits) are reachable. Bundling the
PNGs into the web build was considered and rejected — `add-paths` would commit them, so they
would merge into `main` and sit in history permanently, trading a fixable problem for an
unfixable one.

---

## When the banner appears

The wording tracks what was actually published, because only *some* previews are candidate
renders — most weeks, none are. There are three shapes:

> Candidate Pixel Agents 0f823e2 draws every layout exactly as the API's 9794e07 does —
> **nothing changed visually**, so every preview here is the API's own image.

> **3 layouts** render differently under candidate Pixel Agents 0f823e2 and are shown here.
> The API is still on 9794e07; every other preview is its image, which is byte-identical to
> what the candidate draws.

> **800 layouts** render differently under candidate Pixel Agents 0f823e2 — too many to
> show. A sample of 50 is displayed here; the rest keep the API's current images.

Any of them gains a sentence when layouts fail outright:

> **2 layouts** cannot be drawn by the candidate at all and are marked rather than shown
> with an old image.

The first shape matters more than it looks. Without it, a reviewer seeing ordinary
thumbnails cannot tell "the mechanism ran and found nothing" from "the mechanism is broken"
— a confusion this project has already hit once for real.

It is not dismissible and not optional. Silently swapping in different pictures would only
be lying in a new direction; the banner is what makes the swap honest.

Two conditions must both hold. The logic lives in
[`apps/web/src/api/previewSource.ts`](../apps/web/src/api/previewSource.ts).

```mermaid
flowchart TD
    S(["page loads"]) --> M{"GET vendor-preview/<br/>manifest.json"}
    M -->|"404 — no manifest"| OFF(["no banner<br/>images come from the API"])
    M -->|"200"| CMP{"can we prove the API is<br/>on a different pin?"}

    CMP -->|"both report a commit"| CC{"commits differ?"}
    CMP -->|"API reports commit: null,<br/>versions comparable"| VV{"versions differ?"}
    CMP -->|"nothing comparable"| OFF

    CC -->|"yes"| ON
    CC -->|"no — API already on the candidate"| OFF
    VV -->|"yes"| ON
    VV -->|"no"| OFF

    ON(["banner shows<br/>thumbnails swap to candidate renders"])
```

Three properties worth knowing:

- **Commit first, version only as a fallback.** The pin routinely sits several commits past
  a tag, so two different pins often share a version — comparing on version alone would
  disarm the override on a bump that never changed the version number.
- **It fails safe.** If nothing can be compared, the override stays *off*. A live image that
  might be slightly stale beats a static one that is certainly stale.
- **It disarms itself.** The manifest is committed to the PR branch, so it *merges* along
  with the pin. Once the API is redeployed onto that same commit, the two agree and the
  override stops applying — no cleanup commit anyone has to remember.

### What a layout that fails on the candidate shows

A placeholder — *"does not render under the candidate Pixel Agents"* — never its old image.
Falling back to the API's picture for a layout the new pin cannot draw is precisely the
lie this whole mechanism exists to prevent. A layout submitted *after* the gate ran is not
in the manifest at all and simply falls through to the API: unmeasured, not broken.

---

## Environment by environment

| Environment | Built from | Manifest present? | Banner | Preview images come from |
|---|---|---|---|---|
| **Vendor-update PR preview** | `chore/vendor-pixel-agents` | **Yes** — committed by the workflow | **Yes** | The candidate renders on the `vendor-previews` branch |
| Any other PR preview | that PR's branch | No — 404 | No | The production API |
| Vercel production | `main` | No¹ | No | The production API |
| GitHub Pages | `main` | No¹ | No | The production API |
| Local `npm run dev` | your working tree | No, unless you made one | No | Whatever `VITE_API_BASE_URL` points at |

¹ Until a vendor PR merges — see the next section.

The 404 is the overwhelmingly common case, so it is cheap and completely silent: one small
failed request per page load, no `/api/v1/meta` call, nothing logged, no behaviour change.

---

## The exception: the window between merge and redeploy

**The banner is not strictly vendor-PR-only.** The manifest is committed to the PR branch,
which means merging the vendor PR puts it on `main` — and therefore into the next
production and Pages build.

For the window between **merging the PR** and **redeploying the API**, production satisfies
both conditions: the manifest is present, and the API is demonstrably still on the old pin.
So production shows the banner and the candidate renders too.

```mermaid
flowchart LR
    P1["before merge<br/>manifest not on main"] -->|"merge the PR"| P2["after merge,<br/>before API redeploy"]
    P2 -->|"redeploy the API"| P3["after redeploy"]

    P1 --- N1(["no banner<br/>API images"])
    P2 --- N2(["banner shows<br/>candidate renders"])
    P3 --- N3(["no banner<br/>API images"])
```

That is the mechanism working as designed rather than a bug — during that window the site's
pin genuinely has moved and the API's has not, and saying so is more honest than quietly
serving images from an upstream the repo no longer pins. But it *is* visitor-facing text on
a public gallery, so **keep the window short: redeploy the API promptly after merging a
vendor bump.** Doing so is required anyway — that is what puts the new pin into the
renderer.

---

## Reviewing a vendor-update PR

The check being green means *"nothing that rendered before fails now"*. It does **not** mean
the pixels are still right — upstream can change sprite art or z-ordering and every layout
will still validate and render while looking wrong. Only a person looking at the preview
can judge that, which is the entire reason step E exists.

So on the preview:

1. **Confirm the banner is there.** No banner on a vendor PR means the override did not
   engage and you are looking at the old pin's images — the PR body says why when that
   happens.
2. **Look at the offices, not the layout count.** Sprite changes, wall autotiling, carpet
   edges, z-order. The report already tells you which layouts render *differently* while
   still rendering — that list is the shortlist worth opening.
3. **Open anything marked as failing.** Those are named in the PR body with their issue
   code, e.g. `layout.furniture.unknown` when upstream removed a furniture id.

Then decide: merge, or moderate the affected layouts first. Merging is deliberately a human
decision — nothing here auto-merges.
