# Pixel Index

A community index of office layouts for
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents).

Browse the gallery, download a `layout.json`, and load it in Pixel Agents with
**Layout → Import**.

## Repository layout

An npm workspace. The `v1` column is what runs today; the `v2` column is where the work
in [epic #19](https://github.com/NNTin/pixel-index/issues/19) lands.

```
# v1 — the static index, currently live
layouts/<slug>/
├── layout.json          the artifact people download, exactly as exported
└── meta.json            title, author, description, tags
schema/                  JSON Schemas for both files
tools/                   validation, preview rendering, index + site build

# v2 — skeletons, filled in by the epic
apps/web/                static gallery SPA           -> GitHub Pages  (#12–#16)
services/api/            Fastify + Postgres           -> container     (#5–#10)
services/renderer/       Playwright + pinned upstream -> container     (#4)
packages/layout-core/    shared validation + schemas                   (#2)

docs/adr/                architecture decisions
vendor/pixel-agents/     pinned upstream (git submodule) — build-time only
dist/                    generated: previews, index.json, the gallery (gitignored)
```

`npm ci` at the root bootstraps every workspace. `vendor/pixel-agents` is deliberately
**not** a workspace member — it is a submodule with its own lockfile, installed with
`npm ci --prefix vendor/pixel-agents`.

Metadata is kept out of `layout.json` on purpose: that file should be byte-for-byte
what Pixel Agents exported, so importing it can never be surprising.

## Architecture

[ADR 0001](docs/adr/0001-v2-architecture.md) records the v2 design and, more usefully,
the alternatives that were rejected and why — the hosting split and the cross-origin
auth problem it creates, npm workspaces, matching upstream's stack, Postgres via
Drizzle, the renderer as its own service, post-moderation, and the git-versioned seed.

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

## Deployment

The gallery is served at <https://pixel-index.nntin.xyz> from a container built
by `Dockerfile`: a Playwright builder stage runs the same `npm run build` used
locally, and the resulting `dist/` is served by nginx. The image is therefore
self-contained — previews are rendered during the build, so a deployed preview
can never disagree with the layout beside it.

```bash
docker network create pixel-index-network   # once
cp .env.example .env
docker compose up -d --build
```

Routing is by Traefik label (`Host(pixel-index.nntin.xyz)`, `websecure`,
Let's Encrypt DNS-01), reached through the Cloudflare Tunnel like the other
`*.nntin.xyz` services. Publishing a new layout means rebuilding the image.

> **Keep the healthcheck passing.** Traefik drops unhealthy containers from its
> load balancer, so a failing healthcheck takes the site off the internet with a
> bare 404 and no error anywhere in the Traefik logs. The check talks to
> `127.0.0.1` rather than `localhost` on purpose: `localhost` resolves to `::1`
> first inside the container, which an IPv4-only nginx listener refuses.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This repository — the tooling, the schemas and the site — is MIT licensed; see
[LICENSE](LICENSE). Layouts are not licensed individually; each is credited to
its author in `meta.json`. The seed layouts are by
[pablodelucca](https://github.com/pablodelucca), who also wrote Pixel Agents.
