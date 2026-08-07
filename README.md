# Pixel Index

A community index of office layouts for
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents).

Browse the gallery, download a `layout.json`, and load it in Pixel Agents with
**Layout → Import**.

## Repository layout

```
layouts/<slug>/
├── layout.json          the artifact people download, exactly as exported
└── meta.json            title, author, description, tags, license

schema/                  JSON Schemas for both files
tools/                   validation, preview rendering, index + site build
vendor/pixel-agents/     pinned upstream (git submodule) — build-time only
dist/                    generated: previews, index.json, the gallery (gitignored)
```

Metadata is kept out of `layout.json` on purpose: that file should be byte-for-byte
what Pixel Agents exported, so importing it can never be surprising.

## Previews are generated, never committed

Every preview is rendered at build time by **Pixel Agents' own renderer**, driven
through its dev-mode browser mock with the layout substituted for the bundled
default. Wall autotiling, carpet marching-squares, per-tile colorize and
z-sorting therefore all match what a user will actually see, and a preview can
never drift from its layout or from the pinned upstream.

The trade-off is that previews only exist in a build — there are no PNGs in the
repository. The deployed gallery is the place to look at them.

## The index

`dist/index.json` is the machine-readable index, built from the per-layout
`meta.json` files:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "…",
  "pixelAgents": { "version": "1.4.0", "commit": "9794e07…", "layoutRevision": 1 },
  "count": 4,
  "layouts": [
    {
      "slug": "blue-office",
      "title": "Blue Office",
      "author": "NNTin",
      "description": "…",
      "tags": [],
      "cols": 25, "rows": 22,
      "furniture": 59, "areas": 4, "pets": 0, "carpets": 0,
      "layoutRevision": 1,
      "bytes": 24067,
      "sha256": "…",
      "files": { "layout": "layouts/blue-office.json", "preview": "previews/blue-office.png" }
    }
  ]
}
```

`pixelAgents` records the version every layout was validated and previewed
against, so a consumer on an older build can tell when a layout is newer than
its Pixel Agents.

## The pinned upstream

`vendor/pixel-agents` is a submodule and is needed at build time only — for
rendering previews and for validating layouts against a known furniture catalog.
Pinning it is what makes previews reproducible.

```bash
git submodule update --init --recursive
```

## Local development

```bash
npm ci
(cd vendor/pixel-agents && npm ci)
npx playwright install chromium

npm run validate    # schema, furniture ids, layoutRevision
npm run build       # validate + index + previews + gallery into dist/
npm run serve       # http://127.0.0.1:4173
```

## The rule that eats layouts

Pixel Agents resets a stored layout when the bundled default's `layoutRevision`
is **higher** than the layout's (`server/src/layoutPersistence.ts`). A layout
published below the current revision is one that silently disappears on the
user's next start, so `tools/validate.mjs` fails on it. When the pinned upstream
bumps its bundled default, affected layouts have to be re-exported.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
