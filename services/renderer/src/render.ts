/**
 * Drive Pixel Agents' own renderer and screenshot what it drew.
 *
 * Ported from v1's `tools/render-previews.mjs`. The comments below are load
 * bearing: each one records a failure that was diagnosed once and is invisible
 * until it bites again.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { readJsonOrNull, upstreamAssetsDir, type Layout } from '@pixel-index/layout-core';
import { chromium, type Browser } from 'playwright';

import type { DevServer } from './devServer.js';

const TILE_SIZE = 16;
/**
 * Upstream picks its zoom as Math.round(2 * devicePixelRatio), so at
 * deviceScaleFactor 1 the office is drawn at 2 device-pixels per sprite pixel.
 * Sizing the viewport with the same number keeps the office filling the frame.
 */
const ZOOM = 2;
const MARGIN_TILES = 1;

/**
 * An element screenshot captures the page region, not the element in isolation,
 * so the toolbars, connection badge and changelog toast drawn over the canvas
 * would end up in the preview. Hide everything, then bring the canvas back.
 */
const HIDE_CHROME_CSS = `
  body * { visibility: hidden !important; }
  canvas { visibility: visible !important; }
`;

const HOOKS_TIMEOUT_MS = 60_000;
const FURNITURE_TIMEOUT_MS = 30_000;

export interface RenderOptions {
  /**
   * 1 renders the canonical preview. A fraction produces a thumbnail by
   * nearest-neighbour downscaling in the page — pixel art must never be
   * resampled, and doing it on the canvas we already have avoids both an image
   * library and a second encoder.
   */
  scale?: number;
  timeoutMs?: number;
}

/** The filename the browser mock fetches as "the" layout. */
export function defaultLayoutFilename(upstreamDir?: string): string {
  const assets = upstreamAssetsDir(upstreamDir);
  const index = readJsonOrNull<{ defaultLayout?: string }>(
    path.join(assets, 'asset-index.json'),
  );
  if (index?.defaultLayout) return index.defaultLayout;

  const candidates = fs
    .readdirSync(assets)
    .filter((file) => /^default-layout(-\d+)?\.json$/.test(file))
    .sort();
  const newest = candidates[candidates.length - 1];
  if (!newest) throw new Error('No default-layout JSON found in the pinned upstream assets.');
  return newest;
}

/** A bounded gate. This is a browser, not a lambda — unbounded means OOM. */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  get inFlight(): number {
    return this.active;
  }
}

export interface RendererDeps {
  devServer: DevServer;
  concurrency: number;
  defaultTimeoutMs: number;
  upstreamDir?: string;
}

export class Renderer {
  private browser: Browser | undefined;
  private readonly gate: Semaphore;
  private readonly defaultLayoutFile: string;

  constructor(private readonly deps: RendererDeps) {
    this.gate = new Semaphore(deps.concurrency);
    this.defaultLayoutFile = defaultLayoutFilename(deps.upstreamDir);
  }

  async start(): Promise<void> {
    this.browser ??= await chromium.launch();
  }

  get inFlight(): number {
    return this.gate.inFlight;
  }

  get isRunning(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  async render(layout: Layout, options: RenderOptions = {}): Promise<Buffer> {
    if (!this.browser) throw new Error('Renderer has not been started.');
    const scale = options.scale ?? 1;
    const timeoutMs = options.timeoutMs ?? this.deps.defaultTimeoutMs;

    const release = await this.gate.acquire();
    try {
      return await withTimeout(this.renderOnce(layout, scale), timeoutMs);
    } finally {
      release();
    }
  }

  private async renderOnce(layout: Layout, scale: number): Promise<Buffer> {
    const browser = this.browser!;
    const width = (layout.cols + MARGIN_TILES * 2) * TILE_SIZE * ZOOM;
    const height = (layout.rows + MARGIN_TILES * 2) * TILE_SIZE * ZOOM;

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });

