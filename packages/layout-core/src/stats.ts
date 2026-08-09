import { createHash } from 'node:crypto';

import type { Layout, LayoutStats } from './types.js';

/**
 * The denormalised facts the index stores, filters and displays per layout.
 *
 * This is the single source of truth for those numbers: the database columns
 * (#3) are written from here on every insert and update, so a stat shown in the
 * gallery can never disagree with the layout beside it.
 */
export function layoutStats(layout: Layout): LayoutStats {
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
  };
}

/** Content hash, used for submission dedupe (#8) and render-cache keys (#4). */
export function sha256(input: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}
