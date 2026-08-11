/**
 * The real thing: a browser, upstream's dev server, and actual PNGs.
 *
 * Slow (a Vite boot plus a Chromium launch), so it is excluded from the default
 * `npm test` and run by `npm run test:integration`. It is the only place that
 * exercises a real render rather than a stub — determinism, concurrency limits,
 * timeouts, cache behaviour, and the HTTP surface, all against actual output.
 *
 * Used to also assert byte-parity against the v1 static build script's own
 * renders (`tools/render-previews.mjs`) — removed in #18 along with that
 * script, since there is no v1 output left to diff against once it's gone.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Layout, sha256, upstreamPin } from '@pixel-index/layout-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cacheKey, PreviewCache } from './cache.js';
import { loadConfig } from './config.js';
import { type DevServer, startDevServer } from './devServer.js';
import { Renderer, RenderTimeoutError } from './render.js';
import { buildServer, type ReadyBody, type RenderErrorBody } from './server.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SEED_DIR = path.join(REPO_ROOT, 'seed');

const BOOT_TIMEOUT = 240_000;
const RENDER_TIMEOUT = 120_000;

const slugs = fs
  .readdirSync(SEED_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * The `as Layout` is the unavoidable one: JSON.parse returns `any`. The seed
 * layouts are the same files `npm run validate` checks in CI, so by the time
 * this suite runs they really do have this shape.
 */
const readLayout = (slug: string): Layout =>
  JSON.parse(fs.readFileSync(path.join(SEED_DIR, slug, 'layout.json'), 'utf-8')) as Layout;

// `| undefined` because beforeAll boots a real browser and can fail: afterAll
// then has to tear down whatever did come up without throwing a second error
// over the first. Reading them through the accessors below keeps that honest
// rather than declaring them non-optional and hoping.
let devServer: DevServer | undefined;
let renderer: Renderer | undefined;

function activeRenderer(): Renderer {
  if (!renderer) throw new Error('the renderer did not start');
  return renderer;
}

beforeAll(async () => {
  devServer = await startDevServer();
  renderer = new Renderer({ devServer, concurrency: 2, defaultTimeoutMs: RENDER_TIMEOUT });
  await renderer.start();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await renderer?.close();
  devServer?.stop();
  renderer = undefined;
  devServer = undefined;
});

describe('rendering', () => {
  it(
    'produces a PNG',
    async () => {
      const png = await activeRenderer().render(readLayout('four-rooms'));
      // PNG magic, so a failure here is "not an image" rather than "wrong image".
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.length).toBeGreaterThan(1000);
    },
    RENDER_TIMEOUT,
  );

  it(
    'renders the layout it was given, not the bundled default',
    async () => {
      // The failure this guards is silent: dispatching layoutLoaded after load
      // races the browser mock's own late dispatch, and the default office
      // renders instead. Two different layouts must not produce one image.
      const [a, b] = await Promise.all([
        activeRenderer().render(readLayout('four-rooms')),
        activeRenderer().render(readLayout('severance-office')),
      ]);
      expect(sha256(a)).not.toBe(sha256(b));
    },
    RENDER_TIMEOUT,
  );

  it(
    'is deterministic — the same layout twice gives the same bytes',
    async () => {
      const layout = readLayout('default');
      const first = await activeRenderer().render(layout);
      const second = await activeRenderer().render(layout);
      expect(sha256(first)).toBe(sha256(second));
    },
    RENDER_TIMEOUT,
  );

  it(
    'scales the image down by exactly the requested factor',
    async () => {
      // The contract is *dimensions*, not bytes. Halving pixel art destroys the
      // long runs of identical pixels that PNG's filters exploit, so a 0.5
      // thumbnail is measurably LARGER on disk than the full image for every
      // layout in the index (+1% to +9%). Only 0.25 actually saves bytes
      // (~57%). See the README — #13 should pick 0.25 knowingly.
      const layout = readLayout('severance-office');
      const full = await activeRenderer().render(layout, { scale: 1 });
      const half = await activeRenderer().render(layout, { scale: 0.5 });
      const quarter = await activeRenderer().render(layout, { scale: 0.25 });

      // Annotated as a tuple: inferred as `number[]`, destructuring it gives
      // `number | undefined` under noUncheckedIndexedAccess, which is what the
      // four assertions here used to answer.
      const dimensions = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];
      const [fullWidth, fullHeight] = dimensions(full);

      expect(dimensions(half)).toEqual([fullWidth / 2, fullHeight / 2]);
      expect(dimensions(quarter)).toEqual([fullWidth / 4, fullHeight / 4]);
      expect(quarter.length).toBeLessThan(full.length);
      expect(quarter.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    },
    RENDER_TIMEOUT,
  );

  it(
    'enforces the timeout',
    async () => {
      await expect(activeRenderer().render(readLayout('blue-office'), { timeoutMs: 1 })).rejects.toThrow(
        RenderTimeoutError,
      );
    },
    RENDER_TIMEOUT,
  );

  it(
    'never exceeds its concurrency limit',
    async () => {
      let peak = 0;
      const layouts = slugs.map(readLayout);
      const watcher = setInterval(() => {
        peak = Math.max(peak, activeRenderer().inFlight);
      }, 5);
      try {
        await Promise.all(layouts.map((layout) => activeRenderer().render(layout)));
      } finally {
        clearInterval(watcher);
      }
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(2);
    },
    RENDER_TIMEOUT,
  );
});

