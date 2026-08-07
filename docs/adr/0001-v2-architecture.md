# 1. Pixel Index v2 architecture

- **Status:** accepted
- **Date:** 2026-08-07
- **Tracking:** [#1](https://github.com/NNTin/pixel-index/issues/1), epic [#19](https://github.com/NNTin/pixel-index/issues/19)

## Context

v1 is a static, git-versioned index. A layout lives in `layouts/<slug>/`,
`tools/validate.mjs` checks it against the pinned `vendor/pixel-agents`,
`tools/render-previews.mjs` drives the real upstream renderer to produce a preview at
build time, and `tools/build-site.mjs` emits a static gallery.

It has run out of room in five specific ways: contributing requires a pull request,
there is no search, an author is a string in a JSON file rather than an owner, the
`index.json` is a build artifact rather than an API, and both the compose file and the
docs are wired to one specific homelab so nobody else can run their own index.

v2 keeps what v1 got right — previews drawn by Pixel Agents' *own* renderer, and a
`layout.json` that stays byte-for-byte what Pixel Agents exported — and puts a real
platform around it.

## Decision 1: a static frontend plus a separately-hosted API

The frontend is hosted on **GitHub Pages**, with Vercel used only for per-pull-request
preview deployments.

Pages is static hosting. It cannot hold an OAuth client secret and it cannot open a
Postgres connection. So v2 is not "a web app" — it is a static SPA plus an API on a
different origin, and everything else follows from that:

- The Discord OAuth **code exchange happens on the API**, which is the only component
  that can hold the client secret.
- The session has to survive a **cross-origin boundary** between the Pages site and the
  API host. This was the hardest design problem in v2; [decision 10](#decision-10-session-mechanism--bearer-tokens-never-cookies)
  settles it — a bearer token held by the SPA, never a cookie, and records why the two
  cookie-based alternatives (a shared parent domain, `SameSite=None`) were rejected.
- **CORS is a product surface, not a detail.** The allowlist is configuration, so the
  official index and a self-hoster's domain are both just values.
- The site is only as available as the API it calls. Loading, empty and error states are
  first-class ([#12](https://github.com/NNTin/pixel-index/issues/12)) in a way a static
  site never had to consider.

**Rejected:**

- *Next.js on Vercel.* The natural fit for auth + SSR, and rejected because hosting on
  Pages was a requirement. Worth recording that this choice buys hosting simplicity and
  pays for it in auth complexity.
- *Server-rendered app on the API host.* Would collapse the origin boundary and make
  auth trivial, but gives up free static hosting and CDN delivery, and makes the
  frontend undeployable by anyone who only wants the gallery.

## Decision 2: one repository, npm workspaces

```
apps/web/              static SPA (Vite + React)          -> GitHub Pages
services/api/          Fastify + Postgres                 -> container
services/renderer/     Playwright + pinned pixel-agents   -> container
packages/layout-core/  validation, stats, schemas         -> shared library
seed/                  git-versioned starter layouts
docs/                  ADRs, deployment, API docs
vendor/pixel-agents/   pinned upstream (git submodule, build/render time only)
```

Three deployables share one contract — what a valid layout is — and that contract is
pinned to a specific upstream commit. Splitting them across repositories would mean
keeping three submodule pins in sync, and a version skew between the validator and the
renderer produces exactly the failure this project exists to prevent: an index that
accepts a layout Pixel Agents will silently discard.

npm workspaces, because the repo already uses plain npm and **upstream is itself an npm
workspace** (`"workspaces": ["server", "webview-ui"]`). No new tool to learn, and
`npm ci` at the root bootstraps everything.

**Rejected:** pnpm or Turborepo (real gains at a scale this repo is nowhere near, and a
second package manager alongside the submodule's npm is a footgun); separate
repositories (three pins to keep in lockstep).

Note `vendor/pixel-agents` is deliberately **not** a workspace member. It is a submodule
with its own lockfile, installed separately with `npm ci --prefix vendor/pixel-agents`.

## Decision 3: match upstream's stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5.9 | Upstream is TS throughout; the layout types are worth having |
| API framework | **Fastify 5** | Upstream already depends on `fastify`, `@fastify/cors`, `@fastify/static` |
| Frontend | **Vite 8 + React 19 + Tailwind 4** | Identical to `vendor/pixel-agents/webview-ui` |
| Tests | **vitest** | Upstream's runner, in both workspaces |
| Node | **>= 22** | Current LTS; upstream requires >= 20 |

This is a deliberate, slightly boring choice. Pixel Index exists in orbit of Pixel
Agents: contributors arrive from there, the renderer literally boots upstream's dev
server, and [#16](https://github.com/NNTin/pixel-index/issues/16) has to make the site
look like it belongs to the same product. A shared stack makes each of those cheaper.
Tailwind 4 in particular means design tokens can be lifted from upstream rather than
re-derived by eye.

**Rejected:** Express (Fastify's schema validation and lifecycle hooks map directly onto
what [#5](https://github.com/NNTin/pixel-index/issues/5) needs); Hono (good, but shares
nothing with upstream); NestJS (far more structure than a dozen endpoints justify).

## Decision 4: Postgres, host-agnostic, via Drizzle

One schema, forward-only SQL migrations, and a `DATABASE_URL` that is pure
configuration. The official index runs a managed Postgres; a self-hoster gets a
`postgres` service in `docker-compose.yml`. Same code, same migrations.

**Drizzle ORM + drizzle-kit** for access and migrations:

- Migrations are plain SQL files, reviewable in a pull request. Schema changes are the
  changes most worth reading carefully.
- No engine binary or codegen step, so the API container stays small and
  [#17](https://github.com/NNTin/pixel-index/issues/17)'s "clone and `docker compose up`"
  goal stays achievable.
- Types come from the schema, so the denormalised layout stats cannot drift from what
  `layout-core` computes.

**Rejected:** Prisma (better DX, but a query-engine binary in every image and less
control over the range and text-search queries [#14](https://github.com/NNTin/pixel-index/issues/14)
needs); raw `pg` with hand-rolled migrations (no type safety, and everyone rewrites the
migration runner badly once).

**Rejected data stores:** Supabase (would supply auth, storage and RLS in one move, but
self-hosting it is heavy and the requirement is that *anyone* can host an index);
SQLite (fine for one instance, but concurrent writes and text search push back later,
and it rules out managed hosting for the official index).

## Decision 5: the renderer is its own service

Previews are the most valuable thing this index shows, and their credibility comes
entirely from *how* they are made: Pixel Agents' own renderer draws them, so wall
autotiling, carpet marching-squares, per-tile colorize and z-sorting match what the user
will actually see.

That needs Chromium and the pinned upstream checkout, which rules out running it inside
the API container (which should stay small and horizontally scalable) and rules out any
static or serverless host. It is also the only component that takes attacker-controlled
JSON and runs a browser on it, so it deserves its own blast radius, its own concurrency
limit and its own resource ceiling.

**Rejected:** rendering in-process in the API (couples a small stateless service to a
400 MB browser image and one slow, memory-hungry operation); reimplementing the renderer
in a canvas library (guarantees drift from upstream — the exact failure v1 was designed
to make impossible); pre-rendering at build time as v1 does (incompatible with
submission, which must show a preview of a layout uploaded thirty seconds ago).

## Decision 6: post-moderation

Submissions publish immediately. Reports plus moderator takedown plus an append-only
audit log are the control, rather than an approval queue.

This is a deliberate trade against the risk that a tile grid can depict a hate symbol
and will be public until someone acts. It keeps contribution friction low, which is the
entire point of v2; it means the submission endpoint
([#8](https://github.com/NNTin/pixel-index/issues/8)) is the only thing between a
stranger and the front page, so rate limits and per-user caps belong there rather than
being deferred; and it makes the *report* queue, not the submission queue, the thing
moderators work.

Consequence worth writing down: "hidden" must mean hidden from **every** public read
path — list, detail, download and preview alike, including CDN caches. The half-done
version of this is the predictable bug.

**Rejected:** pre-moderation (safest, but every submission waits on a human and the
queue becomes permanent); trusted-author hybrid (a reasonable later evolution once
volume justifies trust levels, revocation and their edge cases).

## Decision 7: the database is the source of truth, but the seed is git-versioned

`layouts/` retires into `seed/`. Seed layouts are loaded on first boot when the layouts
table is empty, so a fresh install is never an empty page, and they stay reviewable as
files in a pull request.

Everything else lives in Postgres. Two write paths into one index would mean two
validation paths, two moderation paths, and a reconciliation problem nobody wants to
own.

**Rejected:** keeping `layouts/` as a parallel git contribution route (duplicates
validation and moderation indefinitely); dropping the seed entirely (a self-hoster's
first run would show an empty gallery, which reads as broken).

## Decision 8: configuration is environment, always

No hostname, domain or deployment-specific string is compiled into any component. The
frontend takes its API base URL as build-time config; the API takes `DATABASE_URL`,
`RENDERER_URL`, `PUBLIC_WEB_ORIGIN` and the Discord credentials from the environment and
validates them at boot, failing loudly.

Reverse-proxy configuration ships as **documentation with examples**, never as labels
baked into the default compose file — a self-hoster using Caddy should not have to
delete Traefik config to get started
([#17](https://github.com/NNTin/pixel-index/issues/17)).

## Decision 9: versioning and release

- **One repository version.** The three deployables are developed and released together;
  they share the layout contract and the upstream pin, so independent versioning would
  be fiction.
- **The public API is versioned separately**, under `/api/v1`, with a written
  deprecation policy ([#6](https://github.com/NNTin/pixel-index/issues/6)). Third-party
  integrators depend on the API surface, not on our release cadence.
- **Container images** are tagged with the git SHA on every build and with the semver tag
  on release, so a self-hoster can pin.
- **The frontend deploys continuously** from `main` to Pages; pull requests get a Vercel
  preview.
- **Bumping `vendor/pixel-agents` is a release-worthy event.** It can change the
  furniture catalog and the bundled `layoutRevision`, which can invalidate published
  layouts. It gets its own pull request and a re-validation of `seed/`.

## Decision 10: session mechanism — bearer tokens, never cookies

Decision 1 named the problem and deferred it: the frontend is a static SPA on GitHub
Pages, the API is a separately-hosted service, and the two are permanently different
origins for **every** deployment — the official index and any self-hoster's. Something
has to carry "who is logged in" across that boundary on every API call the SPA makes.

**Chosen: a bearer access token held by the SPA, refreshed via a bearer refresh token,
with tokens delivered to the SPA via a one-time code after a browser redirect through
Discord.** No cookie is ever used for the ongoing session.

The reasoning turns on a distinction that is easy to miss: **not every part of an OAuth
flow is cross-origin.** The transient `state`/PKCE handshake
(`GET /api/v1/auth/discord/login` → Discord → `GET /callback`) is three top-level browser
*navigations*, not `fetch()` calls — at every point a cookie is read, the API's own
origin is the top-level site the browser is sitting on, so an ordinary `SameSite=Lax`
cookie works exactly as well as it does for any single-site login form. That part was
never the hard problem. The hard problem is what happens *after*: every subsequent call
the SPA makes to the API (`GET /api/v1/me`, submitting a layout, moderating one) is a
`fetch()` from the frontend's origin to the API's origin — a genuinely cross-site
request, from the browser's privacy-partitioning point of view, no matter what
`SameSite` value the API's cookie uses. That is where the three options actually differ:

- **Cookie on a shared parent domain.** Would sidestep the third-party problem entirely
  by making the API and the frontend same-site. **Rejected**: it requires the official
  index and every self-hoster to put their frontend and API under one registrable
  domain, which most static+container hosting combinations (GitHub Pages plus any
  container platform) do not naturally give you. It would work beautifully for exactly
  the deployments that don't need it and constrain everyone else.
- **`SameSite=None; Secure` cookie.** The tempting, simplest-to-write option — and the
  one the issue explicitly warns is degrading. Safari's ITP already restricts this kind
  of cross-site cookie by default; the direction of travel across browsers is further
  restriction, not less. **Rejected**: building new, load-bearing auth in 2026 on a
  mechanism actively being deprecated in exactly the browsers real users have is
  building on sand.
- **Bearer token held by the SPA.** Sent explicitly via `Authorization: Bearer`, never
  attached automatically by the browser, so it is immune to third-party cookie policy by
  construction — there is no cookie for a browser to partition. **Chosen.**

The traded-away safety property is real and is spelled out rather than hand-waved: a
bearer token lives in JS-reachable memory, so an XSS bug on the frontend can steal it.
Mitigations, in order of how much they actually help: (1) the access token is
short-lived (`ACCESS_TOKEN_TTL_MS`, default 15 minutes) and never written to
`localStorage` — the frontend holds it in memory only, so a closed tab already discards
it; (2) the refresh token is opaque, DB-backed, and **rotated on every use**
(`auth_refresh_tokens.rotatedToId`) — presenting an already-rotated token is treated as
theft and revokes the entire token family, not just that one token
(`services/api/src/auth/sessions.ts`); (3) logout and a moderator's "block user" action
both revoke server-side immediately (`revokeSession`, `revokeAllSessionsForUser`), which
a cookie-based session gets for free but a bearer token needs to earn back explicitly.
It is worth being honest that XSS is close to game-over regardless of storage
mechanism — a page that can run arbitrary JS as the user can also just *use* the token
while it is live, whichever object it is sitting in — so the marginal defence
in-memory-over-localStorage buys is mostly about *persistence* after the JS stops
running, not about preventing the theft itself.

**Delivery, and why it is not "put the tokens in the /callback redirect":** `/callback`
is a top-level navigation landing on the API's own origin, where there is no frontend
JavaScript running to receive anything. Putting the real tokens in that redirect's query
string would leak them into browser history and any access log between the API and the
frontend. Instead `/callback` mints a single-use, 60-second code
(`auth_login_codes`) and redirects to the frontend with it in a **URL fragment**
(`#pixelIndexLoginCode=...`), which browsers never transmit to a server at all. The SPA
reads the fragment, immediately clears it from the address bar, and exchanges the code
for the real tokens over an ordinary `POST /api/v1/auth/token` — a CORS `fetch`
protected by the same origin allowlist as everything else, and the only place a bearer
token ever appears in a response body.

**CSRF** is mostly moot as a result: a malicious page cannot make a victim's browser
attach an `Authorization` header the way it can a cookie, and CORS blocks it from
reading the SPA's in-memory token or from completing a fetch that would need custom
headers against an unlisted origin anyway. The one place CSRF-shaped forgery is still
possible is the login *initiation* itself, which state existing for is the standard
defense: `/callback` checks the returned `state` against the value from the cookie set
at `/login`, and rejects a mismatch or a missing cookie outright
(`services/api/src/auth/routes.ts`).

**Roles and enforcement.** The access token embeds `role` so most requests need no
database hit — the explicit trade for that is staleness: a promotion, demotion or block
takes up to `ACCESS_TOKEN_TTL_MS` to reach a token already issued
(`services/api/src/auth/context.ts`). `rotateRefreshToken` closes the gap for the one
path that matters most for a *block*: refreshing re-checks `users.blockedAt` on every
call and revokes the whole family if it is set, so a blocked user cannot silently keep
minting fresh access tokens by refreshing through the staleness window. Every role check
is a server-side comparison (`requireRole`, a strict ladder — `admin` satisfies a
`moderator` check) against the token's verified claims; nothing about authorization is
ever decided in the frontend.

**Bootstrapping the first admin without SQL.** A self-hoster sets
`INITIAL_ADMIN_DISCORD_ID` to their own Discord user id. On every login matching that
id, `upsertDiscordUser` promotes the account to `admin` if it is not already
(`services/api/src/auth/users.ts`) — idempotent, no UI and no direct database access
required, matching the acceptance criterion exactly. The deliberate documented
alternative for someone who forgot to set it before their first login: `UPDATE users SET
role = 'admin' WHERE discord_id = '...'`, one statement, no migration.

## Migration order

v1 keeps working until v2 can replace it. Nothing is deleted before its replacement
exists, so the published index never goes dark mid-migration.

| v1 artifact | Fate | Owner | Status |
|---|---|---|---|
| `tools/validate.mjs`, validation half of `tools/lib/layouts.mjs` | become `packages/layout-core` | [#2](https://github.com/NNTin/pixel-index/issues/2) | done |
| `schema/*.json` | move into `packages/layout-core/schema/` | [#2](https://github.com/NNTin/pixel-index/issues/2) | done |
| `tools/lib/layouts.mjs` (disk discovery) | retires with `layouts/` | [#18](https://github.com/NNTin/pixel-index/issues/18) | pending |
| `tools/render-previews.mjs` | becomes `services/renderer` | [#4](https://github.com/NNTin/pixel-index/issues/4) | pending |
| `tools/build-site.mjs`, `.github/workflows/pages.yml` | replaced by `apps/web` | [#12](https://github.com/NNTin/pixel-index/issues/12) | pending |
| `tools/build-index.mjs`, `tools/serve.mjs`, `Dockerfile`, `nginx.conf` | deleted | [#18](https://github.com/NNTin/pixel-index/issues/18) | pending |
| `layouts/` | becomes `seed/` | [#18](https://github.com/NNTin/pixel-index/issues/18) | pending |

Deleting any of it now would take the published index offline before its replacement
exists. The new directories are created empty-but-resolvable so later issues have
somewhere to land without also having to invent the workspace.

## Consequences

**Good:** anyone can host an index; the public API is the same surface our own frontend
uses, which is the best guarantee it stays usable; previews keep their v1 credibility;
the stack is shared with upstream.

**Bad, and accepted:** auth is materially harder than it would be on a single origin;
there are now three deployables and a database to operate where there was one nginx
container; the renderer is a browser we run on user input, which is a permanent security
and cost consideration; and the pull-request contribution path goes away for people who
preferred it.

**Load-bearing properties inherited from v1**, which must not be lost in the rewrite:

- Stored `layout.json` stays **byte-for-byte** what Pixel Agents exported. It is the
  artifact people import; importing it must never surprise them.
- Pixel Agents **discards a stored layout whose `layoutRevision` is lower than the
  bundled default's** (`server/src/layoutPersistence.ts`), silently resetting the user's
  office. Publishing below the current revision is therefore a validation failure, not a
  warning.
- Previews are rendered by upstream's renderer via `page.route` interception of the
  default-layout fetch. Dispatching `layoutLoaded` after page load races the browser
  mock's own late dispatch and silently renders the *default* office instead.
