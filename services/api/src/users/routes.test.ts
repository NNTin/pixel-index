import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';

const ADMIN_DISCORD_ID = '1528094749993599038';
const config = testConfig({ discordAdminIds: [ADMIN_DISCORD_ID] });
const fakePool = { query: async () => ({ rows: [] }) };

let harness: Harness;
let app: FastifyInstance;
let adminAccessToken: string;
beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({ config, pool: fakePool, db: harness.db });
  const [admin] = await harness.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, ADMIN_DISCORD_ID));
  if (!admin) throw new Error('Bundled author migration did not create the configured admin.');
  adminAccessToken = await signAccessToken(
    { sub: admin.id },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

describe('GET /api/v1/admin/users', () => {
  it('is admin-only', async () => {
    const plain = await insertUser(harness.db, { username: 'plain-directory-user' });
    const plainToken = await signAccessToken({ sub: plain.id }, config.sessionSecret, 60_000);
    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/users' });
    const asPlain = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(anon.statusCode).toBe(401);
    expect(asPlain.statusCode).toBe(403);
  });

  it('lists only Pixel Index accounts with cached capability and all-visibility layout counts', async () => {
    const accessToken = adminAccessToken;
    const target = await insertUser(harness.db, {
      username: 'findable-directory-target',
      globalName: 'Findable User',
      role: 'moderator',
      discordMembershipCheckedAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    const system = await insertUser(harness.db, {
      isSystem: true,
      discordId: null,
      username: 'findable-system-user',
    });
    await insertLayout(harness.db, { authorUserId: target.id, visibility: 'public' });
    await insertLayout(harness.db, { authorUserId: target.id, visibility: 'hidden' });
    await insertLayout(harness.db, { authorUserId: system.id, visibility: 'public' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=findable&capability=moderator',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      users: [{
        id: target.id,
        username: 'findable-directory-target',
        displayName: 'Findable User',
        avatarUrl: null,
        capability: 'moderator',
        capabilityCheckedAt: '2026-08-09T12:00:00.000Z',
        layoutCount: 2,
      }],
      nextCursor: null,
    });
  });

  it('paginates without exposing Discord ids or role ids', async () => {
    const accessToken = adminAccessToken;
    await insertUser(harness.db, { username: 'pagination-one' });
    await insertUser(harness.db, { username: 'pagination-two' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?limit=1&q=pagination',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().users).toHaveLength(1);
    expect(response.json().nextCursor).toBeTruthy();
    expect(response.body).not.toContain('discordId');
    expect(response.body).not.toContain('roleIds');
  });
});
