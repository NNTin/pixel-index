# @pixel-index/web

The gallery. Vite + React + Tailwind, matching `vendor/pixel-agents/webview-ui` exactly
so design tokens can be lifted from upstream rather than re-derived by eye.

Built as a **static SPA**: GitHub Pages serves production from `main`, Vercel builds the
same output for per-pull-request previews.

## Status

The shell (#12), gallery/detail (#13), search/filter (#14), the authenticated flows
(#15), visual design (#16), and live layout detail (#27) all exist: login with Discord, submit with a real
pre-publish preview, manage your own layouts, a moderation console, an admin console —
styled with tokens lifted from the office webview and the docs site, not invented.

| Issue | Scope | State |
|---|---|---|
| [#12](https://github.com/pixel-agents-hq/pixel-index/issues/12) | SPA shell, API client, Pages deploy, Vercel PR previews | done |
| [#13](https://github.com/pixel-agents-hq/pixel-index/issues/13) | gallery, layout detail, preview, download | done |
| [#14](https://github.com/pixel-agents-hq/pixel-index/issues/14) | search and filter | done |
| [#15](https://github.com/pixel-agents-hq/pixel-index/issues/15) | login, submit, my layouts, moderation console, admin | done |
| [#16](https://github.com/pixel-agents-hq/pixel-index/issues/16) | visual alignment with the office and docs site | done |
| [#27](https://github.com/pixel-agents-hq/pixel-index/issues/27) | live office, mock agents, formatted/copyable layout.json | done |
| [#32](https://github.com/pixel-agents-hq/pixel-index/issues/32) | public `/developer` page: reads `GET /openapi.json` itself, links the API's own Swagger UI, third-party integration pitch | done |

```text
src/main.tsx                     mounts <App>, wrapped in BrowserRouter + ThemeProvider +
                                  AuthProvider
src/App.tsx                      routes, public /authors/:id and authenticated dashboard pages
src/index.css                    design tokens (#16) — see below
src/theme/ThemeProvider.tsx      light/dark toggle, persisted to localStorage
src/theme/themeState.ts          the theme context and useTheme(), apart from the provider
                                  so the provider module hot-reloads in place (#44)
src/components/Layout.tsx        header, role-aware nav (login/logout, submit, my layouts,
                                  moderation, admin — a convenience, never the real gate)
src/components/RequireAuth.tsx   client-side route gate: "log in" / "moderators only" —
                                  UX only, the API is what actually enforces a role
src/components/LayoutCard.tsx    the gallery grid's card: preview, title, author, facts
src/components/PreviewImage.tsx  solid bg-canvas backdrop, image-rendering:pixelated,
                                  missing-preview placeholder
src/components/LiveOfficePreview.tsx
                                  persisted live/thumbnail toggle + mock-agent controls
src/components/LayoutJsonPanel.tsx
                                  auto-formatted download source, copy + download
src/components/FactsRow.tsx      renders "25×22 · 59 furniture · 4 areas · 2 pets"
src/components/facts.ts          factsFor(): builds those strings, zero-valued facts
                                  omitted, carried over from v1
src/components/AuthorLink.tsx    linked authors open their public profile and layouts
src/components/FilterBar.tsx     search, sort, size/pets/furniture filters, the tag
                                  multi-select (populated from GET /api/v1/tags),
                                  "N active, clear filters"
src/api/client.ts                apiRequest() — the one fetch wrapper every other api/*
                                  client builds on; VITE_API_BASE_URL, never a hardcoded
                                  hostname; apiUrl() resolves API-relative asset paths
src/api/authClient.ts            the OAuth code exchange, refresh, logout, /me
src/api/manageClient.ts          submit, preview-check, my-layouts CRUD (#9/#15)
src/api/moderationClient.ts      moderation browse + read-only admin user directory
src/api/types.ts                 hand-written against services/api/src/layouts/schemas.ts
src/api/useApi.ts                loading/error/ready as data, for every screen that calls
                                  the API
src/auth/AuthProvider.tsx        the session state machine — see below
src/auth/authState.ts            the auth context and useAuth(), split out for the same
                                  reason as themeState.ts
src/auth/storage.ts              only the refresh token is persisted; see docs/ARCHITECTURE.md
src/routes/filters.ts            the URL <-> Filters <-> #6 API params translation — the
                                  URL is the shareable, human-readable form; #6's own
                                  min/max params are what's actually sent
src/routes/Home.tsx              the gallery: FilterBar wired to useSearchParams, keyset
                                  pagination via #6's cursor, "Load more", a filter-aware
                                  empty state
src/routes/LayoutDetailPage.tsx  live/static office, formatted layout.json, full metadata,
                                  revision warning, clickable tags/author
src/routes/AuthorPage.tsx        public author identity and all of their public layouts
src/live-office/                isolated iframe entry: thin wrapper around the pinned
                                  OfficeState/OfficeCanvas/ToolOverlay renderer
build/liveOfficeAssets.ts       build-time upstream sprite decode, content-addressed by pin
e2e/live-preview.mjs            production-build Chromium guard for upstream pin changes
src/routes/SubmitPage.tsx        paste/upload layout.json, "Check preview" before "Publish"
src/routes/MyLayoutsPage.tsx     list/edit/replace/delete what you own, visibility + reason
src/routes/ModerationPage.tsx    every layout, any visibility; hide/remove/restore with a reason
src/routes/AdminPage.tsx         read-only users/capabilities/layout-count directory
src/routes/DeveloperPage.tsx     public, unauthenticated: GET /'s version/commit/repo
                                  link, plus a reference generated by reading GET
                                  /openapi.json directly (#32) — not an embed of the API's
                                  own Swagger UI, which stays linked as "Interactive docs"
src/api/openapi.ts               loose OpenAPI-document types + describeSchema()/
                                  bodyFields() the DeveloperPage reference renders from
vite.config.ts                   base path, multi-page live-office build + Pages fallback
index.html                       the matching restore-path script (see the two together)
```

### The session: the bearer-token design, implemented

`auth/AuthProvider.tsx` is the state machine the bearer-token design (see
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#how-they-talk-to-each-other) for why
it's a bearer token and not a cookie) turns into — worth reading alongside that doc, not
instead of it. On mount: if the URL has a `#pixelIndexLoginCode=...` fragment (the redirect back
from Discord landed here), it's exchanged immediately and cleared from the address bar
before the app ever renders with it visible; otherwise a stored refresh token (if any)
is used to restore a session via `/auth/refresh` then `/me`. The access token lives in
React state only — memory, never `localStorage` — while the refresh token is persisted
(`auth/storage.ts`) so a page reload doesn't force a full Discord round-trip. A timer
proactively rotates the access token about a minute before it expires; any refresh
failure (reuse detected or expired) clears the session rather than retrying. While the
page is visible, `/me` is also polled at the Discord capability-cache interval and on
window focus so a Discord role or membership change reaches navigation promptly.

`RequireAuth` (and the nav links it mirrors) is UX, not authorization: every page it
gates makes the exact same API calls a logged-out `curl` could make, and gets the exact
same 401/403 back. Hiding a "Moderation" link from a normal user makes the product
legible; it does nothing for security, which is the API's job alone.

### A real preflight bug this found

Adding `PATCH`/`PUT`/`DELETE` calls from the browser (edit, replace, delete, moderate,
layout moderation) surfaced a live CORS bug in `services/api`: without an explicit `methods`
list, `@fastify/cors` derived a preflight's `Access-Control-Allow-Methods` header from
route introspection that only ever produced `GET, HEAD, POST` — every one of #15's write
calls was silently blocked by the browser before it reached the server. Fixed in
`services/api/src/server.ts` with an explicit, path-independent methods list; see that
file's own comment and `server.test.ts`'s regression test for the full story. Caught by
the live Playwright pass against the real Docker stack (see below), not by the unit
suite — a route existing in Fastify and a route being *reachable from a browser* are
different claims, and only the second one is what a real user experiences.

### Filters live in the URL, not component state

`routes/filters.ts` is the one place that translates between three shapes: the URL's
query string (`?minSize=100&tags=cosy,small` — readable, shareable, what a pasted link
looks like), the `Filters` object components work with, and #6's own query parameters
(`minCols`/`maxCols`/`minRows`/`maxRows`, `minSize`/`maxSize`, `minPets`/`maxPets`, …).
`Home.tsx` derives `filters` from `useSearchParams()` on every render rather than holding
its own copy in `useState` — the URL *is* the state, so the browser back button, a
bookmark, and a pasted link all just work, with no separate synchronization code to keep
them aligned.

**Size is filtered by tile count, not by cols/rows independently** (#24).
An earlier version offered a small/medium/large bucket that applied the same range to
both axes, ANDed — a long, thin layout (say 8×40, 320 tiles) fell outside every bucket
despite being a perfectly reasonable size. `minSize`/`maxSize` filter on the product
instead, computed server-side in `query.ts`.

That product is `visibleCols * visibleRows` — the *occupied footprint* — not
`cols * rows`, the declared canvas (#55). `cols`/`rows` is a fixed allocation shared
across many layouts (furniture placement needs a stable canvas to be absolute against),
so three seed layouts can — and did — declare the identical 21×22 canvas while looking
nothing alike. `visibleCols`/`visibleRows` is the bounding box of every non-VOID tile,
computed once in `@pixel-index/layout-core`'s `layoutStats()` and denormalised onto the
row exactly like `seats` is; it is what `facts.ts` displays, what `largest` sorts by,
and what `minSize`/`maxSize` filters on.

### The tag picker never offers a filter guaranteed to return nothing

`GET /api/v1/tags` (added alongside this issue, `services/api/src/layouts/query.ts`)
returns only tags actually used by a **public** layout, with a count, most-used first.
`FilterBar` hides the tag picker entirely when that list is empty — on a fresh install
with no tags yet, rather than rendering a picker with nothing in it, which the issue's
own notes flagged as a real risk ("tags is currently empty on all four seed layouts").

### No "report" control

\#15's original scope included a report button on every layout. #10 (moderation) had
already dropped report intake entirely before it was built — no `POST /report`, no
queue, see [its comment thread](https://github.com/pixel-agents-hq/pixel-index/issues/10) — so
there is nothing for a report button to call. `docs/CONTENT_POLICY.md` (#11) documents the
actual path: contact a moderator directly. See the
[#15 comment thread](https://github.com/pixel-agents-hq/pixel-index/issues/15) for the two backend
additions this did need (`GET /moderation/layouts`, `GET /users?q=`) that #10/#9
deliberately deferred rather than built speculatively.

## Constraints that come with static hosting

- **No secrets, ever.** Anything in this bundle is public. The Discord client secret and
  every authorization decision live in `services/api`.
- **No hostnames in source.** The API base URL is `VITE_API_BASE_URL`, build-time config
  with a documented local-dev default (`.env.example`) — never baked in for production,
  so self-hosters never inherit an owner's own deployment.
- **Deep links need help.** Pages has no rewrite rules. Chosen: the `404.html` fallback
  (`vite.config.ts`'s `ghPagesSpaFallback` plugin + `index.html`'s restore script,
  <https://github.com/rafgraph/spa-github-pages>), not hash routing — clean URLs
  (`/layouts/some-office`, not `/#/layouts/some-office`) matter more here than avoiding
  one redirect hop on an already-rare hard-refresh-on-a-deep-link case. Vercel needs
  none of this: it has real rewrite rules (`vercel.json`), so the plugin is a no-op there.
- **The site is only as available as the API.** Loading, empty and error states are
  first-class (`api/useApi.ts`), which the v1 static site never had to consider — an
  unreachable API renders a message, not a blank page.
- **The live office is build-time pinned.** It is not an iframe to an external service and
  it never contacts the internal renderer. Vite compiles selected Pixel Agents modules and
  decodes its sprites into immutable JSON sidecars keyed by `vendor/pixel-agents.commit`.
  The iframe isolates upstream's Tailwind/base styles from the gallery SPA. Run
  `npm run test:e2e` in this workspace to build the Pages-subpath bundle and exercise the
  pinned default layout, canvas pixels, activity panels, controls and persistence in Chromium.

## Deploys

- **Production**: `.github/workflows/pages.yml` checks out the pinned submodule and builds this workspace on every push to
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

`image-rendering: pixelated`, so the renderer's pixel art stays crisp instead of
browser-smoothed. (v1's checkered "this is transparency" backdrop behind previews was
kept through #16's first pass, then dropped in a follow-up: the office itself never
shows that convention — its game canvas is always an opaque solid colour — and it read
as a bug rather than a decorative choice against the office-matched palette. Previews
now sit on a plain `bg-canvas` fill instead.)

## Design tokens (#16): lifted, not invented

`src/index.css` defines every colour and the display font as CSS custom properties
(`--pi-*`), fed into Tailwind v4 via `@theme inline` so they're ordinary utility classes
(`bg-surface`, `text-accent`, `border-danger`, `font-display`, …) everywhere else in the
tree — no component hand-mixes a colour.

- **Accent (`#6030ff` family)** and the **light/dark split** come from the Pixel Agents
  docs site's own `src/css/custom.css` (`pixel-agents-hq/docs`) — its
  `--ifm-color-primary*` scale and its `html[data-theme='dark']` emphasis scale.
- **Dark-mode surface tones** (`#1e1e2e`, `#16162a`) are the office webview's own
  (`vendor/pixel-agents/webview-ui/src/index.css`).
- **`FS Pixel Sans`** is the same bitmap font both the office and the docs site use for
  headings — copied into `public/fonts/` (MIT, from the pinned submodule) so the public
  asset remains explicit.
- **Contrast**: every canvas/ink/muted/accent pairing was checked against WCAG AA
  (4.5:1) with the office/docs hexes as fixed points; two of the docs' own tones
  (`muted`, `subtle` in light mode) needed darkening a step to clear it — see the
  comments beside those tokens in `index.css` for the exact ratios.
- **Theme toggle**: `theme/ThemeProvider.tsx`, defaulting to the OS preference,
  persisted to `localStorage` (`pixelindex_theme`) — `index.html` applies it in an
  inline script before the app bundle loads, so there's no flash of the wrong theme.
- **Favicon / social preview**: `public/favicon.svg` (hand-written) and
  `public/og-image.png` (rendered with Playwright from a small HTML page using the same
  tokens) — both an accent-grid mark on the office's own solid dark surface, so the
  brand is consistent from a browser tab to a Discord embed to a preview card.

<!-- trigger a real Vercel preview build for #12 -->
