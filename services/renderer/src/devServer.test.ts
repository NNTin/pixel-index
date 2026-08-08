import { describe, expect, it } from 'vitest';

import { extractDevServerUrl, freePort, viteEnv } from './devServer.js';

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

  it('disables colour output', () => {
    // GitHub Actions sets FORCE_COLOR, which makes vite colour its "Local:"
    // line even over a pipe — with escape codes landing inside the URL
    // itself. extractDevServerUrl strips them defensively too, but there is
    // no reason to ask for colour we are just going to parse around.
    expect(viteEnv({ FORCE_COLOR: '1' }).FORCE_COLOR).toBe('0');
    expect(viteEnv({}).NO_COLOR).toBe('1');
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

describe('extractDevServerUrl', () => {
  it('finds a plain, uncoloured URL', () => {
    expect(extractDevServerUrl('  ➜  Local:   http://127.0.0.1:5173/\n')).toBe('http://127.0.0.1:5173');
  });

  it('finds the URL when ANSI colour codes land inside it', () => {
    // The exact byte sequence observed live on a GitHub Actions runner
    // (FORCE_COLOR set): vite colours the port number, so the escape code
    // sits between "127.0.0.1:" and the digits — a plain :\d+ regex never
    // matches this, and startDevServer timed out despite vite having
    // already printed its ready line.
    const coloured =
      '\x1b[32m\x1b[1mVITE\x1b[22m v8.1.5\x1b[31m  \x1b[2mready in \x1b[0m\x1b[1m343\x1b[22m\x1b[2m ms\x1b[22m\n\n' +
      '  \x1b[32m➜\x1b[31m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://127.0.0.1:\x1b[1m37513\x1b[22m/\x1b[31m\x1b[39m\n';
    expect(extractDevServerUrl(coloured)).toBe('http://127.0.0.1:37513');
  });

  it('returns null before any URL has been printed', () => {
    expect(extractDevServerUrl('')).toBeNull();
    expect(extractDevServerUrl('installing dependencies...\n')).toBeNull();
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
