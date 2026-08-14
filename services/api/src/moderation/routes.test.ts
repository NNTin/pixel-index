import type { FastifyInstance } from 'fastify';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import type { ListOwnerLayoutsBody } from '../layouts/responses.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';

const config = testConfig();
const fakePool = { query: async () => ({ rows: [] }) };

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

function listModerationLayouts(query: string, accessToken?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/moderation/layouts${query ? `?${query}` : ''}`,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe('GET /api/v1/moderation/layouts', () => {
  it('is moderator-minimum', async () => {
    const { accessToken: userToken } = await tokenFor();
    const anon = await listModerationLayouts('');
    expect(anon.statusCode).toBe(401);
    const asUser = await listModerationLayouts('', userToken);
    expect(asUser.statusCode).toBe(403);
  });

  it('sees every visibility, from every author — what the public list and /me/layouts each cannot', async () => {
    const { user: owner } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    await insertLayout(harness.db, { slug: 'mod-visible-public', authorUserId: owner.id, visibility: 'public' });
    await insertLayout(harness.db, { slug: 'mod-visible-hidden', authorUserId: owner.id, visibility: 'hidden' });
    await insertLayout(harness.db, { slug: 'mod-visible-deleted', authorUserId: owner.id, visibility: 'deleted' });

    const response = await listModerationLayouts(`author=${owner.id}`, modToken);
    expect(response.statusCode).toBe(200);
    const slugs = response.json<ListOwnerLayoutsBody>().layouts.map((l) => l.slug);
    expect(slugs.sort()).toEqual(
      ['mod-visible-deleted', 'mod-visible-hidden', 'mod-visible-public'].sort(),
    );
  });

  it('filters to one visibility on request', async () => {
    const { user: owner } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    await insertLayout(harness.db, { slug: 'mod-filter-public', authorUserId: owner.id, visibility: 'public' });
    await insertLayout(harness.db, { slug: 'mod-filter-hidden', authorUserId: owner.id, visibility: 'hidden' });

    const response = await listModerationLayouts(`author=${owner.id}&visibility=hidden`, modToken);
    const slugs = response.json<ListOwnerLayoutsBody>().layouts.map((l) => l.slug);
    expect(slugs).toEqual(['mod-filter-hidden']);
  });

  it('includes the fields owners see (visibility, reason) that the public shape omits', async () => {
    const { user: owner } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    await insertLayout(harness.db, {
      slug: 'mod-fields-hidden',
      authorUserId: owner.id,
      visibility: 'hidden',
      visibilityReason: 'spam',
    });

    const response = await listModerationLayouts(`author=${owner.id}&visibility=hidden`, modToken);
    const layout = response.json<ListOwnerLayoutsBody>().layouts[0];
    expect(layout?.visibility).toBe('hidden');
    expect(layout?.visibilityReason).toBe('spam');
  });
});
