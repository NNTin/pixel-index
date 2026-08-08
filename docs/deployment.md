# Deploying a self-hosted Pixel Index

`docker compose up` (see the root `docker-compose.yml` and `.env.example`) gets you a
complete, working index on `localhost` — Postgres, the API, the renderer, and the built
frontend, all talking to each other over the compose network. That's deliberately as far
as this repository's own config goes. Putting a real domain and TLS in front of it is a
separate step, covered here, because there's no one right way to do it — pick the
reverse proxy you already run, or none at all if `localhost`/a private network is enough
for your case.

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
