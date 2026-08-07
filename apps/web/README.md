# @pixel-index/web

The gallery. Vite + React + Tailwind, matching `vendor/pixel-agents/webview-ui` exactly
so design tokens can be lifted from upstream rather than re-derived by eye.

Built as a **static SPA**: GitHub Pages serves production from `main`, Vercel builds the
same output for per-pull-request previews.

## Status

The SPA shell (#12) exists: routing, the API client, loading/error/empty states, and
both deploy pipelines. There is no gallery content yet — `Home` and
`LayoutDetailPage` are #12's proof that the pipeline works end to end, not #13's UI.

| Issue | Scope | State |
|---|---|---|
| [#12](https://github.com/NNTin/pixel-index/issues/12) | SPA shell, API client, Pages deploy, Vercel PR previews | done |
| [#13](https://github.com/NNTin/pixel-index/issues/13) | gallery, layout detail, preview, download | |
| [#14](https://github.com/NNTin/pixel-index/issues/14) | search and filter | |
| [#15](https://github.com/NNTin/pixel-index/issues/15) | login, submit, my layouts, moderation console, report | |
| [#16](https://github.com/NNTin/pixel-index/issues/16) | visual alignment with the office and docs site | |

```
src/main.tsx                mounts <App>, wraps it in BrowserRouter with a basename
                             matching vite.config.ts's `base`
src/App.tsx                 routes: /, /layouts/:slug, catch-all -> NotFound
src/components/Layout.tsx   header + <Outlet/>
src/api/client.ts           fetch wrapper for the #6 public API; VITE_API_BASE_URL,
                             never a hardcoded hostname
src/api/types.ts            hand-written against services/api/src/layouts/schemas.ts
src/api/useApi.ts           loading/error/ready as data, for every screen that calls
                             the API
vite.config.ts              base path config + the GitHub Pages 404.html generator
index.html                  the matching restore-path script (see the two together)
```

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
