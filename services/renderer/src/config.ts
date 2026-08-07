/**
 * Configuration, from the environment only.
 *
 * No hostname or path is compiled in — a self-hoster sets these and nothing
 * else. See ADR 0001, decision 8.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export interface RendererConfig {
  host: string;
  port: number;
  /** How many pages may render at once. This is a browser, not a function. */
  concurrency: number;
  /** Hard ceiling on one render, after which the page is torn down. */
  timeoutMs: number;
  /** Refuse oversized bodies before a browser ever sees them. */
  maxLayoutBytes: number;
  /** Content-addressed PNGs. Survives restarts so a redeploy is not a stampede. */
  cacheDir: string;
  /** Set to 0 to disable the cache entirely. */
  cacheMaxEntries: number;
  upstreamDir?: string;
  /**
   * The pinned upstream commit, when it cannot be read from git.
   *
   * In a container `vendor/pixel-agents` is a plain copy with no git linkage, so
   * `upstreamPin()` reports `commit: null`. The cache key would then fall back to
   * the version alone — and the pin is routinely several commits past a tag
   * (v1.4.0-14-g9794e07), so two different renderers would share a key and serve
   * each other's previews. Pass the commit at build time to close that.
   */
  upstreamCommit?: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
}

export function loadConfig(): RendererConfig {
  return {
    host: process.env.RENDERER_HOST ?? '::',
    port: intFromEnv('RENDERER_PORT', 3000),
    concurrency: Math.max(1, intFromEnv('RENDERER_CONCURRENCY', 2)),
    timeoutMs: intFromEnv('RENDERER_TIMEOUT_MS', 60_000),
    maxLayoutBytes: intFromEnv('RENDERER_MAX_LAYOUT_BYTES', 2_000_000),
    cacheDir:
      process.env.RENDERER_CACHE_DIR ?? path.join(os.tmpdir(), 'pixel-index-renderer-cache'),
    cacheMaxEntries: intFromEnv('RENDERER_CACHE_MAX_ENTRIES', 2000),
    ...(process.env.PIXEL_AGENTS_DIR ? { upstreamDir: process.env.PIXEL_AGENTS_DIR } : {}),
    ...(process.env.PIXEL_AGENTS_COMMIT
      ? { upstreamCommit: process.env.PIXEL_AGENTS_COMMIT }
      : {}),
  };
}