describe('the HTTP surface', () => {
  it(
    'renders, caches, and reports which happened',
    async () => {
      const config = {
        ...loadConfig(),
        // os.tmpdir(), not a repo-relative dist/ — that directory was only
        // ever guaranteed to exist because the v1 build pipeline created it;
        // #18 removed that pipeline, so nothing creates dist/ anymore.
        cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-index-render-cache-test-')),
      };
      const cache = new PreviewCache(config.cacheDir, config.cacheMaxEntries);
      await cache.init();
      const app = await buildServer({ config, renderer: activeRenderer(), cache });

      try {
        const layout = readLayout('four-rooms');

        const miss = await app.inject({ method: 'POST', url: '/render', payload: { layout } });
        expect(miss.statusCode).toBe(200);
        expect(miss.headers['content-type']).toBe('image/png');
        expect(miss.headers['x-render-cache']).toBe('miss');

        const hit = await app.inject({ method: 'POST', url: '/render', payload: { layout } });
        expect(hit.statusCode).toBe(200);
        expect(hit.headers['x-render-cache']).toBe('hit');
        // A cache hit must be the same image, not merely a fast one.
        expect(sha256(hit.rawPayload)).toBe(sha256(miss.rawPayload));
        expect(hit.headers.etag).toBe(miss.headers.etag);
      } finally {
        await app.close();
        fs.rmSync(config.cacheDir, { recursive: true, force: true });
      }
    },
    RENDER_TIMEOUT,
  );

  it(
    'rejects an invalid layout with 422 before rendering anything',
    async () => {
      const config = { ...loadConfig(), cacheMaxEntries: 0 };
      const app = await buildServer({
        config,
        renderer: activeRenderer(),
        cache: new PreviewCache(config.cacheDir, 0),
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/render',
          payload: { layout: { version: 1, cols: 2, rows: 2, tiles: [0], furniture: [] } },
        });
        expect(response.statusCode).toBe(422);
        const body = response.json<RenderErrorBody>();
        expect(body.error).toBe('invalid_layout');
        expect(body.issues?.map((issue) => issue.code)).toContain('layout.grid.tiles_mismatch');
      } finally {
        await app.close();
      }
    },
    RENDER_TIMEOUT,
  );

  it(
    'rejects an unsupported scale',
    async () => {
      const config = loadConfig();
      const app = await buildServer({
        config,
        renderer: activeRenderer(),
        cache: new PreviewCache(config.cacheDir, 0),
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/render',
          payload: { layout: readLayout('default'), scale: 3 },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<RenderErrorBody>().error).toBe('invalid_scale');
      } finally {
        await app.close();
      }
    },
    RENDER_TIMEOUT,
  );

  it(
    'reports readiness only while the browser is connected',
    async () => {
      const config = loadConfig();
      const app = await buildServer({
        config,
        renderer: activeRenderer(),
        cache: new PreviewCache(config.cacheDir, 0),
      });
      try {
        const ready = await app.inject({ method: 'GET', url: '/ready' });
        expect(ready.statusCode).toBe(200);
        expect(ready.json<ReadyBody>().pixelAgents.version).toBe(upstreamPin().version);

        const health = await app.inject({ method: 'GET', url: '/health' });
        expect(health.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    },
    RENDER_TIMEOUT,
  );
});

describe('cache keys', () => {
  it('change with the upstream pin', () => {
    // Bumping vendor/pixel-agents can change what a layout looks like, so a key
    // that ignored the pin would serve last release's preview forever.
    const base = { layoutBytes: '{"a":1}', upstreamVersion: '1.4.0', scale: 1 };
    expect(cacheKey({ ...base, upstreamCommit: 'aaa' })).not.toBe(
      cacheKey({ ...base, upstreamCommit: 'bbb' }),
    );
  });

  it('change with the scale', () => {
    const base = { layoutBytes: '{"a":1}', upstreamCommit: 'aaa', upstreamVersion: '1.4.0' };
    expect(cacheKey({ ...base, scale: 1 })).not.toBe(cacheKey({ ...base, scale: 0.5 }));
  });
});
