import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Layout } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { insertLayout } from '../test-support/layouts.js';
import { backfillSeatCounts } from './backfill-seats.js';
import * as schema from './schema.js';
import { createTestDatabase, type Harness } from './test-support/harness.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let harness: Harness | undefined;
beforeEach(async () => {
  harness = await createTestDatabase();
});
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** The database the running test created — see seed.test.ts for why this isn't `harness!`. */
function db(): Harness['db'] {
  if (!harness) throw new Error('this test did not create a database');
  return harness.db;
}

describe('backfillSeatCounts', () => {
  it('corrects a row whose seat_count predates the column (blue-office has 20 real seats)', async () => {
    const file = path.join(REPO_ROOT, 'seed/blue-office/layout.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Layout;

    // A column default of 0 is exactly what a pre-migration row looks like:
    // real data, but a seat_count Postgres backfilled rather than computed.
    const stored = await insertLayout(db(), { raw, layout: parsed, seatCount: 0 });
    expect(stored.seatCount).toBe(0);

    const updated = await backfillSeatCounts(db());
    expect(updated).toBe(1);

    const [row] = await db().select().from(schema.layouts).where(eq(schema.layouts.id, stored.id));
    expect(row?.seatCount).toBe(20);
  });

  it('is idempotent — a second pass touches nothing once counts are correct', async () => {
    const file = path.join(REPO_ROOT, 'seed/blue-office/layout.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Layout;
    await insertLayout(db(), { raw, layout: parsed, seatCount: 0 });

    await backfillSeatCounts(db());
    const secondPass = await backfillSeatCounts(db());
    expect(secondPass).toBe(0);
  });

  it('leaves an already-correct seat_count alone', async () => {
    const stored = await insertLayout(db(), {
      raw: '{"version":1,"cols":2,"rows":2,"tiles":[0,0,0,0],"furniture":[]}',
      layout: { version: 1, cols: 2, rows: 2, tiles: [0, 0, 0, 0], furniture: [] },
      seatCount: 0,
    });

    const updated = await backfillSeatCounts(db());
    expect(updated).toBe(0);

    const [row] = await db().select().from(schema.layouts).where(eq(schema.layouts.id, stored.id));
    expect(row?.seatCount).toBe(0);
  });
});
