#!/usr/bin/env node
/**
 * Serve dist/ locally so the gallery can be checked before it is deployed.
 * Nothing fancy: `npm run build && npm run serve`.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { DIST_DIR } from './lib/layouts.mjs';

const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('dist/ is empty. Run: npm run build');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = path.join(DIST_DIR, relative);

    // Never serve outside dist/, however creative the request path is.
    if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => console.log(`Serving dist/ at http://127.0.0.1:${PORT}/`));
