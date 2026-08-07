# @pixel-index/api

Fastify 5 over Postgres. Holds everything the static frontend cannot: the Discord client
secret, the database connection, and every authorization decision.

## Status

The **database layer** ([#3](https://github.com/NNTin/pixel-index/issues/3)) and the
**service skeleton** ([#5](https://github.com/NNTin/pixel-index/issues/5)) exist: config,
CORS, the error envelope, rate limiting, health/readiness and a Dockerfile. There are
still **no business routes** — that starts with #6.

| Issue | Scope | State |
|---|---|---|
| [#3](https://github.com/NNTin/pixel-index/issues/3) | schema, migrations, migration entrypoint | done |
| [#5](https://github.com/NNTin/pixel-index/issues/5) | service skeleton: config, CORS, health, error envelope, rate limits | done |
| [#6](https://github.com/NNTin/pixel-index/issues/6) | public layout API v1 + OpenAPI — the third-party contract | next |
| [#7](https://github.com/NNTin/pixel-index/issues/7) | Discord OAuth, sessions, roles | |
| [#8](https://github.com/NNTin/pixel-index/issues/8) | submission: validate, dedupe, render, publish | |
| [#9](https://github.com/NNTin/pixel-index/issues/9) | owner self-service | |
| [#10](https://github.com/NNTin/pixel-index/issues/10) | reports, moderation, audit log | |

## The HTTP surface today

```
src/config.ts        env-only config, validated at boot, all problems reported at once
src/errors.ts         ApiError + the one error envelope every response uses
src/rateLimit.ts      writeRateLimitConfig() — the tighter per-route bucket
src/auth/context.ts   request.user, and the seam #7 replaces
src/server.ts          Fastify app: CORS, rate limits, error handling, /health, /ready
src/index.ts           entrypoint: open the pool, boot the server, shut down together
```

```bash
npm run dev --workspace @pixel-index/api    # tsx watch
npm test --workspace @pixel-index/api        # 73 tests, no real Postgres needed
```

`GET /health` is liveness — always 200 once the process is up. `GET /ready` actually
queries Postgres (2s timeout) and is what the Dockerfile's `HEALTHCHECK` uses, so a
database outage takes the container out of the load balancer instead of leaving it
"healthy" while every real route would 500.

## Configuration

Every required variable is validated **at boot**, and every problem is reported
**together** — a misconfigured deployment fails once with a full list, not one
frustrating restart per missing value. No hostname, domain or deployment-specific string
is ever compiled in; see [ADR 0001, decision 8](../../docs/adr/0001-v2-architecture.md).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgres://` or `postgresql://` |
| `RENDERER_URL` | yes | — | The renderer (#4). Not called by any route yet |
| `PUBLIC_WEB_ORIGIN` | yes | — | Comma-separated **exact origins** allowed to call the API with credentials |
| `DISCORD_CLIENT_ID` | yes | — | Read now so #7 only adds logic, not config |
| `DISCORD_CLIENT_SECRET` | yes | — | Same |
| `API_HOST` | | `::` | Dual-stack — see the healthcheck note below |
| `API_PORT` | | `3000` | |
| `API_TRUST_PROXY` | | `true` | Trust `X-Forwarded-For`. Every deployment sits behind a reverse proxy; a self-hoster exposing the API directly must set this `false` |
| `API_BODY_LIMIT_BYTES` | | `5000000` | Refused at the socket, before parsing |
| `LOG_LEVEL` | | `info` | Pino level |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | | `300` / `60000` | General bucket |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW_MS` | | `20` / `60000` | Tighter bucket for #8's submission and render-triggering paths |

`PUBLIC_WEB_ORIGIN` entries must be an **origin only** — `https://pixel-index.example`,
never `https://pixel-index.example/` or `.../some/path`. `new URL(x).origin !== x` is
rejected at boot rather than silently never matching a real browser `Origin` header
later.

## CORS is a product surface here, not a detail

The frontend is on GitHub Pages and this service is on another origin, so every browser
call is cross-origin. The allowlist comes from `PUBLIC_WEB_ORIGIN`, so the official index
and a self-hoster's Pages domain are both just values — never hardcoded. Only an
allowlisted origin gets `Access-Control-Allow-Credentials: true`; anything else gets no
CORS headers at all, which is what makes a real browser block the response from ever
reaching page JS. A request with **no** `Origin` header (curl, server-to-server) is not a
CORS request and is unaffected either way.

## One error envelope

Every error response — thrown deliberately, raised by Fastify's schema validation, or
unhandled — comes out the same shape:

```jsonc
{ "error": "validation_error", "message": "Validation failed.", "issues": [ /* … */ ] }
```

`issues` is only present on a 422, and is exactly
`@pixel-index/layout-core`'s `ValidationResult.issues` — `ApiError.validation(result.issues)`
is the whole translation layer #8 needs. `ApiError` has `.notFound()`, `.forbidden()`,
`.unauthorized()`, `.conflict()` and `.badRequest()` statics; anything unexpected is
logged in full server-side and rendered to the client as a bare `internal_error`, never
leaking internals.

## Rate limiting

`@fastify/rate-limit`, registered once, globally, keyed on the real client via
`trustProxy` (not the reverse proxy's own IP). A 429 carries `Retry-After` and the shared
envelope. A route that needs the tighter bucket spreads in `writeRateLimitConfig(config)`:

```ts
app.post('/api/v1/layouts', writeRateLimitConfig(config), handler);
```

which overrides just that route — the general bucket for everything else is untouched.

> **A subtlety that cost a debugging session:** `@fastify/rate-limit`'s
> `errorResponseBuilder` does not `reply.send()` — it *returns a value that gets thrown*
> into Fastify's normal error pipeline. Returning a plain object with no `.statusCode`
> means the central error handler has nothing to key on and falls back to 500. The
> builder in `server.ts` mirrors the plugin's own default shape (`new Error(...)` with
> `.statusCode` set) for exactly this reason — the actual envelope is still rendered by
> `errors.ts`, this only has to get the shape right.

## The auth seam

`request.user: AuthUser | null` is decorated on every request, resolved by one hook that
currently always returns `null`
(`src/auth/context.ts`). Every route already runs after it. **#7 replaces the body of
one function** (`resolveUser`) rather than threading a new decorator through every route
file that needs to know who is asking. `requireAuth(request)` throws a 401 in the shared
envelope for routes that need to require it, once #7 can actually populate `user`.

## Docker

```bash
# Context is the repo root.
docker build -f services/api/Dockerfile -t pixel-index-api .
```

`docker-entrypoint.sh` runs `db/migrate.js` **before every start**, not just the first —
migrations are forward-only and idempotent, so this is what makes a self-hoster's first
`docker compose up` provision a working database with no manual step, and makes a restart
after a schema-bumping deploy just work.

`drizzle-kit` and the rest of the dev toolchain are pruned from the runtime image
(`npm prune --omit=dev`) — they never run in production.

Verified end-to-end against a real containerised Postgres 17: migrations apply on first
boot, `/ready` succeeds, `/ready` fails within milliseconds when Postgres is stopped
(fails fast — this does not wait for the 2s timeout, because `pg` rejects a refused
connection immediately), a restart re-runs migrations idempotently, the image reports
`healthy`, and `SIGTERM` stops the container with exit `0` in under 0.3s.

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
that actually ships — reports zero vulnerabilities. The same is true of `services/api`'s
own image: it is pruned to production dependencies before the runtime stage, so
`drizzle-kit` and its dev-only chain never ship at all.
