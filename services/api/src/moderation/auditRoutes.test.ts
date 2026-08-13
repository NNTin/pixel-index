import type { FastifyInstance } from 'fastify';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

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
  if (overrides.role === 'moderator' || overrides.role === 'admin') {
    // Nullable by design — schema.ts allows it for the synthetic system user —
    // and insertUser is free to be handed `discordId: null`. This helper never
    // does, so the check is what says that rather than a bare `!`.
    assert(user.discordId !== null, 'insertUser did not give the moderator/admin a Discord id');
    config.discordAdminIds.push(user.discordId);
  }
  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
  return { user, accessToken };
}

function listAuditLog(query: string, accessToken?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/admin/moderation-actions${query ? `?${query}` : ''}`,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

interface AuditActionBody {
  id: string;
  action: string;
  reason: string | null;
  actorLabel: string | null;
  layoutSlug: string | null;
}
interface ListAuditActionsBody {
  actions: AuditActionBody[];
  nextCursor: string | null;
}

describe('GET /api/v1/admin/moderation-actions', () => {
  it('is admin-only', async () => {
    // Mirrors users/routes.test.ts's own admin-only test: without a
    // configured Discord guild, `resolveCapability` can only ever resolve to
    // 'admin' or 'user' (moderator requires real guild role mapping this
    // lightweight test config doesn't set up), so there is no distinct
    // moderator token to assert 403 against here.
    const anon = await listAuditLog('');
    expect(anon.statusCode).toBe(401);

    const { accessToken: userToken } = await tokenFor();
    const asUser = await listAuditLog('', userToken);
    expect(asUser.statusCode).toBe(403);

    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const asAdmin = await listAuditLog('', adminToken);
    expect(asAdmin.statusCode).toBe(200);
  });

  it("shows a layout's full history, resolved by its current slug", async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const { user: owner } = await tokenFor();
    const layout = await insertLayout(harness.db, {
      slug: 'history-target',
      title: 'History Target',
      authorUserId: owner.id,
    });
    await harness.db.insert(schema.moderationActions).values([
      { action: 'layout.create', targetType: 'layout', targetId: layout.id, actorLabel: owner.username },
      {
        action: 'layout.hide',
        targetType: 'layout',
        targetId: layout.id,
        actorLabel: 'some-moderator',
        reason: 'spam',
      },
    ]);

    const response = await listAuditLog('slug=history-target', adminToken);
    expect(response.statusCode).toBe(200);
    const body = response.json<ListAuditActionsBody>();
    const actions = body.actions.map((entry) => entry.action).sort();
    expect(actions).toEqual(['layout.create', 'layout.hide']);
    expect(body.actions.every((entry) => entry.layoutSlug === 'history-target')).toBe(true);
  });

  it('lists user and owner actions, not just moderator ones', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const layout = await insertLayout(harness.db, { slug: 'owner-action-target' });
    await harness.db.insert(schema.moderationActions).values({
      action: 'layout.update',
      targetType: 'layout',
      targetId: layout.id,
      actorLabel: 'the-owner',
      reason: null,
    });

    const response = await listAuditLog('slug=owner-action-target', adminToken);
    const body = response.json<ListAuditActionsBody>();
    expect(body.actions.some((entry) => entry.action === 'layout.update' && entry.actorLabel === 'the-owner')).toBe(
      true,
    );
  });

  it('filters by action type', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const layout = await insertLayout(harness.db, { slug: 'action-type-target' });
    await harness.db.insert(schema.moderationActions).values([
      { action: 'layout.hide', targetType: 'layout', targetId: layout.id, reason: 'x' },
      { action: 'layout.rename_slug', targetType: 'layout', targetId: layout.id, reason: 'x' },
    ]);

    const response = await listAuditLog('slug=action-type-target&action=layout.rename_slug', adminToken);
    const body = response.json<ListAuditActionsBody>();
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]?.action).toBe('layout.rename_slug');
  });

  it('returns an empty page for a slug nothing currently resolves to', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await listAuditLog('slug=no-such-layout-anywhere', adminToken);
    expect(response.statusCode).toBe(200);
    expect(response.json<ListAuditActionsBody>().actions).toEqual([]);
  });
});
