import { bundledLayoutRevision, sha256, SLUG_RE } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, assert, beforeAll, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import { one } from '../db/rows.js';
import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';
import type { ListOwnerLayoutsBody } from './responses.js';
import type { OwnerLayoutView } from './serialize.js';

const config = testConfig({
  writeRateLimit: { max: 1000, windowMs: 60_000 },
});
const fakePool = { query: async () => ({ rows: [] }) };
const BUNDLED_REVISION = bundledLayoutRevision();

let harness: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({ config, pool: fakePool, db: harness.db });
});
afterAll(async () => {
  await app.close();
  await harness.close();
});
afterEach(() => vi.unstubAllGlobals());

let marker = 0;
function validLayoutJson(overrides: Record<string, unknown> = {}): string {
  marker += 1;
  return JSON.stringify({
    version: 1,
    layoutRevision: BUNDLED_REVISION,
    cols: 4,
    rows: 4,
    tiles: Array(16).fill(0),
    furniture: [],
    testMarker: marker,
    ...overrides,
  });
}

async function tokenFor(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(harness.db, overrides);
  if (overrides.role === 'moderator' || overrides.role === 'admin') {
    // Nullable by design — schema.ts allows it for the synthetic system user —
    // and insertUser is free to be handed `discordId: null`. This helper never
    // does, so the check is what says that rather than a bare `!`.
    assert(user.discordId !== null, 'insertUser did not give the moderator a Discord id');
    config.discordAdminIds.push(user.discordId);
  }
  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
  return { user, accessToken };
}

/** A published layout owned by a fresh user, for tests that mutate it. */
async function ownedLayout(overrides: Parameters<typeof insertLayout>[1] = {}) {
  const { user, accessToken } = await tokenFor();
  const raw = validLayoutJson();
  const layout = await insertLayout(harness.db, {
    authorUserId: user.id,
    raw,
    layout: JSON.parse(raw),
    sha256: sha256(raw),
    visibility: 'public',
    ...overrides,
  });
  return { user, accessToken, layout };
}

async function getLayoutById(id: string): Promise<schema.Layout> {
  return one(await harness.db.select().from(schema.layouts).where(eq(schema.layouts.id, id)));
}

function stubRenderer(mode: 'ok' | 'down' = 'ok') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      mode === 'ok'
        ? new Response(Buffer.from([137, 80, 78, 71]), {
            status: 200,
            headers: { 'content-type': 'image/png', etag: '"fake"' },
          })
        : Promise.reject(new Error('renderer unreachable')),
    ),
  );
}

function patch(slug: string, body: unknown, accessToken?: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/layouts/${slug}`,
    payload: body as Record<string, unknown>,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function put(slug: string, body: string, accessToken?: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/layouts/${slug}/layout`,
    payload: body,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
  });
}

