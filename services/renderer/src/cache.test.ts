import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cacheKey, PreviewCache, RENDER_FORMAT } from './cache.js';

const BASE = {
  layoutBytes: '{"version":1}',
  upstreamCommit: 'a'.repeat(40),
  upstreamVersion: '1.4.0',
  scale: 1,
};

/** The sha256 `cacheKey(BASE)` produces at RENDER_FORMAT 2. Asserted below. */
const GOLDEN_CACHE_HASH = '46aa0a40de57fd7f148727249ae8f984ecbe215a6a5745332f5c6b33d6f67608';

describe('cacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKey(BASE)).toBe(cacheKey({ ...BASE }));
  });

  it('changes with the layout', () => {
    expect(cacheKey({ ...BASE, layoutBytes: '{"version":2}' })).not.toBe(cacheKey(BASE));
  });

  it('changes with the upstream pin', () => {
    // Bumping vendor/pixel-agents can change what a layout looks like, so a key
    // that ignored the pin would serve the previous renderer's preview forever.
    expect(cacheKey({ ...BASE, upstreamCommit: 'b'.repeat(40) })).not.toBe(cacheKey(BASE));
    expect(cacheKey({ ...BASE, upstreamVersion: '1.5.0' })).not.toBe(cacheKey(BASE));
  });

  it('changes with the scale', () => {
    expect(cacheKey({ ...BASE, scale: 0.5 })).not.toBe(cacheKey(BASE));
  });

  it('is a fixed value for fixed inputs', () => {
    // A golden hash. The pin can sit still while this service changes what it
    // draws — #71 cropped and un-whited every preview at an unchanged pin — and
    // without RENDER_FORMAT in the key every already-rendered layout would keep
    // serving its stale image, so the fix would ship invisibly.
    //
    // The cost of changing this is invisible locally and paid in production:
    // every cached preview is orphaned and re-rendered at once. A failure here
    // is either an accident to undo, or a deliberate RENDER_FORMAT bump whose
    // new hash belongs here.
    expect(RENDER_FORMAT).toBe(2);
    expect(cacheKey(BASE)).toBe(GOLDEN_CACHE_HASH);
  });

  it('tolerates an unpinned upstream without colliding', () => {
    const noCommit = cacheKey({ ...BASE, upstreamCommit: null });
    const noVersion = cacheKey({ ...BASE, upstreamVersion: null });
    expect(new Set([cacheKey(BASE), noCommit, noVersion]).size).toBe(3);
  });
});

describe('PreviewCache', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cache-test-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('round-trips a PNG', async () => {
    const cache = new PreviewCache(dir, 10);
    await cache.init();
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

    expect(await cache.get('k')).toBeNull();
    await cache.set('k', png);
    expect(await cache.get('k')).toEqual(png);
  });

  it('survives a restart, so a redeploy is not a render stampede', async () => {
    const first = new PreviewCache(dir, 10);
    await first.init();
    await first.set('k', Buffer.from('cached'));

    const second = new PreviewCache(dir, 10);
    await second.init();
    expect(await second.get('k')).toEqual(Buffer.from('cached'));
  });

  it('can be disabled entirely', async () => {
    const cache = new PreviewCache(dir, 0);
    await cache.init();
    expect(cache.enabled).toBe(false);
    await cache.set('k', Buffer.from('x'));
    expect(await cache.get('k')).toBeNull();
    // Disabled means it does not even create its directory.
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('stops writing at the ceiling instead of evicting', async () => {
    const cache = new PreviewCache(dir, 2);
    await cache.init();
    await cache.set('a', Buffer.from('a'));
    await cache.set('b', Buffer.from('b'));
    await cache.set('c', Buffer.from('c'));

    expect(await cache.get('a')).not.toBeNull();
    expect(await cache.get('c')).toBeNull();
  });

  it('leaves no partial file behind for a later read to trust', async () => {
    const cache = new PreviewCache(dir, 10);
    await cache.init();
    await cache.set('k', Buffer.from('complete'));
    // Written via a temp file and renamed, so nothing ending in .tmp survives.
    expect(fs.readdirSync(dir).filter((file) => file.endsWith('.tmp'))).toHaveLength(0);
  });
});
