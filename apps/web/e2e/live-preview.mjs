/**
 * Browser regression guard for the live layout-detail preview.
 *
 * This deliberately uses the default layout from the pinned Pixel Agents
 * checkout and the production Vite bundle. A vendor bump can compile while
 * still failing at runtime because decoded asset payloads, layout migration,
 * canvas setup, or upstream Tailwind classes changed. Driving the real iframe
 * in Chromium catches those integration failures before the pin is merged.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..');
const REPOSITORY_ROOT = path.resolve(WEB_ROOT, '../..');
const DIST = path.join(WEB_ROOT, 'dist');
const UPSTREAM_ASSETS = path.join(
  REPOSITORY_ROOT,
  'vendor/pixel-agents/webview-ui/public/assets',
);
const WEB_PORT = 4173;
const API_PORT = 4174;
const BASE_PATH = '/pixel-index/';
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const PAGE_URL = `${WEB_ORIGIN}${BASE_PATH}layouts/default`;
const SCREENSHOT = path.join(WEB_ROOT, 'test-results/live-preview-failure.png');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function pinnedDefaultLayout() {
  const candidates = fs
    .readdirSync(UPSTREAM_ASSETS)
    .map((filename) => {
      const match = /^default-layout(?:-(\d+))?\.json$/.exec(filename);
      return match ? { filename, revision: Number(match[1] ?? 0) } : null;
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.revision - left.revision);
  const newest = candidates[0];
  assert(newest, `No default layout found in ${UPSTREAM_ASSETS}.`);
  const source = fs.readFileSync(
    path.join(UPSTREAM_ASSETS, newest.filename),
    'utf8',
  );
  return { layout: JSON.parse(source), source };
}

function detailResponse(layout, source) {
  return {
    slug: 'default',
    title: 'Pinned Default Office',
    author: { id: null, username: 'pixel-agents', avatarUrl: null },
    description: 'The default layout from the pinned Pixel Agents checkout.',
    tags: ['default'],
    cols: layout.cols,
    rows: layout.rows,
    furniture: layout.furniture?.length ?? 0,
    areas: layout.areas?.length ?? 0,
    pets: layout.pets?.length ?? 0,
    carpets: layout.carpetTiles?.filter(Boolean).length ?? 0,
    layoutRevision: layout.layoutRevision ?? 0,
    pixelAgentsVersion: null,
    bytes: Buffer.byteLength(source),
    sha256: '0'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: {
      layout: '/api/v1/layouts/default/download',
      preview: '/api/v1/layouts/default/preview.png',
      thumbnail: '/api/v1/layouts/default/thumbnail.png',
    },
    layout,
  };
}

function sendJson(response, value) {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function mockApi(layout, source) {
  const detail = detailResponse(layout, source);
  return createServer((request, response) => {
    response.setHeader('access-control-allow-origin', WEB_ORIGIN);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    const pathname = new URL(request.url ?? '/', API_ORIGIN).pathname;
    if (pathname === '/api/v1/layouts/default') {
      sendJson(response, detail);
      return;
    }
    if (pathname === '/api/v1/layouts/default/download') {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(source);
      return;
    }
    if (
      pathname === '/api/v1/layouts/default/preview.png' ||
      pathname === '/api/v1/layouts/default/thumbnail.png'
    ) {
      response.statusCode = 200;
      response.setHeader('content-type', 'image/png');
      response.end(ONE_PIXEL_PNG);
      return;
    }
    if (pathname === '/api/v1/meta') {
      sendJson(response, {
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        pixelAgents: {
          version: null,
          commit: fs
            .readFileSync(
              path.join(REPOSITORY_ROOT, 'vendor/pixel-agents.commit'),
              'utf8',
            )
            .trim(),
          layoutRevision: layout.layoutRevision ?? 0,
        },
        count: 1,
      });
      return;
    }

    response.statusCode = 404;
    response.end('Not found');
  });
}

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

/** Serve dist/ at the same project subpath GitHub Pages uses in production. */
function staticWeb() {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', WEB_ORIGIN).pathname,
    );
    if (!pathname.startsWith(BASE_PATH)) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    const relative = pathname.slice(BASE_PATH.length);
    const candidate = path.resolve(DIST, relative || 'index.html');
    const insideDist =
      candidate === DIST || candidate.startsWith(`${DIST}${path.sep}`);
    if (
      insideDist &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      response.statusCode = 200;
      response.setHeader(
        'content-type',
        CONTENT_TYPES[path.extname(candidate)] ?? 'application/octet-stream',
      );
      response.end(fs.readFileSync(candidate));
      return;
    }

    // BrowserRouter routes fall back to the SPA. Requests for missing assets
    // stay 404 so the test cannot mistake index.html for a successful script.
    if (!path.extname(relative)) {
      response.statusCode = 200;
      response.setHeader('content-type', CONTENT_TYPES['.html']);
      response.end(fs.readFileSync(path.join(DIST, 'index.html')));
      return;
    }
    response.statusCode = 404;
    response.end('Not found');
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, ['run', 'build'], {
      cwd: WEB_ROOT,
      env: {
        ...process.env,
        VITE_API_BASE_URL: API_ORIGIN,
        VITE_BASE_PATH: BASE_PATH,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `The production web build failed (${signal ?? `exit ${code}`}).`,
          ),
        );
    });
  });
}

