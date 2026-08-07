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
    furniture: layout.furniture?.length ?? 0,
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
