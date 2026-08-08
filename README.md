# Pixel Index

A community index of office layouts for
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents).

Browse the gallery, download a `layout.json`, and load it in Pixel Agents with
**Layout → Import**.

## Repository layout

An npm workspace. The `v1` column is what runs today; the `v2` column is where the work
in [epic #19](https://github.com/NNTin/pixel-index/issues/19) lands.

```
# v1 — the static-site pipeline; retiring in #18, superseded by v2 below
layouts/<slug>/
├── layout.json          the artifact people download, exactly as exported
└── meta.json             title, author, description, tags
tools/                   preview rendering, index + site build

# v2 — what docker-compose.yml (root) actually builds and runs now
packages/layout-core/    validation, stats, JSON Schemas — shared by all of the below
apps/web/                gallery SPA          -> GitHub Pages (#12–#16) or self-hosted (#17)
services/api/            Fastify + Postgres   -> container (#5–#10)
services/renderer/       Playwright + pinned upstream -> container (#4)

docs/adr/                architecture decisions
docs/deployment.md       self-hosting: TLS, reverse proxies (#17)
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
npm test            # layout-core unit tests
npm run build       # validate + index + previews + gallery into dist/
npm run serve       # http://127.0.0.1:4173
```

## Validation lives in one place

`packages/layout-core` is the single definition of what a valid layout is, because
three things need that answer — CI, the API's submission endpoint (#8) and the renderer
(#4) — and three copies would drift.

It validates in two layers: **structure** from JSON Schema
(`packages/layout-core/schema/`), and **semantics** in code for the rules a schema
cannot express, because they are cross-field (`tiles.length === cols * rows`) or depend
on the pinned upstream (which furniture ids exist, what the bundled `layoutRevision`
is). Issues come back as data (`{ code, path, message }`), so the API can render them as
a 422 and the CLI can print them.

## The rule that eats layouts

Pixel Agents resets a stored layout when the bundled default's `layoutRevision`
is **higher** than the layout's (`server/src/layoutPersistence.ts`). A layout
published below the current revision is one that silently disappears on the
user's next start, so validation fails on it. When the pinned upstream
bumps its bundled default, affected layouts have to be re-exported.

## Deployment

```bash
cp .env.example .env    # fill in the REQUIRED values — see the file itself
docker compose up --build
```

Brings up a complete, self-hostable index on a clean checkout: Postgres, the API
(`services/api`), the renderer (`services/renderer`), and the built frontend
(`apps/web`), all talking to each other over the compose network — no external
network, reverse proxy, or pre-existing infrastructure required (#17). Putting a real
domain and TLS in front of it is a deliberately separate step with no single required
answer — [`docs/deployment.md`](docs/deployment.md) covers Traefik, Caddy and plain
nginx.

> **`localhost` inside a container resolves to `::1` first.** Every health check in
> this repo's images probes `127.0.0.1`, never `localhost`, for exactly that reason — an
> IPv4-only listener fails a `localhost` check it should pass, gets marked unhealthy, and
> a reverse proxy quietly drops it with nothing more informative than a bare 404 and
> nothing in any application log. Worth knowing if you write your own health check
> against this stack.

The static v1 pipeline this replaced (`tools/build-index.mjs`, `build-site.mjs`,
`serve.mjs`, the old root `Dockerfile`/`nginx.conf`) is retired in
[#18](https://github.com/NNTin/pixel-index/issues/18), which also moves the seed
layouts below from `layouts/` into the database on first boot.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Content policy and moderation

This index is post-moderated — content is public on submission, not reviewed before it
appears. See [CONTENT_POLICY.md](CONTENT_POLICY.md) for what is not allowed and how to
report a layout, and [MODERATORS.md](MODERATORS.md) for how the moderation team applies
it.

## License

This repository — the tooling, the schemas and the site — is MIT licensed; see
[LICENSE](LICENSE). Layouts are not licensed individually; each is credited to
its author in `meta.json`. The seed layouts are by
[pablodelucca](https://github.com/pablodelucca), who also wrote Pixel Agents.
