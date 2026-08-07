#!/usr/bin/env node
/**
 * Render a PNG preview of every layout using the real Pixel Agents renderer.
 *
 * Previews are never committed. They are generated here, written to dist/, and
 * published with the site, so they can never drift from the layouts or from the
 * pinned upstream.
 *
 * How it works: the upstream webview has a dev-mode "browser mock" that decodes
 * the bundled assets in the browser and feeds them to the app over the same
 * message path the real server uses. We run upstream's Vite dev server and
 * intercept the request for the bundled default layout, answering with the
 * layout being previewed. Everything on screen is then drawn by upstream's own
 * renderer — wall autotiling, carpet marching-squares, colorize, z-sorting — so
 * a preview cannot disagree with what a user will see.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import { chromium } from 'playwright';

import {
  DIST_DIR,
  UPSTREAM_ASSETS,
  UPSTREAM_DIR,
  readJsonOrNull,
  readLayouts,
  upstreamPin,
} from './lib/layouts.mjs';

const TILE_SIZE = 16;
// Upstream picks its zoom as Math.round(2 * devicePixelRatio), so at
// deviceScaleFactor 1 the office is drawn at 2 device-pixels per sprite pixel.
// Sizing the viewport with the same number keeps the office filling the frame.
const ZOOM = 2;
const MARGIN_TILES = 1;

// An element screenshot captures the page region, not the element in isolation,
// so the toolbars, connection badge and changelog toast drawn over the canvas
// would end up in the preview. Hide everything, then bring the canvas back.
const HIDE_CHROME_CSS = `
  body * { visibility: hidden !important; }
  canvas { visibility: visible !important; }
`;
const DEV_STARTUP_TIMEOUT_MS = 120_000;

const outDir = path.join(DIST_DIR, 'previews');

/** Vite rejects --port 0, so pick a free one ourselves. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The filename the browser mock fetches as "the" layout. */
function defaultLayoutFilename() {
  const index = readJsonOrNull(path.join(UPSTREAM_ASSETS, 'asset-index.json'));
  if (index?.defaultLayout) return index.defaultLayout;
  const candidates = fs
    .readdirSync(UPSTREAM_ASSETS)
    .filter((file) => /^default-layout(-\d+)?\.json$/.test(file))
    .sort();
  if (candidates.length === 0) {
    throw new Error('No default-layout JSON found in the pinned upstream assets.');
  }
  return candidates[candidates.length - 1];
}

async function startDevServer() {
  const webviewDir = path.join(UPSTREAM_DIR, 'webview-ui');
  if (!fs.existsSync(path.join(webviewDir, 'node_modules'))) {
    throw new Error(
      `Upstream dependencies are missing. Run:\n  (cd ${UPSTREAM_DIR} && npm ci)`,
    );
  }

  // Spawn the binary directly rather than through npx: npx re-parents the real
  // vite process, so SIGTERM would kill the wrapper and leave vite running —
  // and this script would then never exit. `detached` puts vite in its own
  // process group so it can be killed as a group, whatever it spawns.
  const viteBin = path.join(UPSTREAM_DIR, 'node_modules/.bin/vite');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Vite is missing. Run:\n  (cd ${UPSTREAM_DIR} && npm ci)`);
  }

  const port = await freePort();
  const child = spawn(viteBin, ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: webviewDir,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Vite dev server did not start in time')),
      DEV_STARTUP_TIMEOUT_MS,
    );
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+)\/?/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite dev server exited with code ${code}:\n${buffer}`));
    });
  });

  return { child, url };
}

function stopDevServer(child) {
  try {
    // Negative pid = the whole process group, so nothing is left behind
    // holding the port (or this process open).
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function main() {
  const layouts = readLayouts();
  if (layouts.length === 0) {
    console.error('No layouts found under layouts/.');
    process.exit(1);
  }

  const pin = upstreamPin();
  const defaultLayoutFile = defaultLayoutFilename();
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Rendering ${layouts.length} preview(s) with pixel-agents ${pin.version}…`);
  const { child, url } = await startDevServer();
  let browser;

  try {
    browser = await chromium.launch();
    for (const { slug, layout } of layouts) {
      const width = (layout.cols + MARGIN_TILES * 2) * TILE_SIZE * ZOOM;
      const height = (layout.rows + MARGIN_TILES * 2) * TILE_SIZE * ZOOM;

      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      // Turn on upstream's test hooks so we can wait on real render state
      // instead of sleeping and hoping.
      await context.addInitScript(() => {
        window.__PIXEL_AGENTS_E2E = true;
      });
      const page = await context.newPage();

      // Serve OUR layout where the mock asks for the bundled default. Dispatching
      // a layoutLoaded after page load instead would race the mock's own
      // dispatch, which lands late and would silently win — every preview would
      // then show the default office. Substituting the fetch removes the race:
      // the mock only ever sees one layout, and it is this one.
      await page.route(`**/assets/${defaultLayoutFile}`, (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(layout) }),
      );

      await page.goto(url, { waitUntil: 'load' });
      // The browser mock decodes every PNG in-page; the hooks appear once the
      // app has mounted.
      await page.waitForFunction(
        () => typeof window.__pixelAgentsTestHooks?.getFurnitureCount === 'function',
        null,
        { timeout: 60_000 },
      );

      // Wait for the office to actually hold this layout's furniture, so the
      // screenshot can never catch an empty or half-built office.
      const expected = layout.furniture?.length ?? 0;
      await page.waitForFunction(
        (count) => window.__pixelAgentsTestHooks?.getFurnitureCount?.() === count,
        expected,
        { timeout: 30_000 },
      );
      await page.addStyleTag({ content: HIDE_CHROME_CSS });
      // One more frame so the freshly built instances are painted.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

      // The office is drawn wherever the camera puts it on a viewport-sized
      // canvas, so a plain element screenshot is mostly empty space. Ask the
      // canvas which pixels it actually painted and clip to those.
      const clip = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < 0) return null;
        const rect = canvas.getBoundingClientRect();
        const scale = rect.width / canvas.width;
        return {
          x: rect.x + minX * scale,
          y: rect.y + minY * scale,
          width: (maxX - minX + 1) * scale,
          height: (maxY - minY + 1) * scale,
        };
      });

      const file = path.join(outDir, `${slug}.png`);
      if (clip) {
        await page.screenshot({ path: file, clip, animations: 'disabled' });
      } else {
        // Nothing painted — screenshot the canvas anyway so the failure is
        // visible in the gallery rather than silently missing.
        await page.locator('canvas').first().screenshot({ path: file, animations: 'disabled' });
      }
      await context.close();

      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log(`  ${slug.padEnd(20)} ${layout.cols}x${layout.rows}  ${kb} kB`);
    }
  } finally {
    await browser?.close();
    stopDevServer(child);
  }

  console.log(`\nWrote ${layouts.length} preview(s) to ${path.relative(process.cwd(), outDir)}/`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
