import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const ENV_KEYS = [
  'RENDERER_HOST',
  'RENDERER_PORT',
  'RENDERER_CONCURRENCY',
  'RENDERER_TIMEOUT_MS',
  'RENDERER_MAX_LAYOUT_BYTES',
  'RENDERER_CACHE_DIR',
  'RENDERER_CACHE_MAX_ENTRIES',
  'PIXEL_AGENTS_DIR',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('loadConfig', () => {
  it('works with nothing set', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.concurrency).toBe(2);
    expect(config.cacheDir).toMatch(/pixel-index-renderer-cache$/);
  });

  it('binds both IP stacks by default', () => {
    // Binding IPv4-only is how a container passes its own health check and then
    // gets dropped by a reverse proxy probing ::1, with nothing in any log.
    expect(loadConfig().host).toBe('::');
  });

  it('reads every knob from the environment', () => {
    process.env.RENDERER_HOST = '127.0.0.1';
    process.env.RENDERER_PORT = '8080';
    process.env.RENDERER_CONCURRENCY = '4';
    process.env.RENDERER_TIMEOUT_MS = '5000';
    process.env.RENDERER_MAX_LAYOUT_BYTES = '1024';
    process.env.RENDERER_CACHE_DIR = '/tmp/somewhere';

    expect(loadConfig()).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
      concurrency: 4,
      timeoutMs: 5000,
      maxLayoutBytes: 1024,
      cacheDir: '/tmp/somewhere',
    });
  });

  it('never allows zero concurrency, which would deadlock every request', () => {
    process.env.RENDERER_CONCURRENCY = '0';
    expect(loadConfig().concurrency).toBe(1);
  });

  it('rejects a nonsense value loudly instead of falling back', () => {
    process.env.RENDERER_PORT = 'http';
    expect(() => loadConfig()).toThrow(/RENDERER_PORT must be a non-negative number/);
  });

  it('rejects a negative value', () => {
    process.env.RENDERER_TIMEOUT_MS = '-1';
    expect(() => loadConfig()).toThrow(/non-negative/);
  });

  it('omits upstreamDir rather than setting it undefined', () => {
    expect('upstreamDir' in loadConfig()).toBe(false);
    process.env.PIXEL_AGENTS_DIR = '/opt/pixel-agents';
    expect(loadConfig().upstreamDir).toBe('/opt/pixel-agents');
  });
});
