import { describe, expect, it } from 'vitest';

import { bundledLayoutRevision, furnitureCatalog, knownFurnitureIds, upstreamPin } from './upstream.js';

/**
 * These run against the real pinned submodule rather than a fixture, on purpose:
 * the value of this package is that it agrees with the upstream we actually
 * ship, and a mocked catalog would prove nothing about that.
 */
describe('furnitureCatalog', () => {
  const catalog = furnitureCatalog();

  it('reads the pinned upstream', () => {
    expect(catalog.size).toBeGreaterThan(0);
  });

  it('inherits placement props from manifest group roots', () => {
    // canPlaceOnWalls and the footprint sit on the group root, not on the leaf
    // asset. A walker that only reads leaves loses them and then rejects valid
    // wall placements.
    const clock = catalog.get('CLOCK');
    expect(clock).toBeDefined();
    expect(clock?.canPlaceOnWalls).toBe(true);
    expect(clock?.footprintH).toBe(2);
  });

  it('synthesises the virtual :left ids that layouts store verbatim', () => {
    // Upstream's furnitureCatalog.ts creates a `<id>:left` entry for mirrorSide
    // assets with orientation "side". Layouts reference that id directly, so a
    // catalog without it reports valid furniture as unknown.
    const left = [...catalog.keys()].filter((id) => id.endsWith(':left'));
    expect(left.length).toBeGreaterThan(0);
    expect(left).toContain('PC_SIDE:left');

    const base = catalog.get('PC_SIDE');
    const mirrored = catalog.get('PC_SIDE:left');
    expect(base?.mirrorSide).toBe(true);
    expect(mirrored?.orientation).toBe('left');
    // The mirrored entry keeps the original's placement rules.
    expect(mirrored?.footprintW).toBe(base?.footprintW);
    expect(mirrored?.canPlaceOnWalls).toBe(base?.canPlaceOnWalls);
  });

  it('knownFurnitureIds agrees with the catalog', () => {
    expect(knownFurnitureIds()).toEqual(new Set(catalog.keys()));
  });
});

describe('bundledLayoutRevision', () => {
  it('reads a non-negative integer from the pinned default layout', () => {
    const revision = bundledLayoutRevision();
    expect(Number.isInteger(revision)).toBe(true);
    expect(revision).toBeGreaterThanOrEqual(0);
  });
});

describe('upstreamPin', () => {
  const pin = upstreamPin();

  it('reports the pinned version and a full commit sha', () => {
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+/);
    // null is legitimate for a tarball checkout; a short or dirty sha is not.
    if (pin.commit !== null) expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('carries the revision every published layout is measured against', () => {
    expect(pin.layoutRevision).toBe(bundledLayoutRevision());
  });
});

describe('missing upstream', () => {
  it('fails with an actionable message rather than a bare ENOENT', () => {
    expect(() => furnitureCatalog('/nonexistent/pixel-agents')).toThrow(
      /git submodule update --init/,
    );
  });
});
