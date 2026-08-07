# @pixel-index/web

The gallery. Vite + React + Tailwind, matching `vendor/pixel-agents/webview-ui` exactly
so design tokens can be lifted from upstream rather than re-derived by eye.

Built as a **static SPA**: GitHub Pages serves production from `main`, Vercel builds the
same output for per-pull-request previews.

## Status

The shell (#12), the gallery/detail views (#13), and search/filter (#14) exist:
routing, the API client, loading/error/empty states, both deploy pipelines, the layout
grid and detail page, and a full filter bar with URL-shareable state. Nothing
authenticated yet, and the visual design is still placeholder Tailwind, not the
office/docs-site look.

| Issue | Scope | State |
|---|---|---|
| [#12](https://github.com/NNTin/pixel-index/issues/12) | SPA shell, API client, Pages deploy, Vercel PR previews | done |
| [#13](https://github.com/NNTin/pixel-index/issues/13) | gallery, layout detail, preview, download | done |
| [#14](https://github.com/NNTin/pixel-index/issues/14) | search and filter | done |
| [#15](https://github.com/NNTin/pixel-index/issues/15) | login, submit, my layouts, moderation console, report | |
| [#16](https://github.com/NNTin/pixel-index/issues/16) | visual alignment with the office and docs site | |

```
src/main.tsx                     mounts <App>, wraps it in BrowserRouter with a basename
                                  matching vite.config.ts's `base`
src/App.tsx                      routes: /, /layouts/:slug, catch-all -> NotFound
src/components/Layout.tsx        header + <Outlet/>
src/components/LayoutCard.tsx    the gallery grid's card: preview, title, author, facts
src/components/PreviewImage.tsx  checkered backdrop, image-rendering:pixelated,
                                  missing-preview placeholder (carried over from v1)
src/components/FactsRow.tsx      "25×22 · 59 furniture · 4 areas · 2 pets" — zero-valued
                                  facts omitted, carried over from v1
src/components/AuthorLink.tsx    "clicking an author name filters to their layouts" — #14
src/components/FilterBar.tsx     search, sort, size/pets/furniture filters, the tag
                                  multi-select (populated from GET /api/v1/tags),
                                  "N active, clear filters"
src/api/client.ts                fetch wrapper for the #6 public API; VITE_API_BASE_URL,
                                  never a hardcoded hostname; apiUrl() resolves the
                                  API-relative preview/thumbnail/download paths
src/api/types.ts                 hand-written against services/api/src/layouts/schemas.ts
src/api/useApi.ts                loading/error/ready as data, for every screen that calls
                                  the API
src/routes/filters.ts            the URL <-> Filters <-> #6 API params translation — the
                                  URL is the shareable, human-readable form; #6's own
                                  min/max params are what's actually sent
src/routes/Home.tsx              the gallery: FilterBar wired to useSearchParams, keyset
                                  pagination via #6's cursor, "Load more", a filter-aware
                                  empty state
src/routes/LayoutDetailPage.tsx  full metadata, download, the layoutRevision-ahead-of-pin
                                  warning, clickable tags/author (into #14's filters)
vite.config.ts                   base path config + the GitHub Pages 404.html generator
index.html                       the matching restore-path script (see the two together)
```

### Filters live in the URL, not component state

`routes/filters.ts` is the one place that translates between three shapes: the URL's
query string (`?size=large&tags=cosy,small` — readable, shareable, what a pasted link
looks like), the `Filters` object components work with, and #6's own query parameters
(`minCols`/`maxCols`/`minRows`/`maxRows`, `minPets`/`maxPets`, …). `Home.tsx` derives
`filters` from `useSearchParams()` on every render rather than holding its own copy in
`useState` — the URL *is* the state, so the browser back button, a bookmark, and a
pasted link all just work, with no separate synchronization code to keep them aligned.

The size bucket (small/up to 15×15, medium/16–30, large/31+) is a client-side
approximation, not a real backend concept — #6 only offers independent min/max on `cols`
and `rows`, not on `cols × rows`, so a bucket applies the same range to both axes, ANDed.
A long, thin layout (say 8×40) falls outside every bucket. Documented as a known
imprecision in `filters.ts` rather than worked around, since a real fix is a computed
tile-count column, not a client heuristic.

### The tag picker never offers a filter guaranteed to return nothing

`GET /api/v1/tags` (added alongside this issue, `services/api/src/layouts/query.ts`)
returns only tags actually used by a **public** layout, with a count, most-used first.
`FilterBar` hides the tag picker entirely when that list is empty — on a fresh install
with no tags yet, rather than rendering a picker with nothing in it, which the issue's
own notes flagged as a real risk ("tags is currently empty on all four seed layouts").

## Constraints that come with static hosting

- **No secrets, ever.** Anything in this bundle is public. The Discord client secret and
  every authorization decision live in `services/api`.
- **No hostnames in source.** The API base URL is `VITE_API_BASE_URL`, build-time config
  with a documented local-dev default (`.env.example`) — never baked in for production,
  so self-hosters never inherit an owner's own deployment.
- **Deep links need help.** Pages has no rewrite rules. Chosen: the `404.html` fallback
  (`vite.config.ts`'s `ghPagesSpaFallback` plugin + `index.html`'s restore script,
  https://github.com/rafgraph/spa-github-pages), not hash routing — clean URLs
  (`/layouts/some-office`, not `/#/layouts/some-office`) matter more here than avoiding
  one redirect hop on an already-rare hard-refresh-on-a-deep-link case. Vercel needs
  none of this: it has real rewrite rules (`vercel.json`), so the plugin is a no-op there.
- **The site is only as available as the API.** Loading, empty and error states are
  first-class (`api/useApi.ts`), which the v1 static site never had to consider — an
  unreachable API renders a message, not a blank page.

## Deploys

- **Production**: `.github/workflows/pages.yml` builds this workspace on every push to
  `main` and deploys it to GitHub Pages. `VITE_BASE_PATH` is set automatically to
  `/<repo-name>/` (a GitHub Pages project site's URL shape); `VITE_API_BASE_URL` comes
  from the repo's `PRODUCTION_API_BASE_URL` Actions variable — unset until the API has a
  real production host, in which case the deployed site's calls fail with a clear
  "unreachable" message rather than trying `localhost`.
- **PR previews**: a Vercel project with Root Directory `apps/web` (`vercel.json` handles
  installing/building from the monorepo root). Every PR gets a preview URL commented by
  Vercel's own GitHub integration — no custom GitHub Action or token needed for this
  part. `VITE_BASE_PATH` is unset (Vercel serves from the domain root); point
  `VITE_API_BASE_URL` at a non-production API via a Vercel Environment Variable if/when
  one exists.

## Worth keeping from v1

The checkered `repeating-conic-gradient` backdrop behind previews and
`image-rendering: pixelated`. Layouts are transparent outside the floor, so without the
backdrop they dissolve into the card.

<!-- trigger a real Vercel preview build for #12 -->
