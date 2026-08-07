import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
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
  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
  return { user, accessToken };
}

function patchRole(id: string, role: string, accessToken?: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${id}/role`,
    payload: { role },
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function patchBlock(id: string, body: { blocked: boolean; reason?: string }, accessToken?: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${id}/block`,
    payload: body,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe('PATCH /api/v1/users/:id/role', () => {
  it('is impossible anonymously', async () => {
    const { user } = await tokenFor();
    const response = await patchRole(user.id, 'moderator');
    expect(response.statusCode).toBe(401);
  });

  it('refuses a non-admin', async () => {
    const { user } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patchRole(user.id, 'moderator', modToken);
    expect(response.statusCode).toBe(403);
  });

  it('lets an admin promote a user to moderator', async () => {
    const { user } = await tokenFor();
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await patchRole(user.id, 'moderator', adminToken);
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('moderator');
  });

  it('refuses an admin changing their own role', async () => {
    const { user, accessToken } = await tokenFor({ role: 'admin' });
    const response = await patchRole(user.id, 'user', accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('404s for an unknown user id', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await patchRole('00000000-0000-0000-0000-000000000099', 'moderator', adminToken);
    expect(response.statusCode).toBe(404);
  });

  it('refuses modifying the system user', async () => {
    const system = await insertUser(harness.db, { isSystem: true, discordId: null });
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await patchRole(system.id, 'admin', adminToken);
    expect(response.statusCode).toBe(400);
  });

  it('uses the fresh DB role, not the stale claim in an old token', async () => {
    // Mint the token while admin, then get demoted — the OLD token must
    // stop working immediately, proving this route does not trust the
    // access token's role claim (ADR 0001's stateless-token trade-off).
    const { user: actor, accessToken: staleAdminToken } = await tokenFor({ role: 'admin' });
    await harness.db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, actor.id));

    const { user: target } = await tokenFor();
    const response = await patchRole(target.id, 'moderator', staleAdminToken);
    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /api/v1/users/:id/block', () => {
  it('is impossible anonymously', async () => {
    const { user } = await tokenFor();
    const response = await patchBlock(user.id, { blocked: true, reason: 'spam' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a plain user', async () => {
    const { user } = await tokenFor();
    const { accessToken } = await tokenFor();
    const response = await patchBlock(user.id, { blocked: true, reason: 'spam' }, accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('requires a reason to block', async () => {
    const { user } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patchBlock(user.id, { blocked: true }, modToken);
    expect(response.statusCode).toBe(400);
  });

  it('refuses blocking your own account', async () => {
    const { user, accessToken } = await tokenFor({ role: 'moderator' });
    const response = await patchBlock(user.id, { blocked: true, reason: 'spam' }, accessToken);
    expect(response.statusCode).toBe(403);
  });

  it('lets a moderator block a plain user, and hides their public layouts', async () => {
    const { user } = await tokenFor();
    const layout = await insertLayout(harness.db, { authorUserId: user.id, visibility: 'public' });
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });

    const response = await patchBlock(user.id, { blocked: true, reason: 'spam' }, modToken);
    expect(response.statusCode).toBe(200);
    expect(response.json().blocked).toBe(true);

    const publicView = await app.inject({ method: 'GET', url: `/api/v1/layouts/${layout.slug}` });
    expect(publicView.statusCode).toBe(404);
  });

  it('refuses further submissions from a blocked user, via the DB-fetched (not token-claimed) block check', async () => {
    const { user, accessToken } = await tokenFor();
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    await patchBlock(user.id, { blocked: true, reason: 'spam' }, modToken);

    // manage.ts's requireUnblockedUser fetches a fresh row, so the SAME
    // still-valid access token now fails a write it would have passed a
    // moment ago — proving the check is not trusting the token's claims.
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/layouts/whatever-slug',
      payload: { title: 'x' },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a moderator blocking another moderator or admin', async () => {
    const { user: targetMod } = await tokenFor({ role: 'moderator' });
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });
    const response = await patchBlock(targetMod.id, { blocked: true, reason: 'x' }, modToken);
    expect(response.statusCode).toBe(403);
  });

  it('lets an admin block a moderator', async () => {
    const { user: targetMod } = await tokenFor({ role: 'moderator' });
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await patchBlock(targetMod.id, { blocked: true, reason: 'x' }, adminToken);
    expect(response.statusCode).toBe(200);
  });

  it('unblocking does not auto-restore previously hidden layouts', async () => {
    const { user } = await tokenFor();
    const layout = await insertLayout(harness.db, { authorUserId: user.id, visibility: 'public' });
    const { accessToken: modToken } = await tokenFor({ role: 'moderator' });

    await patchBlock(user.id, { blocked: true, reason: 'spam' }, modToken);
    const unblock = await patchBlock(user.id, { blocked: false }, modToken);
    expect(unblock.statusCode).toBe(200);
    expect(unblock.json().blocked).toBe(false);

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.id, layout.id));
    expect(row!.visibility).toBe('hidden');
  });

  it('refuses modifying the system user', async () => {
    const system = await insertUser(harness.db, { isSystem: true, discordId: null });
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await patchBlock(system.id, { blocked: true, reason: 'x' }, adminToken);
    expect(response.statusCode).toBe(400);
  });
});
