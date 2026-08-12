import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Layout } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { insertLayout } from '../test-support/layouts.js';
import { backfillVisibleBounds } from './backfill-visible-bounds.js';
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

function loadSeed(slug: string): { raw: string; parsed: Layout } {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'seed', slug, 'layout.json'), 'utf-8');
  return { raw, parsed: JSON.parse(raw) as Layout };
}

describe('backfillVisibleBounds', () => {
  // The exact numbers #55 was filed against: default, four-rooms and
  // severance-office all declare the same 21×22 canvas but occupy very
  // different actual footprints — see stats.test.ts for the same fixtures
  // used against layoutStats() directly.
  it.each([
    ['default', 20, 11],
    ['four-rooms', 20, 21],
    ['severance-office', 20, 12],
    ['blue-office', 25, 12],
  ])(
    'corrects a row whose visible bounds predate the columns (%s is %d×%d)',
    async (slug, visibleCols, visibleRows) => {
      const { raw, parsed } = loadSeed(slug);

      // A column default of 0 is exactly what a pre-migration row looks
      // like: real data, but bounds Postgres backfilled rather than computed.
      const stored = await insertLayout(db(), { raw, layout: parsed, visibleCols: 0, visibleRows: 0 });
      expect(stored.visibleCols).toBe(0);
      expect(stored.visibleRows).toBe(0);

      const updated = await backfillVisibleBounds(db());
      expect(updated).toBe(1);

      const [row] = await db().select().from(schema.layouts).where(eq(schema.layouts.id, stored.id));
      expect(row?.visibleCols).toBe(visibleCols);
      expect(row?.visibleRows).toBe(visibleRows);
    },
  );

  it('is idempotent — a second pass touches nothing once bounds are correct', async () => {
    const { raw, parsed } = loadSeed('four-rooms');
    await insertLayout(db(), { raw, layout: parsed, visibleCols: 0, visibleRows: 0 });

    await backfillVisibleBounds(db());
    const secondPass = await backfillVisibleBounds(db());
    expect(secondPass).toBe(0);
  });

  it('leaves an already-correct row alone', async () => {
    const stored = await insertLayout(db(), {
      raw: '{"version":1,"cols":2,"rows":2,"tiles":[0,0,0,0],"furniture":[]}',
      layout: { version: 1, cols: 2, rows: 2, tiles: [0, 0, 0, 0], furniture: [] },
      visibleCols: 2,
      visibleRows: 2,
    });

    const updated = await backfillVisibleBounds(db());
    expect(updated).toBe(0);

    const [row] = await db().select().from(schema.layouts).where(eq(schema.layouts.id, stored.id));
    expect(row?.visibleCols).toBe(2);
    expect(row?.visibleRows).toBe(2);
  });
});
