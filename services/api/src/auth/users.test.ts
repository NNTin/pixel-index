import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { discordAvatarUrl } from './discord.js';
import { upsertDiscordUser } from './users.js';

let harness: Harness;
beforeAll(async () => {
  harness = await createTestDatabase();
});
afterAll(async () => harness.close());

const discordUser = (overrides: Partial<{ id: string; username: string; globalName: string | null; avatar: string | null }> = {}) => ({
  id: `${Math.floor(Math.random() * 1e18)}`,
  username: 'newcomer',
  globalName: null,
  avatar: null,
  ...overrides,
});

describe('upsertDiscordUser — creation', () => {
  it('creates a new user with role "user" by default', async () => {
    const du = discordUser({ id: '1001', username: 'alice' });
    const user = await upsertDiscordUser(harness.db, du);
    expect(user.discordId).toBe('1001');
    expect(user.username).toBe('alice');
    expect(user.role).toBe('user');
    expect(user.avatarUrl).toBe(discordAvatarUrl(du));
  });

});

describe('upsertDiscordUser — returning login', () => {
  it('refreshes cached username, global display name and avatar', async () => {
    const du = discordUser({ id: '2001', username: 'old-name', avatar: null });
    await upsertDiscordUser(harness.db, du);

    const renamed = { ...du, username: 'new-name', globalName: 'New Name', avatar: 'freshavatar' };
    const user = await upsertDiscordUser(harness.db, renamed);
    expect(user.username).toBe('new-name');
    expect(user.globalName).toBe('New Name');
    expect(user.avatarUrl).toBe(discordAvatarUrl(renamed));
  });

  it('never downgrades a role login does not own — a moderator stays a moderator', async () => {
    const du = discordUser({ id: '2003' });
    const created = await upsertDiscordUser(harness.db, du);
    await harness.db.update(schema.users).set({ role: 'moderator' }).where(eq(schema.users.id, created.id));

    const user = await upsertDiscordUser(harness.db, du);
    expect(user.role).toBe('moderator');
  });

  it('does not touch the capability cache during profile upsert', async () => {
    const du = discordUser({ id: '2004' });
    const created = await upsertDiscordUser(harness.db, du);
    await harness.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, created.id));
    const user = await upsertDiscordUser(harness.db, du);
    expect(user.role).toBe('admin');
  });

  it('does not create a duplicate row for the same Discord id', async () => {
    const du = discordUser({ id: '2005' });
    await upsertDiscordUser(harness.db, du);
    await upsertDiscordUser(harness.db, du);
    const rows = await harness.db.select().from(schema.users).where(eq(schema.users.discordId, '2005'));
    expect(rows).toHaveLength(1);
  });
});