function del(slug: string, accessToken?: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/layouts/${slug}`,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe('PATCH /api/v1/layouts/:slug — owner edits', () => {
  it('is impossible anonymously', async () => {
    const { layout } = await ownedLayout();
    const response = await patch(layout.slug, { title: 'New Title' });
    expect(response.statusCode).toBe(401);
  });

  it('lets the owner edit title, description and tags without a reason', async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(
      layout.slug,
      { title: 'Renamed', description: 'updated', tags: ['cosy'] },
      accessToken,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<OwnerLayoutView>();
    expect(body.title).toBe('Renamed');
    expect(body.description).toBe('updated');
    expect(body.tags).toEqual(['cosy']);
  });

  it('refuses a stranger editing a layout that is not theirs', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: stranger } = await tokenFor();
    const response = await patch(layout.slug, { title: 'Hijacked' }, stranger);
    expect(response.statusCode).toBe(403);
  });

  it('refuses an owner setting visibility', async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(layout.slug, { visibility: 'hidden', reason: 'nah' }, accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('404s for an unknown slug', async () => {
    const { accessToken } = await tokenFor();
    const response = await patch('no-such-layout', { title: 'x' }, accessToken);
    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /api/v1/layouts/:slug — moderation', () => {
  it('lets a moderator hide a layout with a reason', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { visibility: 'hidden', reason: 'spam' }, modToken);
    expect(response.statusCode).toBe(200);
    expect(response.json<OwnerLayoutView>().visibility).toBe('hidden');
    expect(response.json<OwnerLayoutView>().visibilityReason).toBe('spam');

    const publicView = await app.inject({ method: 'GET', url: `/api/v1/layouts/${layout.slug}` });
    expect(publicView.statusCode).toBe(404);
  });

  it('requires a reason to hide, remove or restore', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { visibility: 'removed' }, modToken);
    expect(response.statusCode).toBe(400);
  });

  it('requires a reason for a moderator editing another user\'s metadata, even without a visibility change', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { title: 'Cleaned Up Title' }, modToken);
    expect(response.statusCode).toBe(400);
  });

  it('refuses a plain user setting visibility even on their own layout', async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(layout.slug, { visibility: 'hidden', reason: 'x' }, accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('is reversible: a removed layout can be restored by a moderator', async () => {
    const { layout } = await ownedLayout({ visibility: 'removed' });
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { visibility: 'public', reason: 'appeal granted' }, modToken);
    expect(response.statusCode).toBe(200);
    expect(response.json<OwnerLayoutView>().visibility).toBe('public');
  });
});

describe('PATCH /api/v1/layouts/:slug — vanity slug (#29)', () => {
  it('lets a moderator set a vanity slug with a reason', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(
      layout.slug,
      { slug: 'severance-office', reason: 'vanity url granted' },
      modToken,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<OwnerLayoutView>().slug).toBe('severance-office');

    const atNewSlug = await app.inject({ method: 'GET', url: '/api/v1/layouts/severance-office' });
    expect(atNewSlug.statusCode).toBe(200);

    const atOldSlug = await app.inject({ method: 'GET', url: `/api/v1/layouts/${layout.slug}` });
    expect(atOldSlug.statusCode).toBe(404);
  });

  it('rejects an exact collision with a 409 rather than silently suffixing it', async () => {
    await insertLayout(harness.db, { slug: 'taken-vanity-slug' });
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { slug: 'taken-vanity-slug', reason: 'rename' }, modToken);
    expect(response.statusCode).toBe(409);
  });

  it("refuses a non-moderator — even the layout's own owner — from setting a slug", async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(layout.slug, { slug: 'my-own-vanity-slug', reason: 'x' }, accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('requires a reason for a slug change', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { slug: 'no-reason-given' }, modToken);
    expect(response.statusCode).toBe(400);
  });

  it('rejects a slug that does not match the shared kebab-case format', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { slug: 'Not Valid!', reason: 'x' }, modToken);
    expect(response.statusCode).toBe(400);
  });

  it('frees the old slug immediately — a different layout can claim it once it is vacated', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const renamed = await patch(layout.slug, { slug: 'new-vanity-name', reason: 'rename' }, modToken);
    expect(renamed.statusCode).toBe(200);

    const { layout: otherLayout } = await ownedLayout();
    const reclaim = await patch(otherLayout.slug, { slug: layout.slug, reason: 'reuse the freed slug' }, modToken);
    expect(reclaim.statusCode).toBe(200);
  });

  it('lets a layout rename back to a slug it used to have', async () => {
    const { layout } = await ownedLayout({ slug: 'blue-office' });
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });

    const away = await patch(layout.slug, { slug: 'temporary-random-name', reason: 'testing' }, modToken);
    expect(away.statusCode).toBe(200);

    const back = await patch('temporary-random-name', { slug: 'blue-office', reason: 'revert' }, modToken);
    expect(back.statusCode).toBe(200);
    expect(back.json<OwnerLayoutView>().slug).toBe('blue-office');

    const atRevertedSlug = await app.inject({ method: 'GET', url: '/api/v1/layouts/blue-office' });
    expect(atRevertedSlug.statusCode).toBe(200);
  });

  it('still blocks a slug held by a HIDDEN layout — it might come back to public', async () => {
    await insertLayout(harness.db, { slug: 'hidden-office', visibility: 'hidden' });
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(layout.slug, { slug: 'hidden-office', reason: 'x' }, modToken);
    expect(response.statusCode).toBe(409);
  });

  it('lets a newer layout take over a REMOVED layout\'s vanity slug (#29 "reuse the same URL")', async () => {
    const superseded = await insertLayout(harness.db, { slug: 'moonbase-office', visibility: 'removed' });
    const { layout: newer } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });

    const response = await patch(newer.slug, { slug: 'moonbase-office', reason: 'newer version' }, modToken);
    expect(response.statusCode).toBe(200);
    expect(response.json<OwnerLayoutView>().slug).toBe('moonbase-office');

    const atSlug = await app.inject({ method: 'GET', url: '/api/v1/layouts/moonbase-office' });
    expect(atSlug.statusCode).toBe(200);
    expect(atSlug.json<{ sha256: string }>().sha256).toBe(newer.sha256);

    // The superseded layout is not left slug-less — it was evicted to a
    // fresh, still-valid random slug, not silently deleted or broken.
    const evictedRow = await getLayoutById(superseded.id);
    expect(evictedRow.slug).not.toBe('moonbase-office');
    expect(evictedRow.slug).toMatch(SLUG_RE);
  });

  it("lets a newer layout take over a DELETED (owner-withdrawn) layout's vanity slug", async () => {
    await insertLayout(harness.db, { slug: 'withdrawn-office', visibility: 'deleted' });
    const { layout: newer } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });

    const response = await patch(newer.slug, { slug: 'withdrawn-office', reason: 'newer version' }, modToken);
    expect(response.statusCode).toBe(200);
    expect(response.json<OwnerLayoutView>().slug).toBe('withdrawn-office');
  });

  it('records an audit entry for the evicted layout, attributed to the acting moderator', async () => {
    const superseded = await insertLayout(harness.db, { slug: 'evicted-office', visibility: 'removed' });
    const { layout: newer } = await ownedLayout();
    const { accessToken: modToken, user: moderator } = await tokenFor({ role: 'moderator' });

    const response = await patch(newer.slug, { slug: 'evicted-office', reason: 'newer version' }, modToken);
    expect(response.statusCode).toBe(200);

    const evictionEntries = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, superseded.id));
    const evictionEntry = evictionEntries.find((entry) => entry.action === 'layout.rename_slug');
    expect(evictionEntry).toBeDefined();
    expect(evictionEntry?.actorUserId).toBe(moderator.id);
    expect(evictionEntry?.before).toMatchObject({ slug: 'evicted-office' });
    // The exact reason the moderator typed, not a synthesized paraphrase of
    // it — the automatic-reassignment context is already implicit in the
    // action label and the before/after snapshot.
    expect(evictionEntry?.reason).toBe('newer version');
  });
});

describe('PATCH /api/v1/layouts/:slug — audit trail granularity', () => {
  async function moderationActionsFor(targetId: string) {
    return harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, targetId))
      .orderBy(schema.moderationActions.createdAt);
  }

  it('writes one row per category of change, all sharing the same reason', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(
      layout.slug,
      { title: 'Retitled', visibility: 'hidden', reason: 'combined moderation pass' },
      modToken,
    );
    expect(response.statusCode).toBe(200);

    const entries = await moderationActionsFor(layout.id);
    const actions = entries.map((entry) => entry.action).sort();
    expect(actions).toEqual(['layout.hide', 'layout.moderate_edit'].sort());
    expect(entries.every((entry) => entry.reason === 'combined moderation pass')).toBe(true);
  });

  it('writes three rows when metadata, visibility and slug all change in one request', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patch(
      layout.slug,
      { title: 'Retitled', visibility: 'hidden', slug: 'three-at-once', reason: 'full sweep' },
      modToken,
    );
    expect(response.statusCode).toBe(200);

    const entries = await moderationActionsFor(layout.id);
    const actions = entries.map((entry) => entry.action).sort();
    expect(actions).toEqual(['layout.hide', 'layout.moderate_edit', 'layout.rename_slug'].sort());
  });

  it('scopes the metadata row\'s before/after to only the fields that actually changed', async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(layout.slug, { title: 'New Title Only' }, accessToken);
    expect(response.statusCode).toBe(200);

    const entries = await moderationActionsFor(layout.id);
    const metadataEntry = entries.find((entry) => entry.action === 'layout.update');
    expect(metadataEntry?.before).toEqual({ title: layout.title });
    expect(metadataEntry?.after).toEqual({ title: 'New Title Only' });
  });

  it('captures a tag change in the metadata row even though title/description are untouched', async () => {
    const { accessToken, layout } = await ownedLayout();
    const response = await patch(layout.slug, { tags: ['cosy', 'small'] }, accessToken);
    expect(response.statusCode).toBe(200);

    const entries = await moderationActionsFor(layout.id);
    const metadataEntry = entries.find((entry) => entry.action === 'layout.update');
    expect(metadataEntry).toBeDefined();
    expect(metadataEntry?.before).toEqual({ tags: [] });
    expect(metadataEntry?.after).toEqual({ tags: ['cosy', 'small'] });
  });

  it('writes nothing for a no-op resubmission of the same title', async () => {
    const { accessToken, layout } = await ownedLayout();
    const before = await moderationActionsFor(layout.id);
    const response = await patch(layout.slug, { title: layout.title }, accessToken);
    expect(response.statusCode).toBe(200);

    const after = await moderationActionsFor(layout.id);
    expect(after).toHaveLength(before.length);
  });

  it('writes nothing for a no-op resubmission of the same tag set, regardless of order', async () => {
    const { accessToken, layout } = await ownedLayout();
    await patch(layout.slug, { tags: ['cosy', 'small'] }, accessToken);
    const before = await moderationActionsFor(layout.id);

    const response = await patch(layout.slug, { tags: ['small', 'cosy'] }, accessToken);
    expect(response.statusCode).toBe(200);

    const after = await moderationActionsFor(layout.id);
    expect(after).toHaveLength(before.length);
  });
});

describe('PUT /api/v1/layouts/:slug/layout — owner replace', () => {
  it('is owner-only, even for a moderator', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    stubRenderer();
    const response = await put(layout.slug, validLayoutJson(), modToken);
    expect(response.statusCode).toBe(403);
  });

  it('replaces the content byte-for-byte and updates stats', async () => {
    const { accessToken, layout } = await ownedLayout();
    stubRenderer();
    const raw = validLayoutJson({ cols: 6, rows: 6, tiles: Array(36).fill(0) });
    const response = await put(layout.slug, raw, accessToken);
    expect(response.statusCode).toBe(200);
    const body = response.json<OwnerLayoutView>();
    expect(body.cols).toBe(6);
    expect(body.rows).toBe(6);

    const download = await app.inject({ method: 'GET', url: `/api/v1/layouts/${layout.slug}/download` });
    expect(download.body).toBe(raw);
  });

  it('rejects a replacement that fails layout-core validation', async () => {
    const { accessToken, layout } = await ownedLayout();
    stubRenderer();
    const response = await put(layout.slug, validLayoutJson({ tiles: [0, 0] }), accessToken);
    expect(response.statusCode).toBe(422);
  });

  it('rejects replacing with content byte-identical to a different public layout', async () => {
    const raw = validLayoutJson({ cols: 5, rows: 5, tiles: Array(25).fill(0) });
    await insertLayout(harness.db, {
      raw,
      layout: JSON.parse(raw),
      sha256: sha256(raw),
      visibility: 'public',
      slug: 'someone-elses-office',
    });
    const { accessToken, layout } = await ownedLayout();
    stubRenderer();
    const response = await put(layout.slug, raw, accessToken);
    expect(response.statusCode).toBe(409);
  });

  it('allows replacing with content matching one of the owner\'s own previously-deleted layouts', async () => {
    const raw = validLayoutJson({ cols: 7, rows: 7, tiles: Array(49).fill(0) });
    const { accessToken, layout, user } = await ownedLayout();
    await insertLayout(harness.db, {
      authorUserId: user.id,
      raw,
      layout: JSON.parse(raw),
      sha256: sha256(raw),
      visibility: 'deleted',
      slug: 'withdrawn-earlier',
    });
    stubRenderer();
    const response = await put(layout.slug, raw, accessToken);
    expect(response.statusCode).toBe(200);
  });
});

describe('DELETE /api/v1/layouts/:slug — owner withdrawal', () => {
  it('is owner-only', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: stranger } = await tokenFor();
    const response = await del(layout.slug, stranger);
    expect(response.statusCode).toBe(403);
  });

  it('a moderator cannot delete via this route', async () => {
    const { layout } = await ownedLayout();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await del(layout.slug, modToken);
    expect(response.statusCode).toBe(403);
  });

  it('deletes and is idempotent on re-delete', async () => {
    const { accessToken, layout } = await ownedLayout();
    const first = await del(layout.slug, accessToken);
    expect(first.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/api/v1/layouts/${layout.slug}` });
    expect(gone.statusCode).toBe(404);

    const second = await del(layout.slug, accessToken);
    expect(second.statusCode).toBe(204);
  });
});

describe('GET /api/v1/me/layouts', () => {
  it('is impossible anonymously', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/layouts' });
    expect(response.statusCode).toBe(401);
  });

  it('lists the caller\'s own layouts regardless of visibility, and nobody else\'s', async () => {
    const { accessToken, user } = await tokenFor();
    await insertLayout(harness.db, { authorUserId: user.id, visibility: 'public', slug: 'mine-public' });
    await insertLayout(harness.db, { authorUserId: user.id, visibility: 'hidden', slug: 'mine-hidden' });
    const { user: other } = await tokenFor();
    await insertLayout(harness.db, { authorUserId: other.id, visibility: 'public', slug: 'not-mine' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/layouts',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const slugs = response.json<ListOwnerLayoutsBody>().layouts.map((l) => l.slug);
    expect(slugs.sort()).toEqual(['mine-hidden', 'mine-public']);
  });
});
