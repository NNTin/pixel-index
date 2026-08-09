# Pixel Index

A community index of office layouts for
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents).

Browse the gallery, download a `layout.json`, and load it in Pixel Agents with
**Layout → Import**.

## Repository layout

An npm workspace, built out across the epic tracked in
[#19](https://github.com/NNTin/pixel-index/issues/19):

```
packages/layout-core/    validation, stats, JSON Schemas — shared by everything below
apps/web/                the gallery SPA        -> GitHub Pages, or self-hosted (#17)
services/api/            Fastify + Postgres     -> container, the public API and auth
services/renderer/       Playwright + pinned upstream -> container, draws every preview

seed/<slug>/
├── layout.json          the artifact people download, exactly as exported
└── meta.json             title, author, description, tags
                          loaded into the database on first boot (#18) — see
                          services/api/README.md's note on seeding

docs/ARCHITECTURE.md    the service stack: what each piece is, how they talk
docs/deployment.md       self-hosting: TLS, reverse proxies (#17)
docs/preview-deployments.md
                        what each PR preview serves, and why the vendor-update
                        one shows different pictures than production (#26)
vendor/pixel-agents/     pinned upstream (git submodule) — build/render-time only
```

`npm ci` at the root bootstraps every workspace. `vendor/pixel-agents` is deliberately
**not** a workspace member — it is a submodule with its own lockfile, installed with
`npm ci --prefix vendor/pixel-agents`.

Metadata is kept out of `layout.json` on purpose: that file should be byte-for-byte
what Pixel Agents exported, so importing it can never be surprising.

There was a v1 here: a static site rebuilt by a pull request, previews rendered at
build time, and no per-user ownership. It's gone — retired in
[#18](https://github.com/NNTin/pixel-index/issues/18) once the database-backed API
(#6–#10), the SPA (#12–#16) and self-hosting (#17) could actually replace it, not
before.

## Architecture

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the four-service stack — what each
piece is, how they talk to each other, why the frontend and API are two separate origins
with a bearer-token session instead of a cookie, and why every preview is drawn by a
real browser rather than reimplemented.

## Previews are rendered, never stored as source

Every preview is drawn by **Pixel Agents' own renderer** (`services/renderer`), driven
through its dev-mode browser mock with the layout substituted for the bundled default.
Wall autotiling, carpet marching-squares, per-tile colorize and z-sorting therefore all
match what a user will actually see, and a preview can never drift from its layout or
from the pinned upstream. Nothing is pre-rendered into the repository — `GET
/api/v1/layouts/:slug/preview.png` renders on request (and caches by content hash); see
`services/renderer/README.md` for how.

## The index

`GET /api/v1/layouts` (`services/api`) is the machine-readable index — filtered, sorted,
keyset-paginated, documented at `/openapi.json` and `/docs` on a running instance. See
`services/api/README.md` for the full response shape and query parameters.

## The pinned upstream

`vendor/pixel-agents` is a submodule, needed by the renderer (to draw static previews),
the web build (to package the live detail-page viewer), and `packages/layout-core` (to
validate against a known furniture catalog and bundled `layoutRevision`). Pinning it is
what makes both forms of preview reproducible.

```bash
git submodule update --init --recursive
```

## Local development

```bash
npm ci
(cd vendor/pixel-agents && npm ci)
npx playwright install chromium   # needed by renderer tests and the web live-preview E2E

npm run validate      # seed/ against the pinned Pixel Agents
npm test              # every workspace's unit tests
npm run typecheck      # every workspace
npm run test:e2e --workspace @pixel-index/web  # pinned live viewer in a production build

# The full stack (Postgres + api + renderer + web), for anything beyond
# layout-core's own unit tests:
cp .env.example .env
docker compose up --build
```

Each workspace also has its own `npm run dev` (`apps/web`, `services/api`,
`services/renderer`) for iterating on just that piece against the others already
running — see each workspace's own README.

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
`serve.mjs`, the old root `Dockerfile`/`nginx.conf`) was retired in
[#18](https://github.com/NNTin/pixel-index/issues/18), which also added the first-boot
seeding from `seed/` above.

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
