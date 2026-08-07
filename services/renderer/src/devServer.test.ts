import { describe, expect, it } from 'vitest';

import { freePort, viteEnv } from './devServer.js';

describe('viteEnv', () => {
  it('forces development mode', () => {
    // Vite derives import.meta.env.DEV from NODE_ENV even when running the dev
    // server, and upstream gates its whole browser mock on DEV. Under
    // production the mock is skipped, the app waits on a WebSocket that does not
    // exist, and every render times out waiting for furniture that never
    // arrives — with nothing logged. This exact failure took a container build
    // to find, so it is pinned here.
    expect(viteEnv({ NODE_ENV: 'production' }).NODE_ENV).toBe('development');
    expect(viteEnv({}).NODE_ENV).toBe('development');
  });

  it('stops Vite opening a browser', () => {
    expect(viteEnv({}).BROWSER).toBe('none');
  });

  it('passes everything else through', () => {
    expect(viteEnv({ PIXEL_AGENTS_DIR: '/opt/upstream' }).PIXEL_AGENTS_DIR).toBe('/opt/upstream');
  });

  it('does not mutate the environment it was given', () => {
    const base = { NODE_ENV: 'production' };
    viteEnv(base);
    expect(base.NODE_ENV).toBe('production');
  });
});

describe('freePort', () => {
  it('returns a usable port', async () => {
    // Vite rejects --port 0, so the port has to be picked before spawning.
    const port = await freePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it('does not hand out the same port twice in a row', async () => {
    const [a, b] = await Promise.all([freePort(), freePort()]);
    expect(a).not.toBe(b);
  });
});
