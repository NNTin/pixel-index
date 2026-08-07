# @pixel-index/api

Fastify 5 over Postgres. Holds everything the static frontend cannot: the Discord client
secret, the database connection, and every authorization decision.

## Status

The **database layer exists** ([#3](https://github.com/NNTin/pixel-index/issues/3)).
There is no HTTP server yet.

| Issue | Scope | State |
|---|---|---|
| [#3](https://github.com/NNTin/pixel-index/issues/3) | schema, migrations, migration entrypoint | done |
| [#5](https://github.com/NNTin/pixel-index/issues/5) | service skeleton: config, CORS, health, error envelope, rate limits | next |
| [#6](https://github.com/NNTin/pixel-index/issues/6) | public layout API v1 + OpenAPI — the third-party contract | |
| [#7](https://github.com/NNTin/pixel-index/issues/7) | Discord OAuth, sessions, roles | |
| [#8](https://github.com/NNTin/pixel-index/issues/8) | submission: validate, dedupe, render, publish | |
| [#9](https://github.com/NNTin/pixel-index/issues/9) | owner self-service | |
| [#10](https://github.com/NNTin/pixel-index/issues/10) | reports, moderation, audit log | |

## The database

```
src/db/schema.ts      the tables, and why they are shaped that way
src/db/client.ts      pool + Drizzle handle from DATABASE_URL
src/db/migrate.ts     container entrypoint: apply pending migrations, exit
migrations/           generated SQL, forward-only
```

```bash
export DATABASE_URL=postgres://user:pass@host:5432/pixel_index

npm run build && npm run db:migrate   # what the container does
npm run db:migrate:dev                # same thing, straight from src/
npm run db:generate                   # after editing schema.ts
npm test                              # against a real Postgres, in-process
```

Migrations are **forward-only and idempotent**. Drizzle records what it applied in
`drizzle.__drizzle_migrations` and skips it, so running the entrypoint on every boot is
safe and is the intended usage — that is what makes a self-hoster's first
`docker compose up` provision a working database with no manual step. There is no
`down`; rolling back a schema change means writing the next migration.

## Decisions worth knowing before you write a query

**Post-moderation.** `visibility` defaults to `public` on insert. There is no approval
queue — the queue is the *report* queue.

**Four visibility states, not a boolean:**

| state | set by | reversible | slug reserved | in public API |
|---|---|---|---|---|
| `public` | — | — | yes | yes |
| `hidden` | moderator | yes | yes | no |
| `removed` | moderator | no | yes | no |
| `deleted` | owner | no | yes | no |

Moderator-hidden and owner-deleted need different behaviour on re-submission: an owner
may republish what they withdrew, but re-uploading moderator-removed content must not
launder it back onto the front page. The row always survives, because slug reuse by a
different author is a quiet impersonation vector.

**Seed layouts have a real owner.** [#18](https://github.com/NNTin/pixel-index/issues/18)
loads git-versioned layouts with no Discord account behind them. Rather than a nullable
owner — which would force every permission check and join to handle null — they belong
to a synthetic system user created by migration 0002 at a fixed id
(`SYSTEM_USER_ID`). A check constraint guarantees nothing can authenticate as it, and
`layouts.author_display` carries the human credit.

**Stats are denormalised from `@pixel-index/layout-core`.** `layoutStats()` is the single
source of truth for `cols`, `rows`, `furniture_count`, `area_count`, `pet_count`,
`carpet_count` and `layout_revision`, and must be applied on every write. A test asserts
the stored columns equal what `layoutStats()` returns for a real layout, so the two
cannot drift.

**`search_vector` is a generated column**, not something the application maintains, so it
can never disagree with the title and description it indexes.

## The audit log is append-only in the database

A trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on `moderation_actions`. The
requirement was "no update/delete path in application code", but a convention like that
rots the first time someone writes a cleanup script, and an audit log that can be quietly
rewritten is not an audit log.

**Neither `target_id` nor `actor_user_id` is a foreign key**, deliberately. History has
to outlive what it describes — a removal that erased its own evidence would defeat the
purpose. There is also a sharp edge here: `ON DELETE SET NULL` is itself an `UPDATE`, so
with a real FK the trigger would fire and **deleting any user who had ever moderated
anything would fail outright**. `actor_label` and the `before`/`after` snapshots are what
keep a row legible once its subjects are gone.

Reconstructing a layout's history is one query:

```sql
SELECT * FROM moderation_actions
WHERE target_type = 'layout' AND target_id = $1
ORDER BY created_at;
```

## Indexes

Every public read path filters on visibility first, so the indexes for
[#6](https://github.com/NNTin/pixel-index/issues/6) and
[#14](https://github.com/NNTin/pixel-index/issues/14) are **partial**
(`WHERE visibility = 'public'`). They stay small as removed and deleted rows accumulate.
Verified against Postgres 17 with 20k rows across 60 authors: listing uses
`layouts_public_created_idx`, author filtering uses `layouts_public_author_idx`, dedupe
uses `layouts_sha256_idx`, and full-text search uses the partial GIN
`layouts_public_search_idx`. `layouts_author_idx` is deliberately *not* partial, because
owner dashboards ([#9](https://github.com/NNTin/pixel-index/issues/9)) list hidden rows
too.

## Tests

`npm test` runs against **PGlite** — Postgres compiled to WASM, in-process. Triggers,
generated columns, partial indexes, enums and check constraints all behave as they will
in production, and no Docker or CI service container is needed. A mocked database would
prove none of it, and every acceptance criterion for this schema is about behaviour the
engine provides.

The migration entrypoint itself was additionally verified end-to-end against a real
Postgres 17 container, since the tests exercise the PGlite driver rather than
`node-postgres`.

## A note on `drizzle-kit`

`drizzle-kit` is a **devDependency** that turns `schema.ts` into SQL. It never runs in
production — the container applies the generated SQL with drizzle-orm's migrator — so it
is not installed in the runtime image. It currently pulls a deprecated
`@esbuild-kit/*` chain with a moderate advisory against esbuild's dev server. That
advisory needs an esbuild dev server running to matter, which `drizzle-kit generate` does
not start, and the latest drizzle-kit still carries it. `npm audit --omit=dev` — the tree
that actually ships — reports zero vulnerabilities.

## Configuration

Environment only, validated at boot, failing loudly on anything missing. No hostname or
domain is ever compiled in — see
[ADR 0001, decision 8](../../docs/adr/0001-v2-architecture.md).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required. |

More arrive with [#5](https://github.com/NNTin/pixel-index/issues/5) and
[#7](https://github.com/NNTin/pixel-index/issues/7).

## Two things to get right early

**CORS is a product surface here, not a detail.** The frontend is on GitHub Pages and
this service is on another origin, so every browser call is cross-origin. The allowlist
comes from config, so the official index and a self-hoster's domain are both just
values.

**A health check that always returns 200 is how a container stays in a load balancer
while broken.** Readiness must actually probe Postgres. Bind and probe both IP stacks
explicitly — probing `localhost` resolves to `::1` first inside a container, so an
IPv4-only listener fails the check, the container is marked unhealthy, and reverse
proxies drop it, producing a bare 404 with nothing in any log. That exact failure has
already happened once to this project.
