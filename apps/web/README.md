# @pixel-index/web

The gallery. Vite + React + Tailwind, matching `vendor/pixel-agents/webview-ui` exactly
so design tokens can be lifted from upstream rather than re-derived by eye.

Built as a **static SPA**: GitHub Pages serves production from `main`, Vercel builds the
same output for per-pull-request previews.

## Status

Skeleton. Delivered across:

| Issue | Scope |
|---|---|
| [#12](https://github.com/NNTin/pixel-index/issues/12) | SPA shell, API client, Pages deploy, Vercel PR previews |
| [#13](https://github.com/NNTin/pixel-index/issues/13) | gallery, layout detail, preview, download |
| [#14](https://github.com/NNTin/pixel-index/issues/14) | search and filter |
| [#15](https://github.com/NNTin/pixel-index/issues/15) | login, submit, my layouts, moderation console, report |
| [#16](https://github.com/NNTin/pixel-index/issues/16) | visual alignment with the office and docs site |

## Constraints that come with static hosting

- **No secrets, ever.** Anything in this bundle is public. The Discord client secret and
  every authorization decision live in `services/api`.
- **No hostnames in source.** The API base URL is build-time config with a documented
  default, or self-hosters inherit ours.
- **Deep links need help.** Pages has no rewrite rules, so client-side routing requires
  either the `404.html` fallback or hash routing — [#12](https://github.com/NNTin/pixel-index/issues/12)
  picks one deliberately.
- **The site is only as available as the API.** Loading, empty and error states are
  first-class, which the v1 static site never had to consider.

## Worth keeping from v1

The checkered `repeating-conic-gradient` backdrop behind previews and
`image-rendering: pixelated`. Layouts are transparent outside the floor, so without the
backdrop they dissolve into the card.
