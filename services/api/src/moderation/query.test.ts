import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';
import { listModerationActions } from './query.js';

let harness: Harness;
beforeAll(async () => {
  harness = await createTestDatabase();
});
afterAll(async () => harness.close());

async function insertAction(overrides: Partial<schema.NewModerationAction> = {}) {
  const targetId = overrides.targetId ?? (await insertLayout(harness.db)).id;
  const [row] = await harness.db
    .insert(schema.moderationActions)
    .values({
      action: 'layout.update',
      targetType: 'layout',
      reason: null,
      ...overrides,
      targetId,
    })
    .returning();
  if (!row) throw new Error('insertAction: insert returned no row');
  return row;
}

describe('listModerationActions', () => {
  it('filters to one layout by its CURRENT slug', async () => {
    const layout = await insertLayout(harness.db, { slug: 'findable-history-target' });
    const other = await insertLayout(harness.db, { slug: 'unrelated-history-target' });
    await insertAction({ targetId: layout.id, action: 'layout.moderate_edit', reason: 'x' });
    await insertAction({ targetId: other.id, action: 'layout.moderate_edit', reason: 'x' });

    const { rows } = await listModerationActions(harness.db, {
      filters: { slug: 'findable-history-target' },
      limit: 50,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(layout.id);
    expect(rows[0]?.layoutSlug).toBe('findable-history-target');
  });

  it('returns nothing for a slug that does not currently resolve to any layout', async () => {
    const { rows } = await listModerationActions(harness.db, {
      filters: { slug: 'no-such-slug-anywhere' },
      limit: 50,
    });
    expect(rows).toEqual([]);
  });

  it('resolves a renamed layout by its current slug, not whatever an old row\'s before/after mentions', async () => {
    const layout = await insertLayout(harness.db, { slug: 'current-name-after-rename' });
    await insertAction({
      targetId: layout.id,
      action: 'layout.rename_slug',
      before: { slug: 'old-name-before-rename' },
      after: { slug: 'current-name-after-rename' },
    });

    const byCurrent = await listModerationActions(harness.db, {
      filters: { slug: 'current-name-after-rename' },
      limit: 50,
    });
    expect(byCurrent.rows).toHaveLength(1);

    const byOld = await listModerationActions(harness.db, {
      filters: { slug: 'old-name-before-rename' },
      limit: 50,
    });
    expect(byOld.rows).toEqual([]);
  });

  it('searches by q across the current layout slug or title', async () => {
    const layout = await insertLayout(harness.db, { slug: 'searchable-slug', title: 'A Findable Title' });
    await insertAction({ targetId: layout.id });

    const bySlug = await listModerationActions(harness.db, { filters: { q: 'searchable' }, limit: 50 });
    expect(bySlug.rows.some((row) => row.targetId === layout.id)).toBe(true);

    const byTitle = await listModerationActions(harness.db, { filters: { q: 'findable title' }, limit: 50 });
    expect(byTitle.rows.some((row) => row.targetId === layout.id)).toBe(true);
  });

  it('filters by action', async () => {
    const layout = await insertLayout(harness.db, { slug: 'action-filtered-layout' });
    await insertAction({ targetId: layout.id, action: 'layout.hide', reason: 'x' });
    await insertAction({ targetId: layout.id, action: 'layout.moderate_edit', reason: 'x' });

    const { rows } = await listModerationActions(harness.db, {
      filters: { slug: 'action-filtered-layout', action: 'layout.hide' },
      limit: 50,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('layout.hide');
  });

  it('leaves layoutSlug/layoutTitle null for a non-layout target', async () => {
    const user = await insertUser(harness.db);
    const row = await insertAction({
      targetType: 'user',
      targetId: user.id,
      action: 'report.create',
    });

    const { rows } = await listModerationActions(harness.db, { filters: {}, limit: 200 });
    const found = rows.find((r) => r.id === row.id);
    expect(found?.layoutSlug).toBeNull();
    expect(found?.layoutTitle).toBeNull();
  });

  it('paginates newest-first with a stable keyset cursor', async () => {
    // Explicit, well-separated timestamps rather than relying on wall-clock
    // `defaultNow()` ordering across three sequential inserts, which could
    // tie within the same millisecond and make ordering depend on the
    // (random) tiebreaker id instead of insertion order.
    const layout = await insertLayout(harness.db, { slug: 'paginated-history-target' });
    const first = await insertAction({
      targetId: layout.id,
      reason: 'first',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await insertAction({
      targetId: layout.id,
      reason: 'second',
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    });
    const third = await insertAction({
      targetId: layout.id,
      reason: 'third',
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    });

    const page1 = await listModerationActions(harness.db, {
      filters: { slug: 'paginated-history-target' },
      limit: 2,
    });
    expect(page1.rows.map((r) => r.id)).toEqual([third.id, second.id]);
    expect(page1.nextCursor).toBeTruthy();

    assert(page1.nextCursor !== null, 'page1 should report a next cursor');
    const page2 = await listModerationActions(harness.db, {
      filters: { slug: 'paginated-history-target' },
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.rows.map((r) => r.id)).toEqual([first.id]);
    expect(page2.nextCursor).toBeNull();
  });
});
