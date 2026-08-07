# Contributing a layout

1. Design your office in Pixel Agents, then **Layout → Export** to get a
   `layout.json`.
2. Add it under a new folder named in lowercase kebab-case:

   ```
   layouts/my-office/
   ├── layout.json    the export, unmodified
   └── meta.json      title, author, description, tags, license
   ```

   ```json
   {
     "title": "My Office",
     "author": "your-github-username",
     "description": "One or two sentences on what it is for.",
     "tags": ["open-plan", "small"],
     "license": "CC0-1.0"
   }
   ```

3. Check it locally:

   ```bash
   git submodule update --init --recursive
   node tools/validate.mjs
   ```

4. Open a pull request. CI validates the layout and renders its preview; the
   gallery build is attached to the run as an artifact so the preview can be
   reviewed before merge.

## What validation checks

- `cols × rows` matches the number of tiles, and `tileColors` lines up.
- Every furniture id exists in the pinned Pixel Agents. A layout exported from a
  newer version can reference furniture this index cannot draw.
- `layoutRevision` is not below the bundled default's.

## The layoutRevision rule

Pixel Agents **discards a stored layout whose `layoutRevision` is lower than
the bundled default's** and resets to the default
(`server/src/layoutPersistence.ts`). A layout published below the current
revision would be silently wiped on the user's next start, so validation fails
on it. If that happens, re-export your layout from the pinned version.

## Do not edit layout.json by hand

It is the artifact people download and import. Keep it exactly as Pixel Agents
exported it; everything descriptive belongs in `meta.json`.

## Previews

Previews are never committed. They are rendered during the build by Pixel
Agents' own renderer, so they always match the current layout and the pinned
upstream. To see yours locally:

```bash
npm ci
(cd vendor/pixel-agents && npm ci)
npx playwright install chromium
npm run build && npm run serve
```
