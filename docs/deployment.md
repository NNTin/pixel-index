# Deploying a self-hosted Pixel Index

`docker compose up` (see the root `docker-compose.yml` and `.env.example`) gets you a
complete, working index on `localhost` — Postgres, the API, the renderer, and the built
frontend, all talking to each other over the compose network. That's deliberately as far
as this repository's own config goes. Putting a real domain and TLS in front of it is a
separate step, covered here, because there's no one right way to do it — pick the
reverse proxy you already run, or none at all if `localhost`/a private network is enough
for your case. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for *why* there are two origins
to proxy in the first place — this doc only covers the *how*.

Start with **[Environment variables](#environment-variables)** below: it is the
authoritative list of what to set, where each value goes, and what shape it takes —
including the two hosted frontends (GitHub Pages, Vercel), which are configured outside
this repository entirely.

## Environment variables

Every deployment-specific string in this project — API hostname, web hostname, Discord
credentials — is configuration, never source. Nothing in this repository contains a real
hostname, and that is a constraint worth keeping: a fork should be deployable without
grepping anyone else's domain out of the code first.

The catch is that "configuration" means **three separate places**, and which one a
variable belongs in is decided entirely by *what reads it*:

| Where | What reads it | What it holds |
|---|---|---|
| **GitHub Actions variables** | `.github/workflows/pages.yml`, at build time | Two public build inputs for the GitHub Pages site. No secrets. |
| **Vercel project env vars** | Vercel's build container, at build time | One public build input, set per-environment. No secrets. |
| **The backend's `.env`** | `services/api` (and `docker-compose.yml`), at run time | Everything. All of the secrets live here and only here. |

### The thing to understand before setting anything

**The two hosted frontends are static files with no backend of their own.** GitHub Pages
and Vercel both build `apps/web` into a folder of HTML/JS and serve it. Neither can hold
a secret: a `VITE_`-prefixed variable is *inlined into the JavaScript bundle a visitor
downloads*, so anything you put there is public by construction. Vite enforces this by
only exposing `VITE_`-prefixed variables to client code in the first place.

So the Discord OAuth credentials do **not** go into GitHub or Vercel. There is no
GitHub-hosted or Vercel-hosted backend to use them. They go in the self-hosted API's
`.env`, next to the API that actually performs the OAuth exchange. The only thing the
hosted frontends need to know is *where that API lives*.

### (a) GitHub Actions — the Pages build

Set both at **Settings → Secrets and variables → Actions → Variables** (the
*Variables* tab, not *Secrets* — neither value is secret, and a secret would be masked
in logs for no benefit).

| Name | Required | Example shape | Notes |
|---|---|---|---|
| `PRODUCTION_API_BASE_URL` | Yes, for a working Pages site | `https://api.example.com` | Origin only, no trailing slash. Baked into the bundle as `VITE_API_BASE_URL`. Also read by `vendor-update.yml` — see below. |
| `PAGES_BASE_PATH` | No | `/` | Only when Pages serves this site from the **root**. Unset for any `/<repo>/` subpath, including under a user-site custom domain — see below. |
| `VENDOR_PREVIEW_BASE_URL` | No | `https://cdn.jsdelivr.net/gh/you/pixel-index@vendor-previews` | Where `vendor-update.yml` publishes candidate renders from. Defaults to `raw.githubusercontent.com` — see below. |

**Repository-level, not Environment-level.** `pages.yml`'s `build` job deliberately
declares no `environment:`, so environment-scoped variables are not in scope for it —
only repository (or organisation) variables are. Adding `environment: github-pages` to
the build job *would* bring the environment's variables into scope, but it also makes
GitHub record a second, meaningless deployment against `github-pages` alongside the real
one `actions/deploy-pages` creates, which muddies the environment's deployment history
for no gain. Neither value is secret, so there is nothing an Environment would protect
here. The `github-pages` Environment still exists and is still used — by the `deploy`
job, for the deployment record and its URL.

If `PRODUCTION_API_BASE_URL` is unset, the build still succeeds and the site still
loads; every API call then fails with the client's "Could not reach the API" message
rather than a blank page. That is intentional (#12), not a bug to work around.

**About `PAGES_BASE_PATH`.** A GitHub Pages *project* site is served from a repo-name
subpath — `https://<user>.github.io/pixel-index/` — and that prefix has to be compiled
into every asset URL at build time, because there is no way to detect it at runtime.
`pages.yml` defaults to `/${{ github.event.repository.name }}/`, which is correct for
`https://<user>.github.io/pixel-index/` today and stays correct through a rename.

**A custom domain does not automatically mean the root.** What decides it is *which*
Pages site the domain belongs to:

- A custom domain on your **user/org site** (`<user>.github.io`) leaves project sites on
  their subpath — `https://example.com/pixel-index/`. `github.io` URLs then 301 to it,
  which also means **the redirect target is the origin your API must allowlist**, not the
  `github.io` one. Keep `PAGES_BASE_PATH` unset here.
- A custom domain on **this repository's own** Pages site serves from the root —
  `https://example.com/`. Set `PAGES_BASE_PATH=/`, or the repo-name prefix 404s every
  asset.

If you are unsure which you have, load the deployed page and look at where the `<script
src>` points: `/pixel-index/assets/…` means keep the subpath, `/assets/…` means root.

**`VENDOR_UPDATE_TOKEN` — a repository *secret*, and the only one this repo has.** Without
it the vendor-update PR opens but arrives with **no checks at all**: GitHub never triggers
`pull_request` workflows for anything `GITHUB_TOKEN` creates, so `ci.yml` simply does not
run on the bot's PR. The gate's own verdict is unaffected — it runs inside the workflow,
not as a check on the PR — but nothing else is verified.

Create it as a **classic** PAT on a machine account that is a collaborator here
(`nntin-bot`), with the **`repo`** scope and nothing else. Not `workflow`: the PR's
`add-paths` never touches `.github/workflows`, and granting it would let the token rewrite
CI. A *fine-grained* token cannot be used for this — they do not work for collaborators on
a repository owned by another account, which is exactly what a machine account is here.

PATs expire. When this one does, the run pushes its branch and renders as usual and then
fails on the last step with a 401 or 403; the workflow prints both that possibility and
the settings one, so the log says which. Mint a replacement on the same account and re-set
the secret — nothing else changes.

**One repository setting `vendor-update.yml` cannot work without.** Settings → Actions →
General → Workflow permissions → **"Allow GitHub Actions to create and approve pull
requests"**. It is off by default, and without it the job pushes its branch and its
renders successfully and is then refused at the last step, with
`GitHub Actions is not permitted to create or approve pull requests`. The workflow
detects that specific failure and prints both the setting and a link to open the PR by
hand, so nothing is lost either way — but until it is enabled, every weekly run ends red
and needs a click. Nothing else in this repository needs the setting.

**`PRODUCTION_API_BASE_URL` has a second reader: `vendor-update.yml`.** The weekly job
that bumps the pinned Pixel Agents (#26) uses it to fetch every public layout from your
running index — `GET /api/v1/export/layouts.ndjson` — and render them against the
candidate pin, so the PR can say exactly which of *your* layouts a bump would break.
Leave it unset and the job still runs, but only over the committed `seed/` layouts: it
reports that it did so rather than passing silently on a corpus of four.

**About `VENDOR_PREVIEW_BASE_URL`.** That same job publishes the candidate renders it
already produced to an orphan branch, `vendor-previews`, force-pushed as a single commit
so old renders become unreachable and the repository does not grow a PNG set a week
forever. The PR's preview deployment then shows *those* pictures instead of the API's,
because the API is still on the old pin — without it, the one view where seeing a vendor
bump matters is the one view that cannot show it.

**The swap needs the API to report its pin.** It only engages when the site can prove the
API is on a *different* Pixel Agents than the renders were made with — otherwise it fails
safe and leaves previews on the API's own images, because a live image that might be
slightly stale beats a static one that is certainly stale. A current build reports its
commit with no configuration at all (see *The pinned commit ships as a file* below), so
this works out of the box; an API reporting `commit: null` is one that predates that and
needs redeploying. `vendor-update.yml` checks for exactly this and says so in the PR.

The default is `https://raw.githubusercontent.com/<owner>/<repo>/vendor-previews`, which
needs no configuration and is correct the moment the branch is pushed. A CDN in front is
faster, but pick one that can serve a *newly pushed* path immediately: jsDelivr caches
branch refs for hours, so `…@vendor-previews/<sha>/` may 404 for a while after the job
runs, which reads as "the preview is broken" rather than "the CDN is warming up". Set
this only if you have a CDN without that behaviour. Nothing here is secret — the branch
is as public as the repository.

### (b) Vercel — Production and Preview

The Vercel project's **Root Directory must be `apps/web`** (that is where `vercel.json`
lives, and its `installCommand`/`buildCommand` reach back up to the monorepo root).

| Name | Required | Example shape | Set for |
|---|---|---|---|
| `VITE_API_BASE_URL` | Yes | `https://api.example.com` | Production, Preview (and Development if you use `vercel dev`) |

Do **not** set `VITE_BASE_PATH` on Vercel — it serves from the root, and `vercel.json`'s
rewrite already handles deep links.

**This cannot live in `vercel.json`.** Two reasons, either one sufficient: `vercel.json`
has no supported way to vary a value between the Production and Preview environments,
and it is a committed file, so putting a real API hostname in it would drop the exact
domain reference this project keeps out of its source. Set it in the dashboard
(**Project → Settings → Environment Variables**), or with the CLI:

```bash
vercel env add VITE_API_BASE_URL production   # then paste the value when prompted
vercel env add VITE_API_BASE_URL preview
```

Vercel bakes env vars in at build time, so changing one requires a **redeploy** —
existing deployments keep the old value. Use "Redeploy" without the build cache.

**Preview deploys need one thing from the backend.** Every Vercel PR preview gets a
fresh hostname (`https://<project>-<build-hash>-<team>.vercel.app`), so there is no
exact origin to put in the API's `PUBLIC_WEB_ORIGIN` and credentialed calls from a
preview fail CORS. That is what `PUBLIC_WEB_ORIGIN_PATTERNS` in the backend `.env`
is for — see below.

### (c) The self-hosted backend — `.env`

Copy `.env.example` to `.env` (gitignored) and fill it in. `docker-compose.yml` reads
it, and fails the container start with a named message for anything required that is
missing. `services/api` re-validates at boot and reports *every* problem at once rather
than one restart per missing value.

| Name | Required | Example shape | Notes |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | No | `pixel_index` | Defaults are fine. |
| `POSTGRES_PASSWORD` | **Yes** | *(random string)* | Compose refuses to start without it. |
| `RENDERER_URL` | No | `http://renderer:3000` | The compose-network default. |
| `PUBLIC_WEB_ORIGIN` | **Yes** | `https://gallery.example.com` | Comma-separated for several. Origin only — scheme + host + optional port, **no path, no trailing slash**. This is the CORS allowlist *and* the OAuth `returnTo` allowlist. |
| `PUBLIC_WEB_ORIGIN_PATTERNS` | No | `https://my-project-*-my-team.vercel.app` | Opt-in wildcard for per-deploy preview hostnames. See below. |
| `PUBLIC_API_ORIGIN` | **Yes** | `https://api.example.com` | This API's own public origin. Origin only. Must match the Discord Developer Portal exactly — see the Discord section. |
| `DISCORD_CLIENT_ID` | **Yes** | `1234567890123456789` | Public, but it lives here because the API is what uses it. |
| `DISCORD_CLIENT_SECRET` | **Yes** | *(from the Developer Portal)* | **Secret.** Never in GitHub, never in Vercel, never in a `VITE_` variable. |
| `SESSION_SECRET` | **Yes** | 32+ chars, `openssl rand -base64 48` | **Secret.** Signs access tokens and the OAuth state cookie. Rejected below 32 characters. |
| `INITIAL_ADMIN_DISCORD_ID` | No | `999888777666555444` | Your own Discord user id, promoted to `admin` on your next login. Unset it once you have an admin. |
| `VITE_API_BASE_URL` | Only if you build the `web` image | `https://api.example.com` | **Build-time**, baked into the bundle by `apps/web/Dockerfile`. `docker compose build web` after a change — restarting is not enough. |
| `API_TRUST_PROXY` | No (`true` by default in the app) | `true` | Compose ships `false`. Flip it to `true` the moment a reverse proxy is in front — see above. |
| `WEB_PORT` / `API_PORT_HOST` | No | `8080` / `3000` | Host ports. |

Tuning knobs with working defaults you can usually ignore: `API_HOST`, `API_PORT`,
`LOG_LEVEL`, `API_BODY_LIMIT_BYTES`, `MAX_LAYOUT_BYTES`,
`MAX_SUBMISSIONS_PER_USER_PER_DAY`, `RATE_LIMIT_*`, `ACCESS_TOKEN_TTL_MS`,
`REFRESH_TOKEN_TTL_MS`, `LOGIN_CODE_TTL_MS`, `PIXEL_AGENTS_DIR`.
`services/api/src/config.ts` is the authoritative list.

### The pinned commit ships as a file

Nothing to configure — this is here because it used to be a variable, and because the
failure it causes is quiet.

A container cannot work out which Pixel Agents it holds. `vendor/pixel-agents/.git` is a
*pointer* to a gitdir outside the Docker build context (under a git worktree, an absolute
path on the build machine), so a copied vendor tree can never resolve its own commit
however much of it you copy. Without that commit the renderer's preview cache key falls
back to the upstream *version*, which the pin routinely outruns by several commits — two
different builds then serve each other's cached previews — and `/api/v1/meta` cannot say
which upstream the index is actually serving.

This was once a `PIXEL_AGENTS_COMMIT` build argument. Nobody passed it, so every deployed
image reported `commit: null`. The pin now travels as `vendor/pixel-agents.commit`, copied
into both images, kept equal to the gitlink by `npm run vendor:commit`, updated by the
vendor-update workflow in the same commit as the bump, and verified on every CI run by
`npm run vendor:commit:check` so it cannot drift from the pin it claims to describe.

#### `PUBLIC_WEB_ORIGIN_PATTERNS`, and its trade-off

`PUBLIC_WEB_ORIGIN` takes exact origins only, on purpose. But a Vercel PR preview's
hostname is minted per deploy and cannot be enumerated in advance, so previews of this
repo's frontend get no CORS access and no working login. This variable is the opt-in
escape hatch:

```
PUBLIC_WEB_ORIGIN_PATTERNS=https://my-project-*-my-team.vercel.app
```

Validated at boot, and deliberately narrow:

- **https only.** A credentialed wildcard over cleartext is not defensible.
- **Exactly one `*` per pattern**, and it never crosses a dot — it stands in for part of
  a single hostname label. `https://app-*.example.com` can therefore never match
  `https://app-x.evil.example.com`.
- **Whole-label wildcards are rejected.** `https://*.vercel.app` fails at boot, because
  it would grant credentialed access to every project on a shared platform domain.

The residual risk, stated plainly: **anyone who can deploy a hostname matching your
pattern gets the same credentialed access your own previews do.** On a shared platform
domain like `vercel.app`, pin as much literal text as you can — critically your *team
slug*, which a stranger cannot mint under your project's name. If you would rather not
take the trade-off at all, leave it unset: previews then work read-only against a public
API, or you point previews at a separate staging API whose exact origin you *can* list.

Comma-separate for more than one. Both the CORS check and the OAuth redirect allowlist
consult it, so login from a preview works end to end rather than redirecting
successfully and then failing on the first API call.

#### Discord OAuth (#21)

The API performs a standard Discord OAuth2 authorization-code flow with PKCE, requesting
the `identify` scope only. Four variables drive it, all in the backend `.env`:

`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_API_ORIGIN`, `SESSION_SECRET`
(plus optional `INITIAL_ADMIN_DISCORD_ID`).

The one that bites people: **the redirect URI is always `${PUBLIC_API_ORIGIN}/callback`**
— derived from config, never from request input — and Discord matches it byte-for-byte
against what you registered. If `PUBLIC_API_ORIGIN` is `https://api.example.com`, then
`https://api.example.com/callback` must be listed under **Redirects** in the Discord
Developer Portal, with no trailing slash and the same scheme. A mismatch surfaces as
Discord's own `invalid_request` error page before your API is ever reached. Registering
several redirect URIs is fine, so a staging API can coexist with production.

Roles, guild membership and the moderation gating described in #21 are **not
implemented**. User roles today live in this project's own database
(`INITIAL_ADMIN_DISCORD_ID` bootstraps the first admin); nothing reads Discord guilds or
Discord roles. A future integration would need something like a guild id, a bot token, an
invite URL and role ids — those are named here so the shape is known, but they are
**deliberately not wired into `config.ts`**: an accepted-but-unused variable reads as a
feature that exists, and silently does nothing. They will be added with the feature that
reads them.

## Setup checklist

Everything below has to be done by the repository owner in a web UI or with an
authenticated CLI — none of it can be committed.

**1. GitHub — Actions variables** (Settings → Secrets and variables → Actions → Variables)

```bash
gh variable set PRODUCTION_API_BASE_URL --body "https://api.example.com"
# Only if Pages serves this site from the ROOT (skip for any /<repo>/ subpath —
# including under a custom domain on your user site, which keeps the subpath):
gh variable set PAGES_BASE_PATH --body "/"
gh variable list   # verify
```

No GitHub *secret* is needed for either deployment. No new Environment is needed either:
`github-pages` already exists and is used by the `deploy` job; `Preview` and `Production`
are Vercel's own and hold nothing this build reads.

**2. Vercel** (Project → Settings → Environment Variables; Root Directory must be `apps/web`)

```bash
vercel env add VITE_API_BASE_URL production
vercel env add VITE_API_BASE_URL preview
# Then redeploy — env vars are baked in at build time.
```

**3. The backend host** — `cp .env.example .env`, then fill in:

```bash
POSTGRES_PASSWORD=...                 # any strong random string
PUBLIC_WEB_ORIGIN=https://gallery.example.com,https://<user>.github.io
PUBLIC_API_ORIGIN=https://api.example.com
DISCORD_CLIENT_ID=...                 # Discord Developer Portal → OAuth2
DISCORD_CLIENT_SECRET=...
SESSION_SECRET=$(openssl rand -base64 48)
INITIAL_ADMIN_DISCORD_ID=...          # your own Discord user id
VITE_API_BASE_URL=https://api.example.com
API_TRUST_PROXY=true                  # once a reverse proxy is in front
# Only if you want Vercel PR previews to work with credentials:
PUBLIC_WEB_ORIGIN_PATTERNS=https://my-project-*-my-team.vercel.app
```

then `docker compose up --build -d`.

**4. Discord Developer Portal** — under OAuth2 → Redirects, add
`${PUBLIC_API_ORIGIN}/callback` exactly (e.g. `https://api.example.com/callback`).

**5. Verify.** `curl https://api.example.com/health`; open the Pages and Vercel sites and
confirm layouts load; click through a Discord login. A CORS failure in the browser
console means the origin you are *browsing from* is missing from `PUBLIC_WEB_ORIGIN` (or
from `PUBLIC_WEB_ORIGIN_PATTERNS`, for a preview) — the API must be restarted after
changing either.

Note that a GitHub Pages site (`https://<user>.github.io`) and a custom-domain site are
**different origins**, and both must be listed in `PUBLIC_WEB_ORIGIN` if you want both to
work. The origin is the host only — `https://<user>.github.io`, never
`https://<user>.github.io/pixel-index`.

**Allowlist the origin the browser actually ends up on.** If a custom domain is
configured, GitHub 301-redirects `github.io` URLs to it, so the page runs — and sends its
`Origin` header — under the custom domain. Allowlisting only the `github.io` host in that
setup looks correct and never matches anything, because that host only ever redirects. A
one-liner that tells you exactly which host to list:

```bash
curl -sL -o /dev/null -w '%{url_effective}\n' https://<user>.github.io/pixel-index/
```

The same applies to any other redirect in front of the site.

## What you're actually proxying

Two origins, both plain HTTP inside the compose network:

| Service | Compose port | What it needs from a proxy |
|---|---|---|
| `web` | `${WEB_PORT:-8080}` | TLS termination. Nothing else — it's static files. |
| `api` | `${API_PORT_HOST:-3000}` | TLS termination, and **`X-Forwarded-For`** set correctly (see below). |

`renderer` has no exposed port and needs no proxy entry — it isn't reachable from
outside the compose network at all (see `services/api/README.md`'s note on
`preview-check` for why).

Whatever domains you put in front of `web` and `api`, update `.env`'s
`PUBLIC_WEB_ORIGIN` and `PUBLIC_API_ORIGIN` to match exactly (scheme + host, no path, no
trailing slash) and rebuild (`docker compose up --build`) — these are baked into CORS's
allowlist and the frontend's build-time API base URL, not read at request time.

### Set `API_TRUST_PROXY=true` once you add one

`docker-compose.yml` ships `API_TRUST_PROXY=false` because, with no proxy in front, the
API only ever sees the real client IP directly. The moment you put a reverse proxy in
front of it, flip this to `true` in `.env` — otherwise rate limiting keys on the proxy's
IP, and every client behind it shares one bucket.

### The gotcha that costs real debugging time: `localhost` inside a container is IPv6

Every health check in this repo's images probes `127.0.0.1`, never `localhost` —
`localhost` resolves to `::1` first inside a container, and a listener bound to IPv4
only then fails a check it should pass, the container gets marked unhealthy, and a
reverse proxy quietly drops it from rotation with nothing more informative than a bare
404 in the browser and nothing in any application log (the request never reached the
app). If you write your own health check probing this stack from outside — or bind your
proxy's upstream by hostname rather than an explicit address — keep this in mind.

## Traefik

```yaml
services:
  web:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pixel-index-web.rule=Host(`gallery.example.com`)"
      - "traefik.http.routers.pixel-index-web.entrypoints=websecure"
      - "traefik.http.routers.pixel-index-web.tls.certresolver=letsencrypt"
      - "traefik.http.services.pixel-index-web.loadbalancer.server.port=80"

  api:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pixel-index-api.rule=Host(`api.example.com`)"
      - "traefik.http.routers.pixel-index-api.entrypoints=websecure"
      - "traefik.http.routers.pixel-index-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.pixel-index-api.loadbalancer.server.port=3000"
```

Add these under the matching service in your own compose override (or merge into
`docker-compose.yml` directly) — they're deliberately not in the shipped file, so
running Caddy or nginx instead doesn't mean deleting Traefik config first. Both services
need to be on whatever network your Traefik instance watches; add it under each
service's `networks:` and to the top-level `networks:` block as `external: true`.

## Caddy

A `Caddyfile` alongside (not replacing) this repo's compose file:

```
gallery.example.com {
    reverse_proxy web:80
}

api.example.com {
    reverse_proxy api:3000
}
```

Caddy handles TLS (via Let's Encrypt) with no further config. Run it as its own compose
service on the same network as `web`/`api`, or as a separate process on the host if
you've exposed `WEB_PORT`/`API_PORT_HOST` there.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name gallery.example.com;
    # ssl_certificate / ssl_certificate_key — your own TLS setup.

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}

server {
    listen 443 ssl;
    server_name api.example.com;
    # ssl_certificate / ssl_certificate_key — your own TLS setup.

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        # Required once API_TRUST_PROXY=true (see above) — without this the
        # API's rate limiter keys on nginx's own IP for every client.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Assumes nginx runs on the host (not in the compose network) talking to the ports
`WEB_PORT`/`API_PORT_HOST` expose — adjust `proxy_pass` to the container's compose
network address if you run nginx as its own service instead.

## No reverse proxy at all

Perfectly reasonable for a private network or `localhost`-only use: just leave
`PUBLIC_WEB_ORIGIN`/`PUBLIC_API_ORIGIN` as `http://` origins pointing at wherever you've
exposed the ports, skip Discord login entirely (it needs a real, stable origin
Discord's OAuth redirect can reach), and browse read-only.

## Where the official index runs

That's a deployment decision outside this repository, not a default this config
encodes — this document (and `docker-compose.yml`) is written so any of the above (or
none of them) works equally well, with no homelab-specific assumption baked in.
