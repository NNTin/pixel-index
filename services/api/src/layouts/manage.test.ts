import { bundledLayoutRevision, sha256 } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, assert, beforeAll, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
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
