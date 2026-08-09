# Contributing a layout

## Publish through the site (primary path)

1. Design your office in Pixel Agents, then **Layout → Export** to get a `layout.json`.
2. Open the site, log in with Discord, and go to **Submit**.
3. Paste or upload the `layout.json`, fill in a title, description and tags, then
   **Check preview** — you'll see your office rendered exactly as everyone else will,
   before anyone else can. Read [CONTENT_POLICY.md](CONTENT_POLICY.md) first; the submit
   page links it for the same reason.
4. **Publish.** It's public immediately — this index is post-moderated, not
   reviewed-before-publish (see the policy for what that means and how to report
   something that shouldn't be there).

Once published, it's yours: **My layouts** lets you edit the title/description/tags,
replace the `layout.json` (if you re-export from a newer Pixel Agents, say), or delete
it, at any time — no pull request needed for any of that either.

### What gets checked, and why

- `cols × rows` matches the number of tiles.
- Every furniture id exists in the pinned Pixel Agents — an export from a newer version
  can reference furniture this index cannot yet draw.
- `layoutRevision` is not below the bundled default's. Pixel Agents **discards a stored
  layout whose `layoutRevision` is lower than the bundled default's** and resets it to
  the default office (`server/src/layoutPersistence.ts`) — publishing one that would be
  silently wiped on a user's next start helps nobody, so this is rejected with an
  explanation of why, not just a bare error.

### Do not edit `layout.json` by hand

It is the artifact people download and import, byte-for-byte. Keep it exactly as Pixel
Agents exported it; everything descriptive (title, description, tags) travels alongside
it, never inside it.

## Proposing a seed layout (pull request)

The handful of layouts the index ships with by default — so a fresh install is never an
empty page — are git-versioned in `seed/` and loaded into the database on first boot
([#18](https://github.com/NNTin/pixel-index/issues/18)), rather than living only in the
database. Proposing a *new* seed layout, or a fix to an existing one, is still a pull
request:

```bash
git submodule update --init --recursive
npm ci
npm run validate
```

CI runs the same validation the live submit flow does, so a seed layout can never be one
the site would itself reject. This path is specifically for the curated starter set —
publishing your own layout for the community index is the web flow above.

## Editing the docs

Several documents draw their diagrams with [mermaid](https://mermaid.js.org/), which
GitHub renders inline from a ` ```mermaid ` code block. A diagram with a syntax error
does not fail anything — it just renders as a red error box on github.com, which nobody
notices until a reader hits it. So CI parses every diagram in every tracked markdown
file, and you can run the same check locally:

```bash
npm run check:mermaid                       # everything git tracks
node tools/check-mermaid.mjs docs/FOO.md    # just one file, while you iterate
```

It reports every bad diagram in one pass, with the line to jump to. It parses rather
than renders, so it needs no browser and takes about a second; see
[`tools/check-mermaid.mjs`](tools/check-mermaid.mjs) for why, and for how to move the
pinned mermaid version when GitHub upgrades theirs.

Two things worth knowing when you write the markdown itself:

- The check reads the first word of the info string, so ` ```mermaid ` and
  ` ```mermaid title="x" ` are both diagrams.
- To *show* a mermaid block as an example rather than have it rendered and checked,
  wrap it in a longer fence (four or more backticks, or `~~~`). Anything inside that
  outer fence is left alone.

## Editing the code

Every workspace is held to the same TypeScript strictness contract
([`tsconfig.strict.json`](tsconfig.strict.json)) and linted by one type-aware ESLint
config at the repo root ([`eslint.config.js`](eslint.config.js)). Both run in CI, and
both run locally:

```bash
npm run typecheck    # every workspace
npm run lint         # every workspace, plus tools/
npm test             # tools/, then every workspace's own suite
```

`npm run lint` is type-aware — the rules worth having here are the `no-unsafe-*` family,
which need real types to say anything — so it costs about as much as a typecheck, not as
much as a formatter. It needs `vendor/pixel-agents` checked out, because `apps/web`
compiles some of the upstream's own sources.

Two conventions the config makes load-bearing rather than decorative:

- A leading underscore (`_request`, `_canvasBox`) means "deliberately unused". Anything
  else unused is an error.
- A module that exports a React component exports *only* components — the provider and
  its hook live in separate files (`AuthProvider.tsx` / `authState.ts`). That is what
  lets Vite hot-replace a component in place instead of reloading the page, which for
  this app also means not having to log in again after every edit.

Where a rule is switched off, or a suppression is narrowed to one line, the reason is
written next to it. If you need a new exception, write the reason too — a bare
`eslint-disable` is not reviewable.
