# Build the gallery, then serve it as static files.
#
# The build has to run a real browser: previews are rendered by Pixel Agents'
# own renderer rather than reimplemented, and they are never committed. That
# makes the image self-contained — the served site can never show a preview
# that disagrees with the layout next to it.

# Pin to the same Playwright version as package.json so the preinstalled
# browsers in this image match the client that drives them.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS builder

WORKDIR /app

# Index tooling first: it changes far less often than the layouts.
COPY package.json package-lock.json ./
RUN npm ci

# The pinned upstream supplies both the renderer and the asset catalog.
# `npm ci` needs the workspace manifests present before it will resolve.
COPY vendor/pixel-agents/package.json vendor/pixel-agents/package-lock.json ./vendor/pixel-agents/
COPY vendor/pixel-agents/server/package.json ./vendor/pixel-agents/server/
COPY vendor/pixel-agents/webview-ui/package.json ./vendor/pixel-agents/webview-ui/
RUN npm ci --prefix vendor/pixel-agents

COPY vendor/pixel-agents ./vendor/pixel-agents
COPY tools ./tools
COPY schema ./schema
COPY layouts ./layouts

RUN npm run build

FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
