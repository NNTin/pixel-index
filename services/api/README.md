# @pixel-index/api

Fastify 5 over Postgres. Holds everything the static frontend cannot: the Discord client
secret, the database connection, and every authorization decision.

## Status

Skeleton. Delivered across:

| Issue | Scope |
|---|---|
| [#5](https://github.com/NNTin/pixel-index/issues/5) | service skeleton: config, CORS, health, error envelope, rate limits |
| [#6](https://github.com/NNTin/pixel-index/issues/6) | public layout API v1 + OpenAPI — the third-party contract |
| [#7](https://github.com/NNTin/pixel-index/issues/7) | Discord OAuth, sessions, roles |
| [#8](https://github.com/NNTin/pixel-index/issues/8) | submission: validate, dedupe, render, publish |
| [#9](https://github.com/NNTin/pixel-index/issues/9) | owner self-service |
| [#10](https://github.com/NNTin/pixel-index/issues/10) | reports, moderation, audit log |

Schema and migrations live alongside, from
[#3](https://github.com/NNTin/pixel-index/issues/3).

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

## Configuration

Environment only, validated at boot, failing loudly on anything missing. No hostname or
domain is ever compiled in — see
[ADR 0001, decision 8](../../docs/adr/0001-v2-architecture.md).
