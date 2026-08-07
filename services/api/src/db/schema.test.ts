import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { layoutStats, sha256 } from '@pixel-index/layout-core';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYSTEM_USER_ID } from './constants.js';
import * as schema from './schema.js';
import { createTestDatabase, type Harness } from './test-support/harness.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let harness: Harness;
beforeAll(async () => {
  harness = await createTestDatabase();
});
afterAll(async () => harness.close());

const A_HASH = 'a'.repeat(64);

/**
 * Assert a query failed for the reason we think it did.
 *
 * Drizzle wraps driver errors in a DrizzleQueryError whose own message is just
 * the failed SQL, so a plain `.rejects.toThrow(/…/)` passes on *any* failure —
 * including the schema being wrong. Walk the cause chain instead.
 */
async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown, 'expected the query to fail, but it succeeded').toBeDefined();

  const messages: string[] = [];
  for (let error = thrown; error instanceof Error; error = error.cause) {
    messages.push(error.message);
  }
  expect(messages.join('\n')).toMatch(pattern);
}

async function insertUser(overrides: Partial<schema.NewUser> = {}) {
  const [user] = await harness.db
    .insert(schema.users)
    .values({ discordId: `d-${Math.random()}`, username: 'someone', ...overrides })
    .returning();
  return user!;
}

async function insertLayout(overrides: Partial<schema.NewLayout> = {}) {
  const [layout] = await harness.db
    .insert(schema.layouts)
    .values({
      slug: `layout-${Math.random().toString(36).slice(2, 10)}`,
      title: 'A layout',
      authorUserId: SYSTEM_USER_ID,
      layout: { version: 1 },
      sha256: A_HASH,
      cols: 21,
      rows: 22,
      ...overrides,
    })
    .returning();
  return layout!;
}

describe('the audit log is append-only', () => {
  it('accepts inserts', async () => {
    const layout = await insertLayout();
    const [action] = await harness.db
      .insert(schema.moderationActions)
      .values({
        action: 'layout.create',
        targetType: 'layout',
        targetId: layout.id,
        reason: 'submitted',
      })
      .returning();
    expect(action?.id).toBeDefined();
  });

  it('rejects UPDATE at the database, not by convention', async () => {
    // The requirement is "no update/delete path in application code". A
    // convention rots; a trigger cannot be bypassed by an ORM call or a psql
    // session, which is the point of an audit log.
    const layout = await insertLayout();
    const [action] = await harness.db
      .insert(schema.moderationActions)
      .values({ action: 'layout.hide', targetType: 'layout', targetId: layout.id, reason: 'x' })
      .returning();

    await expectRejection(
      harness.db
        .update(schema.moderationActions)
        .set({ reason: 'rewritten' })
        .where(eq(schema.moderationActions.id, action!.id)),
      /append-only: UPDATE is not permitted/,
    );
  });

  it('rejects DELETE', async () => {
    const layout = await insertLayout();
    const [action] = await harness.db
      .insert(schema.moderationActions)
      .values({ action: 'layout.remove', targetType: 'layout', targetId: layout.id, reason: 'x' })
      .returning();

    await expectRejection(
      harness.db
        .delete(schema.moderationActions)
        .where(eq(schema.moderationActions.id, action!.id)),
      /append-only: DELETE is not permitted/,
    );
  });

  it('rejects TRUNCATE, which row-level triggers would miss', async () => {
    await expectRejection(
      harness.client.query('TRUNCATE moderation_actions'),
      /append-only: TRUNCATE is not permitted/,
    );
  });

  it('survives deletion of the layout it describes', async () => {
    // moderation_actions deliberately has no FK to its target: history has to
    // outlive whatever it describes, or a removal erases its own evidence.
    const layout = await insertLayout();
    await harness.db
      .insert(schema.moderationActions)
      .values({ action: 'layout.remove', targetType: 'layout', targetId: layout.id, reason: 'x' });

    await harness.db.delete(schema.layouts).where(eq(schema.layouts.id, layout.id));

    const surviving = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, layout.id));
    expect(surviving).toHaveLength(1);
  });
});

