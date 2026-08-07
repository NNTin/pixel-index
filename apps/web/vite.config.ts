import * as fs from 'node:fs';
import * as path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * GitHub Pages has no server-side rewrite rules, so a hard refresh (or a
 * shared link) on any deep route — `/layouts/some-office` — 404s before the
 * SPA's router ever runs. This writes a `404.html` that stashes the visitor's
 * intended URL and bounces them to the real app root; `index.html`'s own
 * inline script (see index.html) restores it via `history.replaceState`
 * before React Router mounts, so the visitor lands on the page they actually
 * asked for. Two-file version of https://github.com/rafgraph/spa-github-pages
 * — there is no nested path-segment stripping to get right here because the
 * whole intended URL round-trips through sessionStorage, not just a suffix.
 *
 * A no-op on Vercel and local dev: they DO have rewrite rules (or don't need
 * any), so this 404.html is simply never requested there.
 */
function ghPagesSpaFallback(): Plugin {
  let base = '/';
  let outDir = 'dist';
  return {
    name: 'gh-pages-spa-fallback',
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Pixel Index</title>
    <script>
      sessionStorage.redirect = location.href;
    </script>
    <meta http-equiv="refresh" content="0;url=${base}" />
  </head>
  <body></body>
</html>
`;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, '404.html'), html);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [tailwindcss(), react(), ghPagesSpaFallback()],
    // GitHub Pages project sites are served from a repo-name subpath
    // (https://<user>.github.io/<repo>/), which has to be baked into every
    // asset URL at build time — there is no way to detect it at runtime.
    // Vercel and local dev serve from the root, so this defaults to '/'.
    // Deliberately not hardcoded: a self-hoster forking this under a
    // different repo name needs a different value, set via VITE_BASE_PATH
    // at build time (see .github/workflows/pages.yml).
    base: env.VITE_BASE_PATH || '/',
    build: {
      outDir: 'dist',
    },
  };
});
