# @pixel-index/web

The gallery. Vite + React + Tailwind, matching `vendor/pixel-agents/webview-ui` exactly
so design tokens can be lifted from upstream rather than re-derived by eye.

Built as a **static SPA**: GitHub Pages serves production from `main`, Vercel builds the
same output for per-pull-request previews.

## Status

The shell (#12), gallery/detail (#13), search/filter (#14), the authenticated flows
(#15), and the visual design (#16) all exist: login with Discord, submit with a real
pre-publish preview, manage your own layouts, a moderation console, an admin console —
styled with tokens lifted from the office webview and the docs site, not invented.

| Issue | Scope | State |
|---|---|---|
| [#12](https://github.com/NNTin/pixel-index/issues/12) | SPA shell, API client, Pages deploy, Vercel PR previews | done |
| [#13](https://github.com/NNTin/pixel-index/issues/13) | gallery, layout detail, preview, download | done |
| [#14](https://github.com/NNTin/pixel-index/issues/14) | search and filter | done |
| [#15](https://github.com/NNTin/pixel-index/issues/15) | login, submit, my layouts, moderation console, admin | done |
| [#16](https://github.com/NNTin/pixel-index/issues/16) | visual alignment with the office and docs site | done |

```
src/main.tsx                     mounts <App>, wrapped in BrowserRouter + ThemeProvider +
                                  AuthProvider
src/App.tsx                      routes, /submit /me/layouts /moderation /admin behind RequireAuth
src/index.css                    design tokens (#16) — see below
src/theme/ThemeContext.tsx       light/dark toggle, persisted to localStorage
src/components/Layout.tsx        header, role-aware nav (login/logout, submit, my layouts,
                                  moderation, admin — a convenience, never the real gate)
src/components/RequireAuth.tsx   client-side route gate: "log in" / "moderators only" —
                                  UX only, the API is what actually enforces a role
src/components/LayoutCard.tsx    the gallery grid's card: preview, title, author, facts
src/components/PreviewImage.tsx  checkered backdrop, image-rendering:pixelated,
                                  missing-preview placeholder (carried over from v1)
src/components/FactsRow.tsx      "25×22 · 59 furniture · 4 areas · 2 pets" — zero-valued
                                  facts omitted, carried over from v1
src/components/AuthorLink.tsx    "clicking an author name filters to their layouts" — #14
src/components/FilterBar.tsx     search, sort, size/pets/furniture filters, the tag
                                  multi-select (populated from GET /api/v1/tags),
                                  "N active, clear filters"
src/api/client.ts                apiRequest() — the one fetch wrapper every other api/*
                                  client builds on; VITE_API_BASE_URL, never a hardcoded
                                  hostname; apiUrl() resolves API-relative asset paths
src/api/authClient.ts            the OAuth code exchange, refresh, logout, /me
src/api/manageClient.ts          submit, preview-check, my-layouts CRUD (#9/#15)
src/api/moderationClient.ts      moderation browse + act, admin user search/role/block (#10/#15)
src/api/types.ts                 hand-written against services/api/src/layouts/schemas.ts
src/api/useApi.ts                loading/error/ready as data, for every screen that calls
                                  the API
src/auth/AuthContext.tsx         the session state machine — see below
src/auth/storage.ts              only the refresh token is persisted; see ADR 0001 decision 10
src/routes/filters.ts            the URL <-> Filters <-> #6 API params translation — the
                                  URL is the shareable, human-readable form; #6's own
                                  min/max params are what's actually sent
src/routes/Home.tsx              the gallery: FilterBar wired to useSearchParams, keyset
                                  pagination via #6's cursor, "Load more", a filter-aware
                                  empty state
src/routes/LayoutDetailPage.tsx  full metadata, download, the layoutRevision-ahead-of-pin
                                  warning, clickable tags/author (into #14's filters)
src/routes/SubmitPage.tsx        paste/upload layout.json, "Check preview" before "Publish"
src/routes/MyLayoutsPage.tsx     list/edit/replace/delete what you own, visibility + reason
src/routes/ModerationPage.tsx    every layout, any visibility; hide/remove/restore with a reason
src/routes/AdminPage.tsx         find a user, grant/revoke a role, block/unblock
vite.config.ts                   base path config + the GitHub Pages 404.html generator
index.html                       the matching restore-path script (see the two together)
```

### The session: ADR 0001 decision 10, implemented

`auth/AuthContext.tsx` is the state machine the ADR's bearer-token design turns into —
worth reading alongside `docs/adr/0001-v2-architecture.md`'s decision 10, not instead of
it. On mount: if the URL has a `#pixelIndexLoginCode=...` fragment (the redirect back
from Discord landed here), it's exchanged immediately and cleared from the address bar
before the app ever renders with it visible; otherwise a stored refresh token (if any)
is used to restore a session via `/auth/refresh` then `/me`. The access token lives in
React state only — memory, never `localStorage` — while the refresh token is persisted
(`auth/storage.ts`) so a page reload doesn't force a full Discord round-trip. A timer
proactively rotates the access token about a minute before it expires; any refresh
failure (reuse detected, expired, or the account got blocked — `rotateRefreshToken`
re-checks `blockedAt` on every call) clears the session rather than retrying, since none
of those are transient.

`RequireAuth` (and the nav links it mirrors) is UX, not authorization: every page it
gates makes the exact same API calls a logged-out `curl` could make, and gets the exact
same 401/403 back. Hiding a "Moderation" link from a normal user makes the product
legible; it does nothing for security, which is the API's job alone.

### A real preflight bug this found

Adding `PATCH`/`PUT`/`DELETE` calls from the browser (edit, replace, delete, moderate,
role/block) surfaced a live CORS bug in `services/api`: without an explicit `methods`
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

### No "report" control

#15's original scope included a report button on every layout. #10 (moderation) had
already dropped report intake entirely before it was built — no `POST /report`, no
queue, see [its comment thread](https://github.com/NNTin/pixel-index/issues/10) — so
there is nothing for a report button to call. `CONTENT_POLICY.md` (#11) documents the
actual path: contact a moderator directly. See the
[#15 comment thread](https://github.com/NNTin/pixel-index/issues/15) for the two backend
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
  headings — copied into `public/fonts/` (MIT, from the pinned submodule) rather than
  symlinked to it, since `pages.yml` doesn't check out submodules.
- **Contrast**: every canvas/ink/muted/accent pairing was checked against WCAG AA
  (4.5:1) with the office/docs hexes as fixed points; two of the docs' own tones
  (`muted`, `subtle` in light mode) needed darkening a step to clear it — see the
  comments beside those tokens in `index.css` for the exact ratios.
- **Theme toggle**: `theme/ThemeContext.tsx`, defaulting to the OS preference,
  persisted to `localStorage` (`pixelindex_theme`) — `index.html` applies it in an
  inline script before the app bundle loads, so there's no flash of the wrong theme.
- **Favicon / social preview**: `public/favicon.svg` (hand-written) and
  `public/og-image.png` (rendered with Playwright from a small HTML page using the same
  tokens) — both on the same checkered-backdrop-plus-accent-grid motif as the preview
  cards, so the brand is consistent from a browser tab to a Discord embed.

<!-- trigger a real Vercel preview build for #12 -->
