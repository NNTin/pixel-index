import { describe, expect, it } from 'vitest';

import { layoutStats, sha256 } from './stats.js';
import { makeLayout } from './test-support/fixtures.js';
import type { FurnitureCatalog } from './types.js';

/**
 * A synthetic catalog rather than the real one, so these tests describe the
 * seat-counting rule and don't drift with the pinned submodule. Mirrors the
 * real shapes: a 1-tile chair, and a 2-tile (footprintW=2) sofa.
 */
const catalog: FurnitureCatalog = new Map([
  ['CHAIR', { category: 'chairs', footprintW: 1, footprintH: 1 }],
  ['SOFA', { category: 'chairs', footprintW: 2, footprintH: 1, backgroundTiles: 0 }],
  ['DESK', { category: 'desks', footprintW: 1, footprintH: 1 }],
  // backgroundTiles rows are walkable, not seats — a tall chair with one
  // background row seats only its remaining footprint row.
  ['TALL_CHAIR', { category: 'chairs', footprintW: 1, footprintH: 2, backgroundTiles: 1 }],
]);

describe('layoutStats', () => {
  it('counts every collection the index filters on', () => {
    const stats = layoutStats(
      makeLayout({
        cols: 21,
        rows: 22,
        furniture: [{ type: 'CLOCK', col: 1, row: -1 }],
        areas: [{ label: 'Green Room' }, { label: 'Blue Room' }],
        pets: [{}],
        carpets: [{}, {}, {}],
      }),
      { catalog },
    );

    expect(stats).toEqual({
      cols: 21,
      rows: 22,
      furniture: 1,
      areas: 2,
      pets: 1,
      carpets: 3,
      layoutRevision: 1,
      seats: 0,
    });
  });

  it('counts a seat per footprint tile of a chair-category item, not per item', () => {
    const stats = layoutStats(
      makeLayout({
        furniture: [
          { type: 'CHAIR', col: 0, row: 0 },
          { type: 'SOFA', col: 1, row: 0 },
          { type: 'DESK', col: 3, row: 0 },
        ],
      }),
      { catalog },
    );
    // 1 (CHAIR) + 2 (SOFA, footprintW=2) + 0 (DESK is not a chair) = 3
    expect(stats.seats).toBe(3);
  });

  it('excludes background rows from the seat count', () => {
    const stats = layoutStats(
      makeLayout({ furniture: [{ type: 'TALL_CHAIR', col: 0, row: 0 }] }),
      { catalog },
    );
    expect(stats.seats).toBe(1);
  });

  it('treats an unknown furniture type as zero seats', () => {
    const stats = layoutStats(
      makeLayout({ furniture: [{ type: 'MYSTERY_ITEM', col: 0, row: 0 }] }),
      { catalog },
    );
    expect(stats.seats).toBe(0);
  });

  it('treats absent collections as zero rather than undefined', () => {
    // The database columns are NOT NULL, so a layout exported without pets must
    // still produce a number.
    const stats = layoutStats(makeLayout({ areas: undefined, pets: undefined }));
    expect(stats.areas).toBe(0);
    expect(stats.pets).toBe(0);
    expect(stats.carpets).toBe(0);
  });

  it('defaults a missing layoutRevision to 0 so the rule can catch it', () => {
    expect(layoutStats(makeLayout({ layoutRevision: undefined })).layoutRevision).toBe(0);
  });
});

describe('sha256', () => {
  it('is stable and content-addressed', () => {
    expect(sha256('pixel')).toBe(sha256(Buffer.from('pixel')));
    expect(sha256('pixel')).not.toBe(sha256('pixels'));
    expect(sha256('')).toHaveLength(64);
  });
});
