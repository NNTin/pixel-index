# The renderer: a browser we run on user input.
#
# It needs Chromium *and* the pinned upstream checkout, which is why it is its
# own service rather than living in the API container. Previews are drawn by
# Pixel Agents' own renderer, so the image carries upstream's webview and its
# dev dependencies — there is no way to make this small, only correct.
#
# Build context is the REPO ROOT, not this directory:
#   docker build -f services/renderer/Dockerfile .

# Pin to the same Playwright version as the workspace, so the preinstalled
# browsers in this image match the client that drives them.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS builder

WORKDIR /app

# Workspace manifests first: they change far less often than source.
COPY package.json package-lock.json ./
# Every workspace's tsconfig extends this, so `tsc` cannot run without it.
# Beside the manifests rather than with the source below: it changes about as
# often as they do, and the layer caching should reflect that.
COPY tsconfig.strict.json ./
COPY packages/layout-core/package.json ./packages/layout-core/
COPY services/renderer/package.json ./services/renderer/
RUN npm ci --workspace @pixel-index/layout-core --workspace @pixel-index/renderer --include-workspace-root

COPY packages/layout-core ./packages/layout-core
COPY services/renderer ./services/renderer
RUN npm run build --workspace @pixel-index/layout-core \
 && npm run build --workspace @pixel-index/renderer

# ── Runtime ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime

WORKDIR /app

RUN mkdir -p /var/cache/pixel-index-renderer /app \
 && chown pwuser:pwuser /var/cache/pixel-index-renderer /app

COPY --from=builder --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=builder --chown=pwuser:pwuser /app/package.json ./package.json
COPY --from=builder --chown=pwuser:pwuser /app/packages/layout-core ./packages/layout-core
COPY --from=builder --chown=pwuser:pwuser /app/services/renderer/dist ./services/renderer/dist
COPY --from=builder --chown=pwuser:pwuser /app/services/renderer/package.json ./services/renderer/package.json

# The pinned upstream supplies both the renderer and the asset catalog, and its
# webview dev dependencies are needed at *run* time because the service boots
# upstream's Vite dev server to draw with the real renderer.
#
# Ownership is set here, and the install runs as pwuser, because Vite writes
# beside its own config at startup: it bundles vite.config.ts to a
# `.timestamp-*.mjs` file in webview-ui/, and also caches optimised deps under
# node_modules/.vite. A root-owned tree gives EACCES and the dev server never
# starts. Doing it with --chown rather than a later `chown -R` avoids
# duplicating this whole tree into another layer.
COPY --chown=pwuser:pwuser vendor/pixel-agents ./vendor/pixel-agents

USER pwuser

# --include=dev is not optional here: Vite is one of upstream's devDependencies,
# and the service boots its dev server. Installing "production only" would omit
# the very thing this image exists to run.
RUN npm ci --prefix vendor/pixel-agents --include=dev

# Which upstream this is. The copied tree has no usable git linkage — the
# submodule's .git is a pointer to a gitdir outside the build context — and
# without a commit the preview cache key degrades to the upstream *version*,
# which the pin routinely outruns by several commits, so two builds would serve
# each other's cached previews. The pin therefore travels as this file, kept
# equal to the gitlink by `npm run vendor:commit` and enforced in CI. The
# service still warns at boot if it is somehow missing.
COPY --chown=pwuser:pwuser vendor/pixel-agents.commit ./vendor/pixel-agents.commit

# NODE_ENV is deliberately NOT set to production. Vite derives
# import.meta.env.DEV from it even when running the dev server, and upstream
# gates its browser mock on DEV — so production mode silently skips the mock and
# every render times out. devServer.ts forces development for the Vite child
# regardless, but setting it here too would be actively misleading.
ENV PIXEL_AGENTS_DIR=/app/vendor/pixel-agents \
    RENDERER_HOST=:: \
    RENDERER_PORT=3000 \
    RENDERER_CACHE_DIR=/var/cache/pixel-index-renderer

EXPOSE 3000

# Readiness, not liveness: this asserts the browser is actually connected. A
# check that always returns 200 is how a container stays in a load balancer
# while broken. 127.0.0.1 rather than localhost, because localhost resolves to
# ::1 first and a single-stack listener would fail a check it should pass.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Vite is spawned detached so it can be killed as a process group; the service
# installs SIGTERM/SIGINT handlers that close the browser and stop it. Run it as
# PID 1's child via an init so orphans are reaped if anything does escape.
STOPSIGNAL SIGTERM
CMD ["node", "services/renderer/dist/index.js"]