describe("a layout's history is reconstructable from moderation_actions alone", () => {
  it('returns the full ordered story for one layout', async () => {
    const layout = await insertLayout();
    const moderator = await insertUser({ username: 'mod', role: 'moderator' });

    for (const action of ['layout.create', 'layout.hide', 'layout.unhide'] as const) {
      await harness.db.insert(schema.moderationActions).values({
        actorUserId: action === 'layout.create' ? null : moderator.id,
        actorLabel: action === 'layout.create' ? 'system' : 'mod',
        action,
        targetType: 'layout',
        targetId: layout.id,
        reason: `because ${action}`,
        before: { visibility: 'public' },
        after: { visibility: action === 'layout.hide' ? 'hidden' : 'public' },
      });
    }

    const history = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(
        and(
          eq(schema.moderationActions.targetType, 'layout'),
          eq(schema.moderationActions.targetId, layout.id),
        ),
      )
      .orderBy(asc(schema.moderationActions.createdAt));

    expect(history.map((row) => row.action)).toEqual([
      'layout.create',
      'layout.hide',
      'layout.unhide',
    ]);
    expect(history.every((row) => row.reason !== null)).toBe(true);
    expect(history[1]?.after).toEqual({ visibility: 'hidden' });
  });

  it('survives deletion of the actor account', async () => {
    const layout = await insertLayout();
    const moderator = await insertUser({ username: 'departing-mod', role: 'moderator' });
    await harness.db.insert(schema.moderationActions).values({
      actorUserId: moderator.id,
      actorLabel: 'departing-mod',
      action: 'layout.hide',
      targetType: 'layout',
      targetId: layout.id,
      reason: 'policy',
    });

    // Deleting the account must be possible at all. With a real FK this failed:
    // ON DELETE SET NULL is an UPDATE, which the append-only trigger rejects,
    // so anyone who had ever moderated anything became undeletable.
    await harness.db.delete(schema.users).where(eq(schema.users.id, moderator.id));

    const [row] = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, layout.id));

    // Nothing about the row changed — that is what append-only means. The id is
    // now dangling by design, and actorLabel is what keeps it legible.
    expect(row?.actorUserId).toBe(moderator.id);
    expect(row?.actorLabel).toBe('departing-mod');
    expect(row?.reason).toBe('policy');
  });
});

describe('visibility', () => {
  it('defaults to public — post-moderation has no approval queue', async () => {
    const layout = await insertLayout();
    expect(layout.visibility).toBe('public');
  });

  it('distinguishes moderator-hidden from owner-deleted', async () => {
    // The two need different behaviour on re-submission: an owner may republish
    // what they withdrew, but re-uploading moderator-removed content must not
    // launder it back onto the front page.
    const hidden = await insertLayout({ visibility: 'hidden', visibilityReason: 'under review' });
    const removed = await insertLayout({ visibility: 'removed', visibilityReason: 'policy' });
    const deleted = await insertLayout({ visibility: 'deleted' });

    expect([hidden.visibility, removed.visibility, deleted.visibility]).toEqual([
      'hidden',
      'removed',
      'deleted',
    ]);
  });

  it('carries the reason an owner needs to see', async () => {
    const moderator = await insertUser({ username: 'mod2', role: 'moderator' });
    const layout = await insertLayout({
      visibility: 'hidden',
      visibilityReason: 'hate symbol in tile art',
      visibilityChangedBy: moderator.id,
      visibilityChangedAt: new Date(),
    });
    expect(layout.visibilityReason).toMatch(/hate symbol/);
  });

  it('reserves the slug even when a layout is gone', async () => {
    // Slug reuse by a different author is a quiet impersonation vector, so the
    // row survives and the unique index keeps holding.
    const layout = await insertLayout({ slug: 'taken-forever', visibility: 'removed' });
    expect(layout.slug).toBe('taken-forever');
    await expectRejection(insertLayout({ slug: 'taken-forever' }), /layouts_slug_key/);
  });
});

describe('constraints', () => {
  it('rejects a slug that layout-core would reject', async () => {
    await expectRejection(insertLayout({ slug: 'Not-Kebab' }), /layouts_slug_format/);
    await expectRejection(insertLayout({ slug: '-leading' }), /layouts_slug_format/);
  });

  it('rejects a malformed sha256', async () => {
    await expectRejection(insertLayout({ sha256: 'nope' }), /layouts_sha256_format/);
  });

  it('rejects a non-positive grid', async () => {
    await expectRejection(insertLayout({ cols: 0 }), /layouts_grid_positive/);
  });

  it('requires a discord id for non-system users', async () => {
    await expectRejection(
      harness.db.insert(schema.users).values({ username: 'ghost', discordId: null }),
      /users_discord_id_required/,
    );
  });

  it('forbids a system user from having a discord id', async () => {
    await expectRejection(
      harness.db
        .insert(schema.users)
        .values({ username: 'fake-system', discordId: '123', isSystem: true }),
      /users_system_cannot_login/,
    );
  });

  it('keeps report status and resolution consistent', async () => {
    const layout = await insertLayout();
    await expectRejection(
      harness.db.insert(schema.reports).values({
        layoutId: layout.id,
        reason: 'spam',
        status: 'open',
        resolvedAt: new Date(),
      }),
      /reports_resolution_consistent/,
    );
  });

  it('accepts anonymous reports', async () => {
    // #10 decides whether to accept them; the schema supports both so that
    // decision needs no migration.
    const layout = await insertLayout();
    const [report] = await harness.db
      .insert(schema.reports)
      .values({ layoutId: layout.id, reason: 'hate_symbol', reporterIpHash: 'hashed' })
      .returning();
    expect(report?.reporterUserId).toBeNull();
    expect(report?.status).toBe('open');
  });

  it('refuses to orphan a layout by deleting its author', async () => {
    const author = await insertUser({ username: 'author' });
    await insertLayout({ authorUserId: author.id });
    await expectRejection(
      harness.db.delete(schema.users).where(eq(schema.users.id, author.id)),
      /layouts_author_user_id_users_id_fk/,
    );
  });
});

