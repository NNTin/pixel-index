# The API: config, CORS, health, rate limits, Discord auth (#7) and the
# public layout API (#6). No browser here — that is the renderer's job
# (services/renderer).
#
# Build context is the REPO ROOT, not this directory:
#   docker build -f services/api/Dockerfile \
#     --build-arg PIXEL_AGENTS_COMMIT=$(git -C vendor/pixel-agents rev-parse HEAD) .

FROM node:22-alpine AS builder

WORKDIR /app

# Workspace manifests first: they change far less often than source.
COPY package.json package-lock.json ./
COPY packages/layout-core/package.json ./packages/layout-core/
COPY services/api/package.json ./services/api/
RUN npm ci --workspace @pixel-index/layout-core --workspace @pixel-index/api --include-workspace-root

COPY packages/layout-core ./packages/layout-core
COPY services/api ./services/api
RUN npm run build --workspace @pixel-index/layout-core \
 && npm run build --workspace @pixel-index/api

# Drop devDependencies (drizzle-kit, tsx, typescript, vitest, PGlite …) —
# drizzle-kit never runs in production, and prod's own tree audits clean even
# though drizzle-kit's dev-only esbuild chain does not. See services/api/README.md.
RUN npm prune --omit=dev --workspace @pixel-index/layout-core --workspace @pixel-index/api

# ── Runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S pixelindex && adduser -S pixelindex -G pixelindex

COPY --from=builder --chown=pixelindex:pixelindex /app/node_modules ./node_modules
COPY --from=builder --chown=pixelindex:pixelindex /app/package.json ./package.json
COPY --from=builder --chown=pixelindex:pixelindex /app/packages/layout-core ./packages/layout-core
COPY --from=builder --chown=pixelindex:pixelindex /app/services/api/dist ./services/api/dist
COPY --from=builder --chown=pixelindex:pixelindex /app/services/api/package.json ./services/api/package.json
COPY --from=builder --chown=pixelindex:pixelindex /app/services/api/migrations ./services/api/migrations
COPY --chown=pixelindex:pixelindex services/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# GET /api/v1/meta (#6) reads the pinned upstream's version, bundled
# layoutRevision and (once #8 exists) furniture catalog via
# @pixel-index/layout-core. Only package.json and the asset JSON are needed —
# no node_modules, no webview source, unlike the renderer, which actually
# boots this checkout's dev server. That keeps this image a fraction of the
# renderer's size for the one piece of upstream metadata it actually reads.
COPY --chown=pixelindex:pixelindex vendor/pixel-agents/package.json ./vendor/pixel-agents/package.json
COPY --chown=pixelindex:pixelindex vendor/pixel-agents/webview-ui/public/assets ./vendor/pixel-agents/webview-ui/public/assets

# The copied vendor/ tree above has no .git, so upstreamPin() cannot read a
# commit itself — same trap as the renderer, same fix: pass it at build time.
ARG PIXEL_AGENTS_COMMIT=""
ENV PIXEL_AGENTS_COMMIT=${PIXEL_AGENTS_COMMIT} \
    PIXEL_AGENTS_DIR=/app/vendor/pixel-agents \
    API_HOST=:: \
    API_PORT=3000

USER pixelindex

EXPOSE 3000

# Readiness, not liveness: this asserts Postgres is actually reachable, so a
# database outage takes the API out of the load balancer rather than serving
# 503s from every route behind a "healthy" container. 127.0.0.1 rather than
# localhost, because localhost resolves to ::1 first and a single-stack
# listener would fail a check it should pass — the exact trap that took the
# v1 static site offline with a bare 404 and nothing in any log.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "services/api/dist/index.js"]
