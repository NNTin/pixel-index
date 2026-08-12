import { createHash } from 'node:crypto';

import type { FurnitureCatalog, Layout, LayoutStats } from './types.js';
import { furnitureCatalog } from './upstream.js';

export interface LayoutStatsOptions {
  /** Defaults to the pinned upstream's catalog. Pass one to avoid re-reading it. */
  catalog?: FurnitureCatalog;
  /** Where the pinned upstream lives, when it is not auto-discoverable. */
  upstreamDir?: string;
}

export interface TileBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * The pinned upstream's `TileType.VOID` (webview-ui/src/office/types.ts).
 * Inlined rather than imported: layout-core has no dependency on the
 * vendored renderer, and this one value is stable enough (it is the
 * all-bits-set sentinel, not an assigned tile type) to duplicate rather
 * than take on that dependency for.
 */
const VOID_TILE = 255;

/**
 * The bounding box of every non-VOID tile — a layout's "canvas" (`cols` ×
 * `rows`) is padding-inclusive and, for several bundled seeds, identical
 * across layouts of very different visual size (#55); this is what a viewer
 * actually sees.
 *
 * This is the *same* algorithm as `visibleTileBounds()` in
 * apps/web/src/live-office/PreviewApp.tsx, which frames the live-preview
 * camera from it — not a second, similar definition of "occupied". That
 * function takes the upstream's own `OfficeLayout`, which is structurally
 * compatible with the `Layout` shape here, so it calls this export directly
 * rather than keeping its own copy.
 */
export function occupiedBounds(layout: Pick<Layout, 'cols' | 'rows' | 'tiles'>): TileBounds {
  let minCol = layout.cols;
  let maxCol = -1;
  let minRow = layout.rows;
  let maxRow = -1;

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      const tile = layout.tiles[row * layout.cols + col];
      if (tile === VOID_TILE) continue;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }

  // An entirely-VOID (or tiles-less) layout has no bounding box to report —
  // fall back to the full declared canvas, same as PreviewApp.tsx.
  return maxCol >= 0
    ? { minCol, maxCol, minRow, maxRow }
    : { minCol: 0, maxCol: layout.cols - 1, minRow: 0, maxRow: layout.rows - 1 };
}

/**
 * The denormalised facts the index stores, filters and displays per layout.
 *
 * This is the single source of truth for those numbers: the database columns
 * (#3) are written from here on every insert and update, so a stat shown in the
 * gallery can never disagree with the layout beside it.
 */
export function layoutStats(layout: Layout, options: LayoutStatsOptions = {}): LayoutStats {
  const catalog = options.catalog ?? furnitureCatalog(options.upstreamDir);

  // A seat is a footprint tile of a chair-category item, not the item itself —
  // matching upstream's own layoutToSeats(): a SOFA (footprintW=2, footprintH=1)
  // seats two agents, not one. `backgroundTiles` rows are walkable/overlappable
  // and excluded, same as layoutToSeats().
  let seats = 0;
  for (const item of layout.furniture) {
    const entry = catalog.get(item.type);
    if (entry?.category !== 'chairs') continue;
    const footprintW = entry.footprintW ?? 1;
    const footprintH = entry.footprintH ?? 1;
    const backgroundTiles = typeof entry.backgroundTiles === 'number' ? entry.backgroundTiles : 0;
    seats += footprintW * Math.max(0, footprintH - backgroundTiles);
  }

  const bounds = occupiedBounds(layout);

  return {
    cols: layout.cols,
    rows: layout.rows,
    visibleCols: bounds.maxCol - bounds.minCol + 1,
    visibleRows: bounds.maxRow - bounds.minRow + 1,
    // Not defensive like the four below: `furniture` is required by both the
    // Layout type and layout.schema.json, and every caller validates before
    // getting here (seed.ts, submit.ts, manage.ts). `areas`, `pets`, `carpets`
    // and `layoutRevision` really are optional — an office with no pets exports
    // without the key — and the columns they feed are NOT NULL.
    furniture: layout.furniture.length,
    areas: layout.areas?.length ?? 0,
    pets: layout.pets?.length ?? 0,
    carpets: layout.carpets?.length ?? 0,
    layoutRevision: layout.layoutRevision ?? 0,
    seats,
  };
}

/** Content hash, used for submission dedupe (#8) and render-cache keys (#4). */
export function sha256(input: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}
