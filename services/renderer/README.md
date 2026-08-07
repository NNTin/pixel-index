# @pixel-index/renderer

`POST /render` with a layout JSON body, get a PNG back.

Previews are the most valuable thing this index shows, and their credibility comes
entirely from how they are made: **Pixel Agents' own renderer draws them**. Wall
autotiling, carpet marching-squares, per-tile colorize and z-sorting therefore match
what a user will actually see, and a preview can never drift from its layout or from the
pinned upstream.

## Status

Skeleton. **Delivered by [#4](https://github.com/NNTin/pixel-index/issues/4)**, porting
`tools/render-previews.mjs` from a build script over files on disk to an HTTP service.

## Why it is a separate service

It needs Chromium and the pinned upstream checkout, which rules out the API container
(small, stateless, horizontally scalable) and every static or serverless host. It is
also the only component that takes attacker-controlled JSON and runs a browser on it, so
it gets its own blast radius, concurrency limit and resource ceiling.

## Four fixes not to lose in the port

Each of these was found the hard way in v1:

- **The layout must be injected by intercepting the default-layout fetch**
  (`page.route`). Dispatching `layoutLoaded` after page load races the browser mock's own
  late dispatch, and the loser silently renders the *default* office — every preview
  looks plausible and every preview is wrong.
- **`npx vite` orphans the real Vite process** (reparented to PID 1), so `SIGTERM` reaches
  only the wrapper and the render hangs forever. Spawn the binary directly with
  `detached: true` and kill the process group.
- **Vite's `--port 0` hangs.** Allocate a free port yourself and pass `--strictPort`.
- **`ZOOM = 2`** matches upstream's `Math.round(2 * devicePixelRatio)`. Crop to the canvas
  pixel bounding box, and hide DOM chrome first.

## Caching

Key on `sha256(layout) + upstream pin`. Re-rendering an unchanged layout should never
launch a browser, and a submission duplicating an existing layout should cost nothing.