describe('denormalised stats come from layout-core', () => {
  it('stores exactly what layoutStats() computed', async () => {
    // layoutStats() is the single source of truth for these columns, applied on
    // every write, so a number in the gallery cannot disagree with the layout
    // beside it. This test ties the two packages together.
    const file = path.join(REPO_ROOT, 'layouts/blue-office/layout.json');
    const raw = fs.readFileSync(file);
    const parsed = JSON.parse(raw.toString());
    const stats = layoutStats(parsed);

    const stored = await insertLayout({
      slug: 'blue-office',
      layout: parsed,
      sha256: sha256(raw),
      cols: stats.cols,
      rows: stats.rows,
      furnitureCount: stats.furniture,
      areaCount: stats.areas,
      petCount: stats.pets,
      carpetCount: stats.carpets,
      layoutRevision: stats.layoutRevision,
    });

    expect({
      cols: stored.cols,
      rows: stored.rows,
      furniture: stored.furnitureCount,
      areas: stored.areaCount,
      pets: stored.petCount,
      carpets: stored.carpetCount,
      layoutRevision: stored.layoutRevision,
    }).toEqual(stats);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips the layout JSON unchanged', async () => {
    // The stored layout is the artifact people download; importing it must
    // never surprise them.
    const parsed = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'layouts/four-rooms/layout.json'), 'utf-8'),
    );
    const stored = await insertLayout({ layout: parsed });
    expect(stored.layout).toEqual(parsed);
  });
});

describe('search and tags', () => {
  it('generates a search vector from title and description', async () => {
    await insertLayout({ slug: 'severance-ish', title: 'Severance Office', description: 'Macrodata refinement' });
    const { rows } = await harness.client.query<{ slug: string }>(
      `SELECT slug FROM layouts
       WHERE visibility = 'public' AND search_vector @@ plainto_tsquery('english', 'macrodata')`,
    );
    expect(rows.map((row) => row.slug)).toContain('severance-ish');
  });

  it('cannot drift, because the column is generated', async () => {
    const layout = await insertLayout({ title: 'Before', description: '' });
    await harness.db
      .update(schema.layouts)
      .set({ title: 'Afterwards' })
      .where(eq(schema.layouts.id, layout.id));

    const { rows } = await harness.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM layouts
       WHERE id = $1 AND search_vector @@ plainto_tsquery('english', 'afterwards')`,
      [layout.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('filters by tag through the join table', async () => {
    const [tag] = await harness.db.insert(schema.tags).values({ name: 'open-plan' }).returning();
    const layout = await insertLayout({ slug: 'tagged-office' });
    await harness.db.insert(schema.layoutTags).values({ layoutId: layout.id, tagId: tag!.id });

    const found = await harness.db
      .select({ slug: schema.layouts.slug })
      .from(schema.layouts)
      .innerJoin(schema.layoutTags, eq(schema.layoutTags.layoutId, schema.layouts.id))
      .where(eq(schema.layoutTags.tagId, tag!.id));

    expect(found.map((row) => row.slug)).toEqual(['tagged-office']);
  });

  it('rejects a tag outside the published vocabulary', async () => {
    await expectRejection(
      harness.db.insert(schema.tags).values({ name: 'Open Plan' }),
      /tags_name_format/,
    );
  });

  it('drops tag links with the layout', async () => {
    const [tag] = await harness.db.insert(schema.tags).values({ name: 'temporary' }).returning();
    const layout = await insertLayout();
    await harness.db.insert(schema.layoutTags).values({ layoutId: layout.id, tagId: tag!.id });

    await harness.db.delete(schema.layouts).where(eq(schema.layouts.id, layout.id));
    const links = await harness.db
      .select()
      .from(schema.layoutTags)
      .where(eq(schema.layoutTags.layoutId, layout.id));
    expect(links).toHaveLength(0);
  });
});

describe('updated_at', () => {
  it('is maintained by the database, not by callers remembering', async () => {
    const layout = await insertLayout({ title: 'Original' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [updated] = await harness.db
      .update(schema.layouts)
      .set({ title: 'Renamed' })
      .where(eq(schema.layouts.id, layout.id))
      .returning();

    expect(updated!.updatedAt.getTime()).toBeGreaterThan(layout.updatedAt.getTime());
  });
});
