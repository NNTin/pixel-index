import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { insertUser } from '../test-support/layouts.js';
import { testConfig } from '../test-support/config.js';
import { resolveCapability } from './capability.js';
import { saveDiscordGrant } from './discordGrant.js';

const KEY = Buffer.alloc(32, 9).toString('base64');
const GUILD_ID = '1478428628709802166';
const MODERATOR_ROLE_ID = '1528065925264445622';
const config = testConfig({
  discordGuild: {
    id: GUILD_ID,
    inviteUrl: 'https://discord.gg/pixel-index',
    moderatorRoleIds: [MODERATOR_ROLE_ID],
    oauthTokenEncryptionKey: KEY,
  },
});

let harness: Harness;
beforeAll(async () => { harness = await createTestDatabase(); });
afterAll(async () => harness.close());
afterEach(() => vi.unstubAllGlobals());

async function userWithGrant(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(harness.db, overrides);
  await saveDiscordGrant(harness.db, user.id, {
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'identify guilds.members.read',
  }, KEY);
  return user;
}

function stubMember(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
}

describe('resolveCapability', () => {
  it('preserves a fully functional self-hosted mode when no guild is configured', async () => {
    const adminId = '900000000000000001';
    const admin = await insertUser(harness.db, { discordId: adminId });
    const plain = await insertUser(harness.db);
    const selfHosted = testConfig({ discordAdminIds: [adminId] });
    expect((await resolveCapability(harness.db, selfHosted, admin)).user.role).toBe('admin');
    expect((await resolveCapability(harness.db, selfHosted, plain)).submission.allowed).toBe(true);
  });

  it('maps a guild moderator role and refreshes nickname/profile; pending members may submit', async () => {
    const user = await userWithGrant({ discordId: '900000000000000002' });
    stubMember({
      nick: 'Guild Nick',
      roles: [MODERATOR_ROLE_ID],
      pending: true,
      user: {
        id: user.discordId,
        username: 'fresh-handle',
        global_name: 'Global Name',
        avatar: null,
      },
    });
    const resolved = await resolveCapability(harness.db, config, user, { force: true });
    expect(resolved.user).toMatchObject({
      role: 'moderator',
      username: 'fresh-handle',
      globalName: 'Global Name',
      guildNickname: 'Guild Nick',
      discordGuildMember: true,
    });
    expect(resolved.submission).toEqual({ allowed: true, reason: null });
  });

  it('gives a configured admin user precedence over moderator role IDs after membership verification', async () => {
    const adminId = '900000000000000003';
    const admin = await userWithGrant({ discordId: adminId });
    stubMember({ nick: null, roles: [MODERATOR_ROLE_ID], pending: false });
    const resolved = await resolveCapability(
      harness.db,
      { ...config, discordAdminIds: [adminId] },
      admin,
      { force: true },
    );
    expect(resolved.user.role).toBe('admin');
  });

  it('demotes a user who is no longer in the guild and asks them to join', async () => {
    const user = await userWithGrant({ role: 'moderator' });
    stubMember({ message: 'Unknown Member' }, 404);
    const resolved = await resolveCapability(harness.db, config, user, { force: true });
    expect(resolved.user.role).toBe('user');
    expect(resolved.user.discordGuildMember).toBe(false);
    expect(resolved.submission).toEqual({
      allowed: false,
      reason: 'discord_membership_required',
    });
  });

  it('does not let a missing OAuth grant preserve a cached privileged capability', async () => {
    const user = await insertUser(harness.db, { role: 'admin', discordId: '900000000000000004' });
    const resolved = await resolveCapability(harness.db, config, user, { force: true });
    expect(resolved.user.role).toBe('user');
    expect(resolved.submission).toEqual({
      allowed: false,
      reason: 'discord_reauthorization_required',
    });
  });

  it('turns a Discord missing-scope response into reconnect rather than a transient outage', async () => {
    const user = await userWithGrant({ role: 'moderator' });
    stubMember({ message: 'Missing Access' }, 403);
    const resolved = await resolveCapability(harness.db, config, user, { force: true });
    expect(resolved.user.role).toBe('user');
    expect(resolved.submission.reason).toBe('discord_reauthorization_required');
  });

  it('uses a fresh one-minute observation without calling Discord again', async () => {
    const now = new Date('2026-08-09T12:00:30.000Z');
    const user = await insertUser(harness.db, {
      role: 'moderator',
      discordGuildMember: true,
      discordMembershipCheckedAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    const fetchMock = vi.fn(async () => { throw new Error('must not call Discord'); });
    vi.stubGlobal('fetch', fetchMock);
    const resolved = await resolveCapability(harness.db, config, user, { now });
    expect(resolved.user.role).toBe('moderator');
    expect(resolved.submission.allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a retryable error on a Discord outage without overwriting the last good cache', async () => {
    const checkedAt = new Date('2026-08-09T12:00:00.000Z');
    const user = await userWithGrant({
      role: 'moderator',
      discordGuildMember: true,
      discordMembershipCheckedAt: checkedAt,
    });
    stubMember({ message: 'Discord unavailable' }, 500);
    await expect(
      resolveCapability(harness.db, config, user, {
        now: new Date('2026-08-09T12:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'discord_unavailable' });
    const [unchanged] = await harness.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(unchanged).toMatchObject({
      role: 'moderator',
      discordGuildMember: true,
      discordMembershipCheckedAt: checkedAt,
    });
  });
});
