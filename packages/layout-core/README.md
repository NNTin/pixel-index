# @pixel-index/layout-core

The single definition of what a valid layout is.

Three components need this answer — CI, the API's submission endpoint, and the renderer
— and three copies of it would drift. A drifted validator means the index accepts a
layout that Pixel Agents will silently discard, which is the specific failure this
project exists to prevent.

## Status

Skeleton. **Delivered by [#2](https://github.com/NNTin/pixel-index/issues/2)**, which
extracts it from `tools/validate.mjs` and `tools/lib/layouts.mjs` and moves
`schema/*.json` here.

Planned surface:

| Export | Purpose |
|---|---|
| `validateLayout(layout)` | structured errors, not `process.exit` |
| `validateMeta(meta)` | schema-driven |
| `layoutStats(layout)` | cols, rows, furniture, areas, pets, carpets, layoutRevision |
| `furnitureCatalog()` | read from the pinned upstream |
| `bundledLayoutRevision()` | the value the `layoutRevision` rule compares against |
| `sha256(bytes)` | dedupe and render-cache keys |

Errors are returned as data (`{ code, path, message }`) so the API can turn them into a
422 body and the CLI can print them.

## The rule that eats layouts

Pixel Agents **discards a stored layout whose `layoutRevision` is lower than the bundled
default's** (`vendor/pixel-agents/server/src/layoutPersistence.ts`) and resets to the
default. A layout published below the current revision silently disappears from the
user's office on next start, so validation fails on it rather than warning.

## Two false positives already fixed once

Both are easy to reintroduce during the extraction, and both are covered by tests:

- **Virtual `:left` furniture ids.** Upstream synthesises entries like `PC_SIDE:left`
  for assets with `mirrorSide` or `orientation: side`. A catalog reader that only walks
  declared ids rejects valid layouts.
- **Wall furniture at negative rows.** Wall-mounted items are anchored by their bottom
  row (`getWallPlacementRow: row - (footprintH - 1)`), so a valid `minRow` is
  `canPlaceOnWalls ? -(footprintH - 1) : 0`.
