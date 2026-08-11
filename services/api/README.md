# @pixel-index/api

Fastify 5 over Postgres. Holds everything the static frontend cannot: the Discord client
secret, the database connection, and every authorization decision.

## Status

The **database layer** (#3), the **service skeleton** (#5), **Discord auth** (#7), the
**public layout API** (#6), **submission** (#8), **owner self-service** (#9) and
**moderation** (#10) exist. Publishing, editing and moderating a layout no longer
requires a pull request.

| Issue | Scope | State |
|---|---|---|
| [#3](https://github.com/NNTin/pixel-index/issues/3) | schema, migrations, migration entrypoint | done |
| [#5](https://github.com/NNTin/pixel-index/issues/5) | service skeleton: config, CORS, health, error envelope, rate limits | done |
| [#6](https://github.com/NNTin/pixel-index/issues/6) | public layout API v1 + OpenAPI — the third-party contract | done |
| [#7](https://github.com/NNTin/pixel-index/issues/7) | Discord OAuth, sessions, roles | done |
| [#8](https://github.com/NNTin/pixel-index/issues/8) | submission: validate, dedupe, render, publish | done |
| [#9](https://github.com/NNTin/pixel-index/issues/9) | owner self-service: edit, replace, delete | done |
| [#10](https://github.com/NNTin/pixel-index/issues/10) | layout moderation and audit log | done |
| [#21](https://github.com/NNTin/pixel-index/issues/21) | Discord membership and role capabilities | done |
| [#23](https://github.com/NNTin/pixel-index/issues/23) | Discord authors and public author pages | done |

## The HTTP surface today

```
src/config.ts          env-only config, validated at boot, all problems reported at once
src/errors.ts           ApiError + the one error envelope every response uses
src/rateLimit.ts        writeRateLimitConfig() — the tighter per-route bucket
src/server.ts            Fastify app: CORS, rate limits, error handling, docs, /health, /ready
src/index.ts             entrypoint: open the pool, boot the server, shut down together
src/meta.ts              GET /api/v1/meta

src/auth/context.ts     request.user — wired up, verifies the bearer access token
src/auth/tokens.ts       sign/verify the access JWT; generate/hash opaque tokens
src/auth/discord.ts      Discord OAuth/profile/current guild-member HTTP API
src/auth/discordGrant.ts encrypted user OAuth grant persistence and refresh
src/auth/capability.ts   cached Discord membership + Basic/Moderator/Admin resolution
src/auth/sessions.ts     issue/rotate/revoke refresh tokens; login codes
src/auth/users.ts        profile upsert on login
src/auth/routes.ts       /auth/discord/login, /callback, /auth/token, /refresh, /logout, /me

src/layouts/query.ts     SQL: filter, sort, keyset-paginate, tag/author lookups
src/layouts/cursor.ts    opaque keyset pagination cursors — encode/decode/validate
src/layouts/serialize.ts DB row -> public JSON shape, one place, for list and detail alike
src/layouts/schemas.ts   the JSON Schemas that validate requests AND generate the OpenAPI doc
src/layouts/routes.ts    GET /layouts, /layouts/:slug{,/download,/preview.png,/thumbnail.png}
src/renderer/client.ts   thin client for the renderer service (#4), used by preview routes

src/layouts/submit.ts    POST /layouts — the whole submission pipeline
src/layouts/slug.ts      title -> collision-safe, stable-once-assigned slug
src/layouts/metadata.ts  tag validation, length limits, shared by submit.ts and manage.ts
src/layouts/upstreamValidator.ts  the layout-core validator, built once, shared by submit.ts and manage.ts
src/layouts/manage.ts    PATCH/PUT/DELETE /layouts/:slug, GET /me/layouts — #9's edits, #10's moderation, same routes
src/moderation/audit.ts  recordModerationAction() — the one insert path into the append-only audit log
src/moderation/routes.ts GET /moderation/layouts — #15's moderation console browse endpoint

src/users/routes.ts      GET /admin/users — read-only interacted-user directory
src/authors/routes.ts    GET /authors/:id — public author identity/count
```

```bash
npm run dev --workspace @pixel-index/api    # tsx watch
npm test --workspace @pixel-index/api        # 326 tests, no real Postgres or renderer needed
```

`GET /health` is liveness — always 200 once the process is up. `GET /ready` actually
queries Postgres (2s timeout) and is what the Dockerfile's `HEALTHCHECK` uses, so a
database outage takes the container out of the load balancer instead of leaving it
"healthy" while every real route would 500.

## Configuration

Every required variable is validated **at boot**, and every problem is reported
**together** — a misconfigured deployment fails once with a full list, not one
frustrating restart per missing value. No hostname, domain or deployment-specific string
is ever compiled in; see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#what-each-service-actually-needs).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgres://` or `postgresql://` |
| `RENDERER_URL` | yes | — | The renderer (#4), proxied by `/layouts/:slug/{preview,thumbnail}.png` |
| `PUBLIC_WEB_ORIGIN` | yes | — | Comma-separated **exact origins** allowed to call the API with credentials |
| `PUBLIC_WEB_ORIGIN_PATTERNS` | | — | Opt-in, narrowly scoped wildcards for frontends whose hostname is minted per deploy (Vercel PR previews) — see below |
| `DISCORD_CLIENT_ID` | yes | — | From the Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | yes | — | Same |
| `PUBLIC_API_ORIGIN` | yes | — | This API's own externally-reachable origin. `${this}/callback` **must exactly match** the redirect URI registered in the Discord Developer Portal — Discord rejects a mismatch, and mismatches fail late and confusingly |
| `SESSION_SECRET` | yes | — | Signs access tokens. `openssl rand -base64 48`. ≥32 characters, checked at boot |
| `DISCORD_ADMIN_IDS` | | — | Comma-separated Discord user IDs that receive Admin |
| `DISCORD_GUILD_ID` | | — | Enables official-guild membership gating and role checks; omit for a fully functional unguilded instance |
| `DISCORD_MODERATOR_ROLE_IDS` | with guild | — | Comma-separated guild role IDs that receive Moderator |
| `DISCORD_INVITE_URL` | with guild | — | HTTPS invite shown to authenticated outsiders |
| `DISCORD_OAUTH_TOKEN_ENCRYPTION_KEY` | with guild | — | API-only, base64 32-byte AES-256-GCM key for retained user grants |
| `DISCORD_MEMBERSHIP_CACHE_TTL_MS` | | `60000` | Maximum membership/capability observation age |
| `ACCESS_TOKEN_TTL_MS` | | `900000` (15 min) | Access JWT lifetime; JWTs carry a user ID, not a role |
| `REFRESH_TOKEN_TTL_MS` | | `2592000000` (30 days) | |
| `LOGIN_CODE_TTL_MS` | | `60000` | Window for the post-`/callback` handoff to the SPA |
| `API_HOST` | | `::` | Dual-stack — see the healthcheck note below |
| `API_PORT` | | `3000` | |
| `API_TRUST_PROXY` | | `true` | Trust `X-Forwarded-For`. Every deployment sits behind a reverse proxy; a self-hoster exposing the API directly must set this `false` |
| `API_BODY_LIMIT_BYTES` | | `5000000` | Refused at the socket, before parsing |
| `LOG_LEVEL` | | `info` | Pino level |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | | `300` / `60000` | General bucket |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW_MS` | | `20` / `60000` | Tighter bucket for #8's submission, render-triggering paths, and the auth endpoints |
| `PIXEL_AGENTS_DIR` | | auto-discovered | Where `vendor/pixel-agents` lives, for `GET /api/v1/meta` and submission validation |
| `MAX_LAYOUT_BYTES` | | `2000000` | Submission size cap (#8), refused before `JSON.parse` even runs — matches the renderer's own default so a layout accepted here is never subsequently rejected there |
| `MAX_SUBMISSIONS_PER_USER_PER_DAY` | | `20` | Post-moderation means a flood is a real, cheap attack — a real 24h count, not a token bucket |

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

### The one case exact origins cannot cover: per-deploy preview hostnames

A Vercel PR preview is served from a hostname minted for that build
(`https://<project>-<build-hash>-<team>.vercel.app`), so there is nothing to put in
`PUBLIC_WEB_ORIGIN` and every credentialed call from a preview fails CORS (#28).
`PUBLIC_WEB_ORIGIN_PATTERNS` is the opt-in escape hatch, and it is validated at boot to
stay narrow: **https only**, **exactly one `*` per pattern**, the `*` **never crosses a
dot** (so it substitutes for part of a single hostname label), and a **whole-label
wildcard is rejected** — `https://*.vercel.app` fails to boot, because it would grant
credentialed access to every project on a shared platform domain rather than yours.

`allowsWebOrigin()` in `config.ts` is the single answer to "may this origin call us with
credentials?", used by both the CORS check and the OAuth `returnTo` allowlist — if those
two disagreed, login from a preview would redirect back successfully and then fail on the
first API call. The residual risk and how to scope a pattern tightly are covered in
[`docs/deployment.md`](../../docs/deployment.md#public_web_origin_patterns-and-its-trade-off).

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

`request.user: AuthUser | null` is decorated on every request by verifying the bearer
access token and contains only `{ id }`. JWTs intentionally carry no role claim.
`requireAuth` is the authentication seam. `resolveCapability` loads the user and, when
its one-minute cache is stale, revalidates the retained user OAuth grant and guild member
directly with Discord. Protected routes use that result on a strict Basic < Moderator <
Admin ladder; Admin inherits Moderator.

## Discord auth

Why cookies lost to a bearer token in every deployment shape this project supports is in
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#how-they-talk-to-each-other) — read
that first if something here seems arbitrary. This section is the practical surface.

### The flow

```
Browser                    API                              Discord
  │  GET /api/v1/auth/discord/login?returnTo=...
  ├──────────────────────────▶│  sets state+PKCE cookie (Path=/callback)
  │◀── 302 to Discord ────────┤
  │                                                              │
  ├───────────────────── user logs in, consents ────────────────▶│
  │                                                              │
  │◀──────────────── 302 to GET /callback?code&state ────────────┤
  │  GET /callback?code&state │
  ├──────────────────────────▶│  checks state == cookie (constant-time)
  │                            │  exchanges code for a Discord token
  │                            │  fetches the Discord profile
  │                            │  upserts the user, mints a one-time login code
  │◀── 302 to frontend#pixelIndexLoginCode=... ───────────────────┤
  │                                                              │
  │  POST /api/v1/auth/token {code}         (ordinary CORS fetch, from here on)
  ├──────────────────────────▶│  consumes the code, mints access+refresh tokens
  │◀── { accessToken, refreshToken, user } ──┤
```

Two structurally different kinds of request happen here, and it is the reason the
whole thing works without a cookie ever crossing origins: `/login` and `/callback` are
**top-level navigations** — the API's own origin is the top-level site every time a
cookie is set or read, which is why an ordinary `SameSite=Lax` cookie is sufficient
there. `/token`, `/refresh` and `/logout` are **CORS fetches** from the SPA, which is
the part that actually crosses origins — and carries no cookie at all.

### Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/auth/discord/login?returnTo=` | — | Starts the flow. `returnTo` must be an allowed web origin (`PUBLIC_WEB_ORIGIN`, or a `PUBLIC_WEB_ORIGIN_PATTERNS` match); anything else silently falls back to the first configured origin rather than becoming an open redirect |
| `GET /callback` | — | **Fixed path, not under `/api/v1`.** Must exactly match what is registered in the Discord Developer Portal |
| `POST /api/v1/auth/token` `{code}` | — | Exchanges a login code for a session. Single-use; a replay is a 401 |
| `POST /api/v1/auth/refresh` `{refreshToken}` | — | Rotates to a new pair. A reused (already-rotated) token revokes the whole session family — see below |
| `POST /api/v1/auth/logout` `{refreshToken}` | — | Revokes the family. Always 204, whether or not the token was valid — logout never leaks validity |
| `GET /api/v1/me` | bearer | Profile, current capability/cache age, and submission eligibility/invite for the caller |

### Refresh token rotation and theft detection

Every refresh **spends** the presented token and issues a new one in its place
(`auth_refresh_tokens.rotatedToId`). Presenting a token a second time — because it was
copied by an attacker, or because a client retried a request it thought had failed —
means neither the original holder's copy nor the replayer's can be trusted to be the
real one, so the **entire family is revoked**, not just that token.

Admin is configured with comma-separated Discord **user IDs** in `DISCORD_ADMIN_IDS`.
There is no local bootstrap promotion and no database role editor. With a guild enabled,
the user must also be a verified guild member; without one, the configured ID is enough
and normal self-hosted functionality stays available.

### Setting up the Discord application

1. https://discord.com/developers/applications → **New Application**.
2. **OAuth2** tab → note the **Client ID** and **Client Secret** → `DISCORD_CLIENT_ID` /
   `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects** → add exactly `${PUBLIC_API_ORIGIN}/callback` — e.g.
   `https://api.pixel-index.example/callback`. This has to be byte-for-byte identical to
   what the API constructs from `PUBLIC_API_ORIGIN`, or Discord rejects the exchange with
   `invalid_client` for a reason that has nothing to do with whether your client secret
   is correct — a mismatch here and a wrong secret produce the *same* error from
   Discord, which is exactly the "fails late and confusingly" the issue warned about.
4. With guild integration, Discord consent includes `guilds.members.read`; the API calls
   `/users/@me/guilds/{guild.id}/member` for role IDs and nickname. No bot, Pico, bot
   token, `guilds`, or email scope is used. See
   [`docs/discord-integration.md`](../../docs/discord-integration.md).

**A live credential fails the same way a wrong one does, and both look like an `invalid_client`
from Discord's side**, so if login rejects immediately: verify the pairing independently
of this codebase before debugging further —

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://discord.com/api/v10/oauth2/token \
  -u "$DISCORD_CLIENT_ID:$DISCORD_CLIENT_SECRET" \
  -d grant_type=client_credentials
```

`200` confirms the id/secret pair itself authenticates. Anything else (`401
invalid_client` in particular) means the secret does not belong to that client id —
often because it was reset in the Developer Portal after being copied, or a different
field (e.g. the Public Key) was pasted by mistake — and the fix is to generate a fresh
secret and update `.env`, before spending any time on the flow itself.

## The public layout API

No authentication anywhere in this section: reading is public, per the requirements.
Every query filters to `visibility = 'public'` before anything else — a hidden or
removed layout is a **404**, identical to a slug that never existed, never a 403 that
would confirm something is there to hide.

| Route | Purpose |
|---|---|
| `GET /api/v1/meta` | The pinned Pixel Agents (version, commit, `layoutRevision`) and the public layout count — the live equivalent of v1's `dist/index.json` header |
| `GET /api/v1/tags` | Every tag in use on a public layout, with its count, most-used first — what #14's tag filter is populated from |
| `GET /api/v1/layouts` | List: filtered, sorted, keyset-paginated |
| `GET /api/v1/layouts/:slug` | Full record, including the parsed layout |
| `GET /api/v1/layouts/:slug/download` | The raw bytes, verbatim — `Content-Disposition: attachment` |
| `GET /api/v1/layouts/:slug/preview.png` | Proxied from the renderer (#4), scale 1 |
| `GET /api/v1/layouts/:slug/thumbnail.png` | Proxied from the renderer, scale **1** — same bytes as `preview.png`, see below |
| `GET /openapi.json` | The OpenAPI 3.1 document, generated from the same schemas below |
| `GET /docs` | Swagger UI over the same document |

### List: filters, sorting, pagination

```
GET /api/v1/layouts?author=<uuid>&tags=cosy,small&q=office&minCols=15&maxFurniture=80&sort=furniture&limit=24&cursor=…
```

| Param | Notes |
|---|---|
| `author` | A `users.id`. Click-an-author-name filtering (#14) uses the `author.id` a list/detail response already returns |
| `tags` | Comma-separated tag names. **ALL**, not any — each one narrows further, the same way the numeric ranges compose |
| `q` | Free text over title and description (the generated `search_vector` column, #3) |
| `min*` / `max*` | `Cols`, `Rows`, `Furniture`, `Areas`, `Pets` — each inclusive at both ends |
| `sort` | `newest` (default), `furniture`, `largest` (`cols × rows`), `title` |
| `limit` | 1–100, default 24 |
| `cursor` | Opaque, from a previous page's `nextCursor` |

Every filter composes with every other — `author` + `tags` + a size range in one request
is exactly what #14's UI needs and is tested directly
(`src/layouts/query.test.ts`, "filters compose").

**Pagination is keyset (cursor-based), not `OFFSET`.** A layout published while someone
is on page 2 would silently shift an `OFFSET` page's contents — skip a row, repeat one.
A cursor pins to `(sortColumn, id)` on the last row of the page before it, so the next
page is stable regardless of what gets inserted anywhere else in the meantime; `id` is
there specifically because `sortColumn` alone is never a total order (two layouts can
tie on furniture count, on `createdAt`, on title). `total` is the count of everything
matching the filters, independent of the page size, for "N results" — see `src/layouts/query.ts`.

An unrecognised query parameter is a **400**, not a silently-ignored no-op — see
"a subtlety" below for why that took a deliberate Fastify override.

### Caching

`/layouts/:slug`, `/download`, `/preview.png` and `/thumbnail.png` are **slug**-addressed,
and a slug's content can change under it once #9 (owner replace) exists — so none of them
is `immutable`. Each sets `Cache-Control: public, max-age=60, must-revalidate` plus an
`ETag` (the layout's `sha256`, or the renderer's own content-addressed etag for the image
routes), and answers a matching `If-None-Match` with a bare `304`. This is different from,
and deliberately weaker than, the renderer's own cache — that one *is* keyed on content
and can be immutable forever, because a given (layout, upstream pin, scale) tuple can
only ever render one way.

### Why `thumbnail.png` asks the renderer for scale `1`, same as `preview.png`

It used to ask for `0.25` — smaller on the wire, and `services/renderer/README.md` has
the byte numbers for anyone weighing that trade-off again. It was reverted because
`apps/web`'s gallery card stretches whatever PNG it's given to a responsive, non-integer
container width with CSS `image-rendering: pixelated`. A `0.25` render is downscaled
*twice* before anyone sees it — once here, to a fixed small grid, and again by the
browser to the card's actual width — and the second step can only draw from the ~1-in-16
pixels the first step kept. Two lossless nearest-neighbour resizes chained like that are
not equivalent to one: measured on a seed layout at a representative card width, 12% of
pixels differed from scaling the full render straight to the card in a single step. This
route now makes the opposite choice on the caller's behalf: send the full render, let the
browser do the one resize that has the actual target size available.

### The OpenAPI document is generated, not maintained by hand

`src/layouts/schemas.ts` is the **single** definition of every request and response
shape. `@fastify/swagger` reads the same schema objects Fastify already uses to validate
requests and serialize responses, so the document at `/openapi.json` cannot describe a
shape the API doesn't actually produce — there is no second copy to let drift in. The
test suite goes one step further and validates real HTTP responses against those same
schema objects with `ajv` (`src/layouts/routes.test.ts`), which is what "the OpenAPI doc
matches actual responses" means as a checked fact rather than a claim.

### Versioning and deprecation

`/api/v1` is additive-only: new optional query parameters, new response fields, new
routes never remove or repurpose an existing one. A breaking change ships as `/api/v2`
alongside it, never in place of it. When `/v2` exists, `/v1` starts sending
`Deprecation: true` and `Sunset: <date>` headers with a documented removal date, giving
third parties (and our own frontend, which is intentionally just another consumer of
this same API) real notice rather than a surprise.

### Two subtleties that cost real debugging time

**Fastify silently *strips* unrecognised properties by default, even with
`additionalProperties: false`.** Ajv's `removeAdditional: true` (Fastify's out-of-the-box
setting) takes precedence over a schema's own `additionalProperties: false` — the
combination means "delete these quietly", not "reject them". For a filtering API that is
the worst possible failure mode: `?mincols=…` typo'd from `?minCols=…` would be dropped
and the caller would get a silently-unfiltered result instead of an error telling them
what they got wrong. `server.ts` sets `ajv: { customOptions: { removeAdditional: false } }`
so `additionalProperties: false` means what it says.

**`sql\`= ANY(${array})\`` is not the same as `IN (…)` when the array comes from a plain
JS value via drizzle's `sql` template.** Drizzle expands a JS array into parenthesised
scalars (`($1, $2)`), and Postgres's `ANY()` operator requires an actual bound array on
its right-hand side — the combination throws `op ANY/ALL (array) requires array on right
side` **at query time**, not at compile time. The tags ALL-match filter
(`src/layouts/query.ts`) uses `sql.join(...)` to build a real `IN (…)` list instead.

## Submitting a layout

```
POST /api/v1/layouts?title=<1-60 chars>&description=<0-300 chars>&tags=<comma,separated>
Authorization: Bearer <access token>
Content-Type: application/json

<the layout.json bytes, exactly>
```

The body **is** `layout.json` — not a field nested in a larger JSON envelope. Title,
description and tags travel as query parameters instead. That is not how a JSON API
would normally shape "upload a resource plus its metadata", and it is deliberate: nested
JSON gets re-serialised the moment it is parsed out of the envelope — different
whitespace, different number formatting — which would silently reintroduce the exact
byte-fidelity problem `layouts.raw` (#6) exists to solve, for the one field where it
matters most. `title`/`description`/`tags` genuinely are just metadata; the layout is the
resource, so it gets the whole body.

Making that work means this one route deliberately overrides Fastify's default
`application/json` body parser with one that keeps the raw string instead of an object —
scoped to an *encapsulated* child plugin (`app.register(async (instance) => …)`) so it
cannot leak into any other JSON route. `layouts/submit.test.ts` includes a regression
test proving `/api/v1/auth/token` still receives a normally-parsed body.

### What happens, in order

Everything cheap runs before anything expensive, so a bad request is rejected as early
as possible:

1. **Auth and capability.** `requireSubmissionCapability` verifies the bearer user and
   requires configured-guild membership from the short Discord cache or a direct API
   revalidation. An unguilded self-hosted instance accepts every authenticated user.
2. **Size.** `MAX_LAYOUT_BYTES`, checked on the raw string's byte length before
   `JSON.parse` ever runs — `413`.
3. **Is it JSON at all** — `400`.
4. **layout-core validation** — `createValidator()`'s full check (schema, grid
   consistency, furniture ids, `layoutRevision`) — `422` with field-level `issues`,
   exactly `@pixel-index/layout-core`'s `ValidationIssue[]`. A `layoutRevision` below the
   bundled default gets layout-core's own explanation of *why* it would break, not just
   that it did — see `packages/layout-core`.
5. **Dedupe**, by `sha256` — `409`.
6. **The daily cap**, a real count of the last 24h — `429 too_many_submissions`.
7. Slug generation, insert (in a transaction with tag attachment), then a best-effort
   render.

### Dedupe also stops a moderation decision being laundered back in

The `sha256` lookup (`findLayoutBySha256`) is **not** scoped to public layouts — it
checks every visibility. A layout a moderator removed still blocks a byte-identical
resubmission with the same `409`, worded so it does not confirm *why* ("was submitted
before and is not available", never naming the slug) — otherwise dedupe-by-content-hash
would be exactly the mechanism someone could use to quietly undo a moderation decision by
resubmitting the same content under a new title.

### Render failure never blocks publication

The issue asked this to be a documented decision, not a default: after the transaction
commits, this route asks the renderer for a preview and includes `previewReady` in the
response, but a renderer failure — down, timed out, or (should it ever happen) rejecting
a layout layout-core already accepted — is logged and does **not** roll back or block the
publication already committed. Coupling "can I submit" to "is the renderer currently up"
would let a secondary feature take down the core one, and there is nothing to
compensate for later regardless: #6's preview routes are a live proxy with no stored
state, so the very next viewer's request tries the renderer fresh no matter what
happened here. The one thing this call buys, beyond the immediate `previewReady` signal,
is a warm renderer cache by the time anyone looks.

### Slugs are generated once, and stay

Derived from the title (`slug.ts`): lowercased, accents stripped rather than dropped
(`"Café"` → `cafe`), non-alphanumeric runs collapsed to one hyphen, truncated to 60
characters. A collision appends `-2`, `-3`, … — checked against **every** existing slug
regardless of visibility, because the unique index has no visibility filter (schema.ts):
a moderator-removed layout still reserves its slug forever, the same reason dedupe checks
every visibility too. The slug is never regenerated from a later title edit (#9) — it is
a permanent, linkable, downloadable URL, and silently moving it under a link someone
already shared would be a worse surprise than a slug that no longer matches a since-renamed
title. A true race between two concurrent submissions computing the same slug before
either commits is retried (up to 3 attempts) rather than surfaced as the caller's problem.

### A boot-time tension this route shares with `/meta`, and resolves the same way

Building the validator once at boot (rather than per request — `furnitureCatalog()`
walks the whole asset tree) raised the same question `/meta` already answered: what
happens if the pinned upstream cannot be found? Crashing the whole process over a
misconfigured `PIXEL_AGENTS_DIR` would take down every read route along with the one
route that actually needs it, so this degrades exactly like `/meta` does — logging loudly
at boot and answering every submission with a clear `503 validator_unavailable` instead of
either refusing to start or failing every request with a confusing, unrelated-looking
stack trace.

### Checking a layout before publishing: `POST /api/v1/layouts/preview-check`

Added for #15's submit UI, which needs to show an author their layout rendered *before*
they publish — "an author who can see their own layout rendered is far less likely to
submit something broken" is the issue's own reasoning, and it is what makes
post-moderation (no review queue) tolerable at all. This is not a new pipeline: same raw
byte-body handling, same `upstream.validator` (so the same actionable, field/furniture-id
-naming errors as the real `POST /api/v1/layouts`), then a direct proxy to the renderer —
just with nothing persisted. The renderer isn't itself reachable from a browser (no CORS
configured on it, deliberately — it is an internal service, not a public one), so this is
the only path a dry-run preview can take. A renderer failure here is a `502`, not the
publish-anyway fallback `POST /api/v1/layouts` uses — there is nothing to "publish
anyway" when nothing was going to be saved either way.

### Verified against a real renderer, not just a stub

Beyond the unit and route-level suite (stubbed renderer, matching #6/#7's own pattern),
#8 was checked against the **actual, built renderer image** rendering a submission
end-to-end: a real login-free JWT signed with the container's own `SESSION_SECRET`,
`POST`ed to the live API, produced a `201` with `previewReady: true`, a subsequent
`GET .../preview.png` returned a genuine 736×768 rendered PNG (not a stub), `/download`
was confirmed byte-identical to the exact bytes sent, a resubmission of the same content
correctly `409`'d, and `/api/v1/meta`'s count incremented by one.

The route tests cover dedupe (both public and non-public cases), Discord submission
capability, and the daily cap.

That #8 check, and the #9/#10 one below, started as one-off manual sessions run by
hand. `services/api/e2e/` turns the same check into something CI runs on every push —
see "Automated end-to-end suite" further down.

## Editing, replacing, deleting and moderating a layout

```
PATCH  /api/v1/layouts/:slug            edit title/description/tags, or (moderator) visibility
PUT    /api/v1/layouts/:slug/layout     replace the layout.json content — owner-only
DELETE /api/v1/layouts/:slug            withdraw — owner-only, idempotent
GET    /api/v1/me/layouts               the caller's own layouts, every visibility
```

### One `PATCH`, not a separate moderator endpoint

#10 originally scoped a report-intake and moderation API of its own — `POST
.../report`, a queue of open reports, dedicated hide/remove/restore routes. Before
building that, the plan was adjusted (see the comment thread on
[#10](https://github.com/NNTin/pixel-index/issues/10)): there is no report queue, and a
moderator hides, removes or restores a layout through the **same** `PATCH
/api/v1/layouts/:slug` an owner uses to fix a typo, not a parallel `/moderate` surface.
The difference between an owner's edit and a moderator's action is which fields the
request is allowed to touch, checked once per request:

- `visibility` is moderator-only, full stop — an owner can never set it (they get `DELETE`
  instead, a one-way trip to `deleted`).
- A `reason` is required whenever the change is **not** the owner editing their own
  metadata — a visibility change, or anyone editing someone else's layout. Nobody has to
  justify a change to their own title to themselves; every other write is moderation and
  "no silent moderation" (#10's own acceptance criterion) means it is always attributed
  and always explained.
- Every visibility transition maps onto one of `layout.hide` / `unhide` / `remove` /
  `restore` in the audit log (`visibilityAuditAction()`, `manage.ts`) purely from
  `(from, to)`, so the log reads as an actual moderation history, not four undifferentiated
  "visibility changed" rows.

`hidden` and `removed` are both reversible by a moderator through the same route;
`deleted` (owner-only, via `DELETE`) is not reachable from `PATCH` at all — see
schema.ts's visibility-state table for why hidden/removed and deleted are different
things with different owners.

### `PUT .../layout` stays owner-only, even for a moderator

Replacing the *content* of a layout is never something #10 does on someone else's
behalf — a moderator who objects to the design hides or removes it; they do not rewrite
someone else's submission. It shares the raw-body content-type parser trick and the
`layoutStats`/dedupe/render pipeline with `POST /layouts` (#8), via the same
`upstreamValidator.ts` instance built once at boot. The dedupe check carries #9's own fix
forward: replacing with content that byte-matches one of the *same owner's* previously
`deleted` layouts is allowed — only a match against someone else's layout, or a
`removed` one, is a `409`.

### `DELETE` is owner-only and idempotent

A moderator never `DELETE`s — that would conflate "the owner withdrew this" with "a
moderator acted on this" in the audit trail, which is exactly the distinction #10 keeps.
Re-deleting an already-`deleted` layout is a silent `204`, matching `/auth/logout`'s
existing idempotent-DELETE precedent (#7) rather than a `404` for a state the caller
already achieved.

### `GET /me/layouts`

The owner's own list, reusing #6's exact sort/cursor pagination machinery
(`ListLayoutsScope`, `query.ts`) with a different base filter — `authorUserId = caller`,
no visibility filter — instead of a second, parallel pagination implementation. Returns
`OwnerLayoutView`: the public shape plus `visibility`, `visibilityReason` and
`visibilityChangedAt`, so an owner can see *why* something of theirs is hidden.

## Discord capabilities and the user directory

Pixel Index does not grant/revoke roles or block accounts locally. Discord is the source
of membership and capability: guild membership grants Basic, configured moderator role
IDs grant Moderator, and configured Discord user IDs grant Admin. Removing/banning a
member stops new submissions, edits, replacements, and privileged actions after the
short cache expires. Existing public layouts stay public; layout visibility remains a
separate moderation decision.

```
GET /api/v1/admin/users?q=<text>&capability=user|moderator|admin
```

This Admin-only endpoint is a read-only directory of non-system users that already have a
Pixel Index row. It never enumerates the guild. Each result contains the public profile,
last cached Basic/Moderator/Admin capability, observation timestamp, and layout count
across all visibilities. Raw Discord IDs, role IDs, and membership are not returned.

The implementation and frontend rights table live in
[`docs/discord-integration.md`](../../docs/discord-integration.md); moderation judgment
lives in [MODERATORS.md](../../MODERATORS.md).

### What #10 dropped, and why

The original plan had a `POST /layouts/:slug/report` intake, a moderator queue of open
reports, and (tentatively) an outbound webhook on new reports. All of it was cut before
implementation, in favor of moderators acting directly through `PATCH` above:

- **No report intake, no queue, no `reports` table writer.** The `reports` schema and
  `report.create`/`resolve`/`dismiss` audit actions (#3) stay in the schema, unused —
  cheap to keep, and not worth a migration to remove for a table nothing writes to yet.
- **The webhook idea had no trigger left without report intake**, so it was dropped for
  this pass rather than built against a queue that does not exist.

See the [#10 comment thread](https://github.com/NNTin/pixel-index/issues/10) for the full
before/after and the four decisions that replaced the original scope.

### Finding something to moderate: `GET /api/v1/moderation/layouts`

`PATCH /api/v1/layouts/:slug` (above) is how a moderator **acts** on a layout, but #10
never built a way to **find** one — a moderator could only act on a slug they already
knew, which was fine when #10 shipped (no UI existed yet to browse from) but not once
#15's moderation console needed something to list. `GET /api/v1/moderation/layouts`
(moderator-minimum) is #6's public list with the one constraint that defines "public"
removed: every author, every visibility, optionally narrowed to exactly one
(`?visibility=hidden` to see what's already been actioned, `?visibility=public` with a
`q=` to go looking for something that shouldn't be). Same filters, same keyset
pagination, same sort keys as the public list — a moderator's browse experience is not a
different tool, just an unfiltered one.

### Security regression coverage

The owner-or-moderator gate on `PATCH` and the dedupe-excludes-`deleted` fix (both `POST
/layouts` and `PUT .../layout`) have direct regression coverage. Discord capability
tests additionally cover encrypted grants, role precedence, cache age, nonmembership,
reauthorization, and outage behavior.

One of those mutation passes caught a real bug, not just proved a test's anchoring: the
first version of the dedupe-excludes-`deleted` fix excluded a `deleted` match
unconditionally, so a stranger with a copy of the exact bytes of *anyone's* withdrawn
layout could republish it as their own. Only "the SAME owner republishing their own
withdrawn content" is what schema.ts documents. Caught during the live end-to-end pass
below — not by the unit suite, which had only ever exercised the same-owner case — the
fix now checks `duplicate.authorUserId === ` the submitting user, and a cross-owner
regression test (`submit.test.ts`, "still rejects a STRANGER…") was added and
mutation-tested alongside it.

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

Since #6, the image also carries `vendor/pixel-agents/package.json` and its
`webview-ui/public/assets` — nothing else, no `node_modules`, no webview source — so
`GET /api/v1/meta` can report a real pinned version via `@pixel-index/layout-core`. This
is a much smaller slice of upstream than the renderer needs, because the API only reads
metadata; it never boots upstream's dev server the way the renderer does.

Verified end-to-end against a real containerised Postgres 17: migrations apply on first
boot, `/ready` succeeds, `/ready` fails within milliseconds when Postgres is stopped
(fails fast — this does not wait for the 2s timeout, because `pg` rejects a refused
connection immediately), a restart re-runs migrations idempotently, the image reports
`healthy`, and `SIGTERM` stops the container with exit `0` in under 0.3s. #6 re-verified
the layout routes the same way, with a layout inserted directly by SQL (#8 did not exist
yet): `/api/v1/meta` reports the real build-arg commit, list/detail/download all
round-trip correctly, `/download` is **byte-identical** to the source file on disk, a 404
renderer (`RENDERER_URL` pointed at nothing) produces a real `502` rather than a hang or
a crash, and `/openapi.json` names its schemas `LayoutSummary`/`LayoutDetail` rather than
the default `def-0`/`def-1` — see "two subtleties" above.

### Automated end-to-end suite

```
services/api/e2e/docker-compose.yml   Postgres + the real renderer + API images
services/api/e2e/run.ts               the assertions — one full owner+admin session
services/api/e2e/e2e.sh               build, bring the stack up, run run.ts, always tear down
```

```bash
npm run test:e2e --workspace @pixel-index/api        # needs Docker
npm run typecheck:e2e --workspace @pixel-index/api    # e2e/run.ts on its own tsconfig
```

Everything above this point — #6 through #10's checks against real containers — started
as one-off manual sessions: build the images, wire up a throwaway network by hand, sign
a JWT via `docker exec`, curl through the flow, tear it down. `services/api/e2e/`
repeats exactly that shape (the real, built Docker images; a real Postgres; no stubbed
renderer) as something that runs unattended, on every push and PR (`api-e2e` job,
`.github/workflows/ci.yml`), instead of only when someone remembers to run it. `run.ts`
inserts test users directly via `pg` (no Discord OAuth needed — access tokens are just
HS256 JWTs, signed with the same `signAccessToken` the API itself uses) and drives the
full flow over real HTTP: submit, edit, moderate, replace, delete, the cross-owner
dedupe fix, the read-only Admin directory, and removal of stale account-action routes. It is deliberately
a plain top-to-bottom script rather than vitest — nothing in it is an independent unit,
it all shares one running stack, and unit coverage of the same individual guards already
lives in `manage.test.ts` and `users/routes.test.ts`; this suite exists to prove the
real images actually boot, migrate, and talk to each other, which no amount of
PGlite-and-a-stub coverage can.

## The database

```
src/db/schema.ts      the tables, and why they are shaped that way
src/db/client.ts      pool + Drizzle handle from DATABASE_URL
src/db/migrate.ts     container entrypoint: apply pending migrations, exit
src/db/seed.ts        container entrypoint: load seed/ if the database is empty, exit
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

### Seeding (#18)

`docker-entrypoint.sh` runs `seed.ts` immediately after migrations, on every boot, not
just the first. It is a no-op the moment **any** layout exists — seeded or not — so a
self-hoster who has since published real content never gets it silently supplemented on
a restart; this only ever fills a genuinely empty table.

The repo root's `seed/<slug>/{layout.json,meta.json}` is copied into the image at build
time (`services/api/Dockerfile`) and loaded with the same `layout-core` validation a real
submission goes through — a seed layout the API itself would reject fails the boot
loudly rather than publishing something broken. Seed layouts have no Discord account
behind them: they belong to the synthetic system user (`SYSTEM_USER_ID`, see below) with
the human credit in `authorDisplay`, and are otherwise ordinary rows — moderatable,
editable by an admin acting through the same tools as anything else, no special case
anywhere else in the codebase.

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
`carpet_count`, `seat_count` and `layout_revision`, and must be applied on every write. A
test asserts the stored columns equal what `layoutStats()` returns for a real layout, so
the two cannot drift.

`seat_count` (how many mock agents the live preview's slider allows, [#48](https://github.com/NNTin/pixel-index/issues/48))
is the one denormalised stat that needs the furniture catalog, not just the layout's own
JSON — a seat is a footprint tile of a chair-category item (`layoutStats()`'s `seats`
mirrors upstream's own `layoutToSeats()`, so a multi-tile item like a SOFA counts as more
than one seat). That is also why a schema migration alone cannot backfill it for rows
written before the column existed: `db/backfill-seats.ts` recomputes it from each row's
stored `layout` column and corrects any that disagree, run once per boot from
`docker-entrypoint.sh` alongside `migrate.ts` and `seed.ts`, idempotently.

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

**#6 added `layouts_public_furniture_idx` and `layouts_public_title_idx`**, each ending
in `id` as a tiebreaker, for the same reason `layouts_public_created_idx` already did —
they make keyset pagination on those sort orders a fully covered index scan rather than
a sort-then-filter. The `largest` sort (`cols × rows`) has no dedicated index yet; #14
explicitly reserves the right to ask for one "once the UI is real", and at the dataset
sizes this index is targeting, a plain `ORDER BY` is not a concern.

**#6 also added `layouts.raw`.** Postgres's `jsonb` type does not round-trip
byte-identically — it collapses whitespace and normalises number literals on write — so
`JSON.stringify()` of the parsed `layout` column is not guaranteed to reproduce what a
contributor's own `sha256sum layout.json` was computed over. `raw` holds the exact bytes
as uploaded or seeded; `GET /layouts/:slug/download` serves `raw` verbatim, and `sha256`
is computed over `raw`, not over a re-serialised `layout`. This is what makes "byte-for-byte
what Pixel Agents exported" and "`sha256` is public so a third party can dedupe" (#6) true
rather than aspirational — see `schema.test.ts`, "`raw` round-trips byte-for-byte".

## Tests

`npm test` runs against **PGlite** — Postgres compiled to WASM, in-process. Triggers,
generated columns, partial indexes, enums and check constraints all behave as they will
in production, and no Docker or CI service container is needed. A mocked database would
prove none of it, and every acceptance criterion for this schema is about behaviour the
engine provides.

The migration entrypoint itself was additionally verified end-to-end against a real
Postgres 17 container, since the tests exercise the PGlite driver rather than
`node-postgres`. The same real-Postgres check was re-run after #7's migration
(`auth_refresh_tokens`, `auth_login_codes`): tables land, check constraints apply, and a
second run is a no-op.

`auth/routes.test.ts` runs the **entire OAuth flow through real HTTP route handlers**
(`app.inject`) against a migrated PGlite database, stubbing only the outbound call to
Discord's API — login → callback → code exchange → `/me` → refresh → logout. Discord's
own confidential-client details (Basic-auth header shape, token endpoint contract) are
exercised separately in `auth/discord.test.ts`.

The three properties that most matter for #7's acceptance criteria are
**mutation-tested**, not just covered — the guard was deleted and the relevant test
confirmed to fail before being restored: refresh-token reuse detection, OAuth `state`
comparison, and the `returnTo` origin allowlist. A green test suite proves the code
runs; deleting the check and watching the right test go red is what proves the test is
actually anchored to the security property it claims to guard, not merely exercising
the code path around it. #6 applies the same discipline to its own three
easiest-to-silently-break properties: the tags ALL-match filter, the visibility filter
(never returning a hidden/removed layout), and the cursor's sort-mismatch rejection.

`layouts/routes.test.ts` runs the **whole public layout API through real HTTP route
handlers** against a migrated PGlite database, including the renderer proxy — with only
the outbound call to the renderer stubbed (`vi.stubGlobal('fetch', …)`), the same pattern
`auth/routes.test.ts` uses for Discord. `layouts/query.test.ts` covers filter composition,
all four sort orders, and keyset pagination directly at the SQL layer — including a test
that inserts a new highest-ranked row *between* two page requests and asserts page 2 is
unaffected, which is the specific failure `OFFSET` pagination cannot avoid.

#6 was additionally verified against a real containerised Postgres 17 with a real seed
layout inserted by hand (#8 did not exist yet): `/api/v1/meta` reports the real
build-arg-supplied commit, `/download` is **byte-identical** to the source file on disk,
and a `RENDERER_URL` pointed at nothing produces a real `502` from the live container,
not a hang.

`layouts/submit.test.ts` and `layouts/slug.test.ts` cover #8 the same way #6 and #7 were
covered — real HTTP handlers, PGlite, a stubbed renderer — and #8 goes one step further:
the **actual, built renderer image** rendered a real submission end-to-end (a genuine
736×768 PNG, not a stub) against the live API and a real Postgres container — see
"Submitting a layout" above for what that checked. Dedupe (both the public and the
non-public/laundering case), the Discord submission gate and the daily cap are covered by route tests.

`layouts/manage.test.ts` and `users/routes.test.ts` cover owner/moderator layout actions
and the read-only Admin directory through real HTTP handlers and migrated PGlite. The
Discord grant/capability suites cover encryption, refresh, membership, role precedence,
and stale-cache behavior.

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