async function getLiveFrame(page) {
  const iframe = page.locator('iframe[title*="live Pixel Agents office"]');
  await iframe.waitFor({ state: 'visible' });
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  assert(frame, 'The live-office iframe did not attach a browsing context.');
  await frame.locator('canvas').waitFor({ state: 'visible' });
  return frame;
}

async function assertRenderedOffice(frame, expectedAgents) {
  await frame.waitForFunction(
    (count) =>
      document.querySelectorAll('[data-testid="agent-overlay"]').length ===
      count,
    expectedAgents,
  );
  await frame.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      canvas.width === 0 ||
      canvas.height === 0
    ) {
      return false;
    }
    const pixels = canvas
      .getContext('2d')
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return false;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0 && ++opaque >= 1_000) return true;
    }
    return false;
  });

  const overlays = await frame
    .locator('[data-testid="agent-overlay"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          activity: element.textContent ?? '',
          centerError: Math.abs(
            bounds.left +
              bounds.width / 2 -
              Number.parseFloat(element.style.left),
          ),
        };
      }),
    );
  for (const overlay of overlays) {
    assert(
      overlay.centerError <= 1.5,
      `An upstream activity panel is not centered on its agent (${overlay.centerError.toFixed(1)}px error).`,
    );
  }
  return overlays.map((overlay) => overlay.activity);
}

async function run() {
  const { layout, source } = pinnedDefaultLayout();
  await runBuild();

  const api = mockApi(layout, source);
  const web = staticWeb();
  let browser;
  let page;
  const runtimeErrors = [];

  try {
    await listen(api, API_PORT);
    await listen(web, WEB_PORT);

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    page = await context.newPage();
    page.on('pageerror', (error) =>
      runtimeErrors.push(`page error: ${error.message}`),
    );
    page.on('console', (message) => {
      if (message.type() === 'error')
        runtimeErrors.push(`console error: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? 'unknown';
      if (reason !== 'net::ERR_ABORTED') {
        runtimeErrors.push(`request failed: ${request.url()} (${reason})`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        runtimeErrors.push(`response ${response.status()}: ${response.url()}`);
      }
    });

    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Office preview' }).waitFor();
    let frame = await getLiveFrame(page);
    const activities = await assertRenderedOffice(frame, 3);
    for (const expected of [
      'Exploring the codebase',
      'Writing implementation',
      'Running the test suite',
    ]) {
      assert(
        activities.some((activity) => activity.includes(expected)),
        `Missing mock activity: ${expected}`,
      );
    }

    await page.getByRole('button', { name: 'Add mock agent' }).click();
    await page.getByText('4 mock agents', { exact: true }).waitFor();
    await assertRenderedOffice(frame, 4);

    await page.getByRole('button', { name: 'Remove mock agent' }).click();
    await page.getByText('3 mock agents', { exact: true }).waitFor();
    await assertRenderedOffice(frame, 3);

    await page.getByRole('button', { name: 'Thumbnail' }).click();
    await page
      .getByAltText('Pinned Default Office office layout thumbnail')
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Thumbnail' })
        .getAttribute('aria-pressed'),
      'true',
    );

    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page
        .getByRole('button', { name: 'Thumbnail' })
        .getAttribute('aria-pressed'),
      'true',
      'The thumbnail preference did not survive a reload.',
    );

    await page.getByRole('button', { name: 'Live' }).click();
    frame = await getLiveFrame(page);
    await assertRenderedOffice(frame, 3);

    assert.deepEqual(
      runtimeErrors,
      [],
      `Browser runtime failures:\n${runtimeErrors.join('\n')}`,
    );
    console.log(
      '✓ live preview rendered the pinned layout and passed browser interactions',
    );
  } catch (error) {
    if (page) {
      fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
      await page
        .screenshot({ path: SCREENSHOT, fullPage: true })
        .catch(() => {});
      console.error(`Failure screenshot: ${SCREENSHOT}`);
    }
    if (runtimeErrors.length > 0) console.error(runtimeErrors.join('\n'));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    web.closeAllConnections();
    await closeServer(web).catch(() => {});
    api.closeAllConnections();
    await closeServer(api).catch(() => {});
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
