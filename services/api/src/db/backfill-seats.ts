#!/usr/bin/env node
/**
 * Recompute `seat_count` for every existing row from its stored `layout`
 * column and correct any that disagree.
 *
 * Migration 0007 added `seat_count` as `NOT NULL DEFAULT 0`, which is right
 * for new rows (submit.ts/manage.ts/seed.ts all set it from `layoutStats()`
 * now) but wrong for rows written before this column existed — Postgres backfills
 * those with the column default, not a real count. A schema migration cannot
 * fix that itself: computing a real count needs the furniture catalog, which
 * means filesystem access to the pinned upstream, not something plain SQL can
 * do. This is the one-off, idempotent companion that does — same shape as
 * migrate.ts and seed.ts, run once per boot from docker-entrypoint.sh.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { furnitureCatalog, type Layout, layoutStats, upstreamPin } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';

import { type AnyDatabase, createDatabase } from './client.js';
import * as schema from './schema.js';

export async function backfillSeatCounts(db: AnyDatabase): Promise<number> {
  const catalog = furnitureCatalog();
  const rows = await db
    .select({ id: schema.layouts.id, layout: schema.layouts.layout, seatCount: schema.layouts.seatCount })
    .from(schema.layouts);

  let updated = 0;
  for (const row of rows) {
    const seats = layoutStats(row.layout as Layout, { catalog }).seats;
    if (seats === row.seatCount) continue;
    await db.update(schema.layouts).set({ seatCount: seats }).where(eq(schema.layouts.id, row.id));
    updated += 1;
  }

  console.log(`Checked ${rows.length} layout(s), corrected seat_count on ${updated}.`);
  return updated;
}

// Only run when executed directly, so importing this for tests is harmless —
// same pattern as migrate.ts and seed.ts.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  console.log(`Backfilling seat_count against pixel-agents ${upstreamPin().version ?? 'unknown'}…`);
  const { db, pool } = createDatabase();
  backfillSeatCounts(db)
    .then(() => pool.end())
    .catch((error: unknown) => {
      console.error('Backfill failed:', error);
      return pool.end().finally(() => process.exit(1));
    });
}
