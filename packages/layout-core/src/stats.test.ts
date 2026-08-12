import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { layoutStats, occupiedBounds, sha256 } from './stats.js';
import { makeLayout } from './test-support/fixtures.js';
import type { FurnitureCatalog, Layout } from './types.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../seed');

function loadSeed(slug: string): Layout {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, slug, 'layout.json'), 'utf-8')) as Layout;
}

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
      // makeLayout()'s default `tiles` is shorter than cols * rows (never
      // true for a real, validated layout — see validate.ts's
      // `layout.grid.tiles_mismatch`), so every index the bounds loop visits
      // beyond that is `undefined`, which reads as "not VOID" — the bounds
      // span the full declared canvas, same as a fully-occupied layout would.
      visibleCols: 21,
      visibleRows: 22,
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

describe('occupiedBounds / visibleCols / visibleRows (#55)', () => {
  it('is the full canvas for a layout with no VOID padding', () => {
    const stats = layoutStats(makeLayout({ cols: 3, rows: 2, tiles: [0, 0, 0, 0, 0, 0] }));
    expect(stats.visibleCols).toBe(3);
    expect(stats.visibleRows).toBe(2);
  });

  it('excludes VOID padding from the bounding box', () => {
    // 3×3, VOID border, one real tile in the centre.
    // prettier-ignore
    const tiles = [
      255, 255, 255,
      255, 0, 255,
      255, 255, 255,
    ];
    const stats = layoutStats(makeLayout({ cols: 3, rows: 3, tiles }));
    expect(stats.visibleCols).toBe(1);
    expect(stats.visibleRows).toBe(1);
  });

  it('falls back to the full canvas for an entirely-VOID layout', () => {
    const stats = layoutStats(makeLayout({ cols: 3, rows: 2, tiles: [255, 255, 255, 255, 255, 255] }));
    expect(stats.visibleCols).toBe(3);
    expect(stats.visibleRows).toBe(2);
  });

  // The bug report's exact numbers: default, four-rooms and severance-office
  // all declare the same 21×22 canvas (#55's screenshot) but occupy very
  // different actual footprints. blue-office (a different declared canvas,
  // 25×22) is included as a fourth, independently-verified data point.
  it.each([
    ['default', 21, 22, 20, 11],
    ['four-rooms', 21, 22, 20, 21],
    ['severance-office', 21, 22, 20, 12],
    ['blue-office', 25, 22, 25, 12],
  ])('%s declares %d×%d but occupies %d×%d', (slug, cols, rows, visibleCols, visibleRows) => {
    const layout = loadSeed(slug);
    expect(layout.cols).toBe(cols);
    expect(layout.rows).toBe(rows);

    const stats = layoutStats(layout);
    expect(stats.visibleCols).toBe(visibleCols);
    expect(stats.visibleRows).toBe(visibleRows);

    const bounds = occupiedBounds(layout);
    expect(bounds.maxCol - bounds.minCol + 1).toBe(visibleCols);
    expect(bounds.maxRow - bounds.minRow + 1).toBe(visibleRows);
  });

  it('default, four-rooms and severance-office share a canvas but not a footprint', () => {
    // The bug itself: reading cols/rows directly reports the same "size" for
    // three visually distinct layouts.
    const defaultLayout = loadSeed('default');
    const fourRooms = loadSeed('four-rooms');
    const severance = loadSeed('severance-office');
    expect(new Set([defaultLayout.cols, fourRooms.cols, severance.cols]).size).toBe(1);
    expect(new Set([defaultLayout.rows, fourRooms.rows, severance.rows]).size).toBe(1);

    const footprints = [defaultLayout, fourRooms, severance].map((layout) => {
      const stats = layoutStats(layout);
      return `${stats.visibleCols}x${stats.visibleRows}`;
    });
    expect(new Set(footprints).size).toBe(3);
  });
});

describe('sha256', () => {
  it('is stable and content-addressed', () => {
    expect(sha256('pixel')).toBe(sha256(Buffer.from('pixel')));
    expect(sha256('pixel')).not.toBe(sha256('pixels'));
    expect(sha256('')).toHaveLength(64);
  });
});
