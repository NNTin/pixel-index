#!/usr/bin/env node
/**
 * Recompute `visible_cols`/`visible_rows` for every existing row from its
 * stored `layout` column and correct any that disagree.
 *
 * Migration 0009 added these as `NOT NULL DEFAULT 0`, which is right for new
 * rows (submit.ts/manage.ts/seed.ts all set them from `layoutStats()` now)
 * but wrong for rows written before this column existed — Postgres backfills
 * those with the column default, not a real bounding box. A schema migration
 * cannot fix that itself: computing the real occupied footprint means
 * scanning the stored `tiles` array, not something plain SQL can do. This is
 * the one-off, idempotent companion that does — same shape as
 * backfill-seats.ts, run once per boot from docker-entrypoint.sh.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Layout, layoutStats } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';

import { type AnyDatabase, createDatabase } from './client.js';
import * as schema from './schema.js';

export async function backfillVisibleBounds(db: AnyDatabase): Promise<number> {
  const rows = await db
    .select({
      id: schema.layouts.id,
      layout: schema.layouts.layout,
      visibleCols: schema.layouts.visibleCols,
      visibleRows: schema.layouts.visibleRows,
    })
    .from(schema.layouts);

  let updated = 0;
  for (const row of rows) {
    // No furniture catalog needed for this stat, but layoutStats() always
    // wants one — the seat count it also computes is simply discarded here.
    const stats = layoutStats(row.layout as Layout, { catalog: new Map() });
    if (stats.visibleCols === row.visibleCols && stats.visibleRows === row.visibleRows) continue;
    await db
      .update(schema.layouts)
      .set({ visibleCols: stats.visibleCols, visibleRows: stats.visibleRows })
      .where(eq(schema.layouts.id, row.id));
    updated += 1;
  }

  console.log(`Checked ${rows.length} layout(s), corrected visible bounds on ${updated}.`);
  return updated;
}

// Only run when executed directly, so importing this for tests is harmless —
// same pattern as migrate.ts, seed.ts and backfill-seats.ts.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  console.log('Backfilling visible_cols/visible_rows…');
  const { db, pool } = createDatabase();
  backfillVisibleBounds(db)
    .then(() => pool.end())
    .catch((error: unknown) => {
      console.error('Backfill failed:', error);
      return pool.end().finally(() => process.exit(1));
    });
}
