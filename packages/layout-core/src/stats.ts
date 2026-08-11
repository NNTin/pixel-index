import { createHash } from 'node:crypto';

import type { FurnitureCatalog, Layout, LayoutStats } from './types.js';
import { furnitureCatalog } from './upstream.js';

export interface LayoutStatsOptions {
  /** Defaults to the pinned upstream's catalog. Pass one to avoid re-reading it. */
  catalog?: FurnitureCatalog;
  /** Where the pinned upstream lives, when it is not auto-discoverable. */
  upstreamDir?: string;
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

  return {
    cols: layout.cols,
    rows: layout.rows,
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
