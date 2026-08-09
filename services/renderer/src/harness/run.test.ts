import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenderTimeoutError } from '../render.js';
import { buildPreviewManifest } from './manifest.js';
import { runPin, type RunPinDeps, type RendererLike } from './run.js';
import { HarnessInfraError, type HarnessLayout } from './types.js';

const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-'));
  temporaryDirs.push(dir);
  return dir;
};

/**
 * A layout the pinned upstream really accepts, so these tests exercise the
 * *real* validator rather than a stub of it — the validator's agreement with
 * the pin is the thing the gate depends on.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const validLayout = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'seed/severance-office/layout.json'), 'utf-8'),
) as unknown;

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function fakeDeps(renderer: Partial<RendererLike>): RunPinDeps {
  return {
    startDevServer: async () => ({ url: 'http://127.0.0.1:1234', stop: () => {} }),
    createRenderer: () => ({
      start: async () => {},
      close: async () => {},
      render: async () => PNG,
      ...renderer,
    }),
  };
}

const layouts: HarnessLayout[] = [{ slug: 'severance-office', layout: validLayout }];

describe('runPin', () => {
  it('records a rendered layout with the PNG hash the diff compares on', async () => {
    const run = await runPin(layouts, { source: 'seed/', deps: fakeDeps({}) });
    expect(run.outcomes['severance-office']).toMatchObject({ status: 'ok', bytes: PNG.length });
    expect(run.pin.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rejects an invalid layout before a browser is involved', async () => {
    const render = vi.fn(async () => PNG);
    const run = await runPin([{ slug: 'bogus', layout: { not: 'a layout' } }], {
      source: 'seed/',
      deps: fakeDeps({ render }),
    });

    expect(run.outcomes.bogus?.status).toBe('invalid');
    // A layout the index would reject must never occupy a render slot — the
    // same rule the renderer service itself enforces.
    expect(render).not.toHaveBeenCalled();
  });

  it('retries a failed render once, and passes if the retry succeeds', async () => {
    // A contended runner times out; upstream is fine. Without the retry this
    // is a false hard-fail on a cron PR, which is how people learn to ignore it.
    let calls = 0;
    const run = await runPin(layouts, {
      source: 'seed/',
      deps: fakeDeps({
        render: async () => {
          calls += 1;
          if (calls === 1) throw new RenderTimeoutError(1000);
          return PNG;
        },
      }),
    });

    expect(run.outcomes['severance-office']).toMatchObject({ status: 'ok', retried: true });
    expect(calls).toBe(2);
  });

  it('records a render that fails twice, and keeps the kind', async () => {
    const run = await runPin(layouts, {
      source: 'seed/',
      deps: fakeDeps({
        render: async () => {
          throw new RenderTimeoutError(1000);
        },
      }),
    });
    expect(run.outcomes['severance-office']).toMatchObject({
      status: 'render_failed',
      kind: 'timeout',
    });
  });

  it('writes one PNG per rendered layout when asked', async () => {
    const pngDir = tempDir();
    await runPin(layouts, { source: 'seed/', pngDir, deps: fakeDeps({}) });
    expect(fs.readFileSync(path.join(pngDir, 'severance-office.png'))).toEqual(PNG);
  });

  it('reports a dev server that will not boot as infrastructure', async () => {
    // devServer.ts documents a real 200s cold-boot timeout found live. That is
    // never evidence that upstream broke anything.
    await expect(
      runPin(layouts, {
        source: 'seed/',
        deps: {
          startDevServer: async () => {
            throw new Error('Vite dev server did not start in time.');
          },
          createRenderer: () => ({
            start: async () => {},
            close: async () => {},
            render: async () => PNG,
          }),
        },
      }),
    ).rejects.toThrow(HarnessInfraError);
  });

  it('stops the dev server even when a render throws unexpectedly', async () => {
    const stop = vi.fn();
    await runPin(layouts, {
      source: 'seed/',
      deps: {
        startDevServer: async () => ({ url: 'http://127.0.0.1:1234', stop }),
        createRenderer: () => ({
          start: async () => {},
          close: async () => {},
          render: async () => {
            throw new Error('boom');
          },
        }),
      },
    });
    expect(stop).toHaveBeenCalled();
  });
});

describe('buildPreviewManifest', () => {
  it('points at a PNG for a layout that renders on the candidate', async () => {
    const run = await runPin(layouts, { source: 'seed/', deps: fakeDeps({}) });
    const manifest = buildPreviewManifest({
      baseline: run,
      candidate: run,
      baseUrl: 'https://cdn.example.com/abc',
    });

    expect(manifest.layouts['severance-office']).toEqual({ file: 'severance-office.png' });
    expect(manifest.baseUrl).toBe('https://cdn.example.com/abc/');
  });

  it('marks a layout that fails on the candidate rather than letting it fall back', async () => {
    // Falling back to the API's image would show the OLD pin's picture for a
    // layout the new pin cannot draw — the exact lie this mechanism exists to
    // stop.
    const run = await runPin(layouts, {
      source: 'seed/',
      deps: fakeDeps({
        render: async () => {
          throw new Error('boom');
        },
      }),
    });
    const manifest = buildPreviewManifest({
      baseline: run,
      candidate: run,
      baseUrl: 'https://cdn.example.com/abc/',
    });

    expect(manifest.layouts['severance-office']).toEqual({ failed: 'render_failed' });
  });
});
