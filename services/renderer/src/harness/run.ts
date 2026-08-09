/**
 * Render a set of layouts against one pinned upstream.
 *
 * This is a driver, not a renderer: `startDevServer`, `Renderer` and
 * `createValidator` are the same ones the service itself uses, unmodified.
 * The gate has to measure what production does, and the only way to be sure of
 * that is to run production's code.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { createValidator, sha256, upstreamPin, type Layout } from '@pixel-index/layout-core';

import { startDevServer, type DevServer } from '../devServer.js';
import { RenderTimeoutError, Renderer } from '../render.js';
import { HarnessInfraError, type HarnessLayout, type LayoutOutcome, type PinRun } from './types.js';

export interface RunPinOptions {
  /** The pinned checkout to measure. Defaults to whatever `resolveUpstreamDir` finds. */
  upstreamDir?: string;
  /** Where the layouts came from, recorded for the report. */
  source: string;
  /** When set, every successful render is written here as `<slug>.png`. */
  pngDir?: string;
  concurrency?: number;
  timeoutMs?: number;
  /** Injectable so the tests do not need a browser. */
  deps?: RunPinDeps;
  onProgress?: (done: number, total: number) => void;
}

/** The two heavy things, hoisted so a test can supply fakes. */
export interface RunPinDeps {
  startDevServer: typeof startDevServer;
  createRenderer: (devServer: DevServer, concurrency: number, timeoutMs: number) => RendererLike;
}

export interface RendererLike {
  start(): Promise<void>;
  render(layout: Layout): Promise<Buffer>;
  close(): Promise<void>;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 120_000;

const realDeps: RunPinDeps = {
  startDevServer,
  createRenderer: (devServer, concurrency, defaultTimeoutMs) =>
    new Renderer({ devServer, concurrency, defaultTimeoutMs }),
};

export async function runPin(
  layouts: HarnessLayout[],
  options: RunPinOptions,
): Promise<PinRun> {
  const {
    upstreamDir,
    source,
    pngDir,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    deps = realDeps,
    onProgress,
  } = options;

  const startedAt = new Date().toISOString();

  // Everything before the first render is environment, so anything that throws
  // here is infrastructure — not a verdict about the vendor. A Vite that will
  // not boot on a cold runner (see devServer.ts's own 200s note) must never be
  // reported as "this upstream breaks layouts".
  let pin;
  let validator;
  try {
    pin = upstreamPin(upstreamDir);
    validator = createValidator({
      ...(upstreamDir ? { upstreamDir } : {}),
      upstreamVersion: pin.version,
    });
  } catch (error) {
    throw new HarnessInfraError('Could not read the pinned upstream.', error);
  }

  let devServer: DevServer;
  try {
    devServer = await deps.startDevServer(upstreamDir);
  } catch (error) {
    throw new HarnessInfraError('The upstream dev server did not start.', error);
  }

  const renderer = deps.createRenderer(devServer, concurrency, timeoutMs);
  const outcomes: Record<string, LayoutOutcome> = {};

  try {
    try {
      await renderer.start();
    } catch (error) {
      throw new HarnessInfraError('The browser did not start.', error);
    }

    if (pngDir) fs.mkdirSync(pngDir, { recursive: true });

    let done = 0;
    // Sequential at this level; `Renderer` has its own semaphore, so feeding it
    // faster than `concurrency` would only queue inside it and lose the tidy
    // progress reporting.
    for (const item of layouts) {
      outcomes[item.slug] = await renderOne(renderer, validator, item, pngDir);
      done += 1;
      onProgress?.(done, layouts.length);
    }
  } finally {
    await renderer.close().catch(() => {});
    devServer.stop();
  }

  return { pin, source, outcomes, startedAt, finishedAt: new Date().toISOString() };
}

async function renderOne(
  renderer: RendererLike,
  validator: ReturnType<typeof createValidator>,
  item: HarnessLayout,
  pngDir: string | undefined,
): Promise<LayoutOutcome> {
  // Validate first, exactly as the service does — a layout the index would
  // reject never occupies a render slot, and "unknown furniture id" is a far
  // more useful report line than whatever the browser would have drawn.
  const { valid, issues } = validator.validateLayout(item.layout);
  if (!valid) return { status: 'invalid', issues };

  const attempt = async (): Promise<Buffer> => renderer.render(item.layout as Layout);

  let png: Buffer;
  let retried = false;
  try {
    png = await attempt();
  } catch (first) {
    // Retry once, and only the failures. A genuine incompatibility is
    // deterministic and will fail again; a timeout on a contended runner
    // usually will not. This is the cheapest available discriminator between
    // "upstream broke this" and "CI had a bad minute".
    retried = true;
    try {
      png = await attempt();
    } catch (second) {
      return {
        status: 'render_failed',
        kind: second instanceof RenderTimeoutError ? 'timeout' : 'error',
        message: second instanceof Error ? second.message : String(second),
      };
    }
  }

  if (pngDir) fs.writeFileSync(path.join(pngDir, `${item.slug}.png`), png);
  return { status: 'ok', pngSha256: sha256(png), bytes: png.length, ...(retried ? { retried } : {}) };
}