    try {
      // Turn on upstream's test hooks so we can wait on real render state
      // instead of sleeping and hoping.
      await context.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__PIXEL_AGENTS_E2E = true;
      });
      const page = await context.newPage();

      // Serve OUR layout where the mock asks for the bundled default.
      //
      // Dispatching a layoutLoaded after page load instead would race the mock's
      // own dispatch, which lands late and would silently win — every preview
      // would then show the DEFAULT office while looking entirely plausible.
      // Substituting the fetch removes the race: the mock only ever sees one
      // layout, and it is this one.
      await page.route(`**/assets/${this.defaultLayoutFile}`, (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(layout) }),
      );

      await page.goto(this.deps.devServer.url, { waitUntil: 'load' });

      // The browser mock decodes every PNG in-page; the hooks appear once the
      // app has mounted.
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __pixelAgentsTestHooks?: { getFurnitureCount?: unknown } })
            .__pixelAgentsTestHooks?.getFurnitureCount === 'function',
        null,
        { timeout: HOOKS_TIMEOUT_MS },
      );

      // Wait for the office to actually hold this layout's furniture, so the
      // screenshot can never catch an empty or half-built office.
      const expected = layout.furniture?.length ?? 0;
      await page.waitForFunction(
        (count) =>
          (
            window as unknown as {
              __pixelAgentsTestHooks?: { getFurnitureCount?: () => number };
            }
          ).__pixelAgentsTestHooks?.getFurnitureCount?.() === count,
        expected,
        { timeout: FURNITURE_TIMEOUT_MS },
      );

      await page.addStyleTag({ content: HIDE_CHROME_CSS });
      // One more frame so the freshly built instances are painted.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      // The office is drawn wherever the camera puts it on a viewport-sized
      // canvas, so a plain element screenshot is mostly empty space. Ask the
      // canvas which pixels it actually painted and clip to those.
      const clip = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < 0) return null;
        const rect = canvas.getBoundingClientRect();
        const ratio = rect.width / canvas.width;
        return {
          x: rect.x + minX * ratio,
          y: rect.y + minY * ratio,
          width: (maxX - minX + 1) * ratio,
          height: (maxY - minY + 1) * ratio,
          // Canvas-space box, for the thumbnail path.
          canvas: { minX, minY, maxX, maxY },
        };
      });

      if (scale !== 1) return await this.thumbnail(page, clip, scale);

      if (clip) {
        const { canvas: _canvasBox, ...box } = clip;
        return await page.screenshot({ clip: box, animations: 'disabled' });
      }
      // Nothing painted — screenshot the canvas anyway so the failure is
      // visible in the gallery rather than silently missing.
      return await page.locator('canvas').first().screenshot({ animations: 'disabled' });
    } finally {
      await context.close();
    }
  }

  /**
   * Downscale in the page with smoothing off.
   *
   * Pixel art resampled with a smoothing filter turns to mush, and doing this on
   * the canvas that is already open avoids adding a native image library to an
   * image that is already 400 MB of browser.
   */
  private async thumbnail(
    page: import('playwright').Page,
    clip: { canvas: { minX: number; minY: number; maxX: number; maxY: number } } | null,
    scale: number,
  ): Promise<Buffer> {
    const dataUrl = await page.evaluate(
      ({ box, factor }) => {
        const source = document.querySelector('canvas');
        if (!source) return null;
        const sx = box ? box.minX : 0;
        const sy = box ? box.minY : 0;
        const sw = box ? box.maxX - box.minX + 1 : source.width;
        const sh = box ? box.maxY - box.minY + 1 : source.height;

        const target = document.createElement('canvas');
        target.width = Math.max(1, Math.round(sw * factor));
        target.height = Math.max(1, Math.round(sh * factor));
        const ctx = target.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, target.width, target.height);
        return target.toDataURL('image/png');
      },
      { box: clip?.canvas ?? null, factor: scale },
    );

    if (!dataUrl) throw new Error('Nothing was painted, so no thumbnail could be produced.');
    return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RenderTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class RenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`Render exceeded ${ms}ms`);
    this.name = 'RenderTimeoutError';
  }
}
