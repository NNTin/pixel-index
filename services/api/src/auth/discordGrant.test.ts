import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertUser } from '../test-support/layouts.js';
import { testConfig } from '../test-support/config.js';
import {
  decryptDiscordToken,
  encryptDiscordToken,
  saveDiscordGrant,
  usableDiscordAccessToken,
} from './discordGrant.js';

const KEY = Buffer.alloc(32, 42).toString('base64');
const config = testConfig();
let harness: Harness;

beforeAll(async () => { harness = await createTestDatabase(); });
afterAll(async () => harness.close());
afterEach(() => vi.unstubAllGlobals());

describe('Discord OAuth grant encryption', () => {
  it('round-trips with AES-256-GCM and a fresh IV', () => {
    const first = encryptDiscordToken('secret-token', KEY);
    const second = encryptDiscordToken('secret-token', KEY);
    expect(first).not.toBe(second);
    expect(first).not.toContain('secret-token');
    expect(decryptDiscordToken(first, KEY)).toBe('secret-token');
  });

  it('rejects tampering instead of returning corrupted plaintext', () => {
    const encrypted = encryptDiscordToken('secret-token', KEY);
    const parts = encrypted.split('.');
    parts[3] = `${parts[3]![0] === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    expect(() => decryptDiscordToken(parts.join('.'), KEY)).toThrow();
  });
});

describe('retained Discord OAuth grants', () => {
  it('stores no plaintext token and returns an unexpired access token', async () => {
    const user = await insertUser(harness.db);
    await saveDiscordGrant(harness.db, user.id, {
      access_token: 'plain-access',
      refresh_token: 'plain-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'identify guilds.members.read',
    }, KEY);
    const [row] = await harness.db
      .select()
      .from(schema.discordOauthGrants)
      .where(eq(schema.discordOauthGrants.userId, user.id));
    expect(row!.encryptedAccessToken).not.toContain('plain-access');
    expect(row!.encryptedRefreshToken).not.toContain('plain-refresh');
    await expect(
      usableDiscordAccessToken(harness.db, user.id, config, KEY),
    ).resolves.toEqual({ status: 'ok', accessToken: 'plain-access' });
  });

  it('requires reauthorization when there is no grant', async () => {
    const user = await insertUser(harness.db);
    await expect(
      usableDiscordAccessToken(harness.db, user.id, config, KEY),
    ).resolves.toEqual({ status: 'reauthorization_required' });
  });

  it('refreshes an expired grant and persists Discord\'s rotated refresh token', async () => {
    const user = await insertUser(harness.db);
    const savedAt = new Date('2026-08-09T12:00:00.000Z');
    await saveDiscordGrant(harness.db, user.id, {
      access_token: 'expired-access',
      refresh_token: 'old-refresh',
      expires_in: 1,
      token_type: 'Bearer',
      scope: 'identify guilds.members.read',
    }, KEY, savedAt);
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh');
      return Response.json({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'identify guilds.members.read',
      });
    }));
    await expect(
      usableDiscordAccessToken(harness.db, user.id, config, KEY, {
        now: new Date('2026-08-09T12:01:00.000Z'),
      }),
    ).resolves.toEqual({ status: 'ok', accessToken: 'fresh-access' });
    const [row] = await harness.db
      .select()
      .from(schema.discordOauthGrants)
      .where(eq(schema.discordOauthGrants.userId, user.id));
    expect(decryptDiscordToken(row!.encryptedAccessToken, KEY)).toBe('fresh-access');
    expect(decryptDiscordToken(row!.encryptedRefreshToken, KEY)).toBe('rotated-refresh');
  });

  it('serializes concurrent refreshes so a rotating refresh token is spent once', async () => {
    const user = await insertUser(harness.db);
    const now = new Date('2026-08-09T12:01:00.000Z');
    await saveDiscordGrant(harness.db, user.id, {
      access_token: 'expired-concurrent-access',
      refresh_token: 'single-use-refresh',
      expires_in: 0,
      token_type: 'Bearer',
      scope: 'identify guilds.members.read',
    }, KEY, new Date('2026-08-09T12:00:00.000Z'));
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({
        access_token: 'concurrent-fresh-access',
        refresh_token: 'concurrent-rotated-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'identify guilds.members.read',
      });
    });
    vi.stubGlobal('fetch', refresh);
    const results = await Promise.all([
      usableDiscordAccessToken(harness.db, user.id, config, KEY, { now }),
      usableDiscordAccessToken(harness.db, user.id, config, KEY, { now }),
    ]);
    expect(results).toEqual([
      { status: 'ok', accessToken: 'concurrent-fresh-access' },
      { status: 'ok', accessToken: 'concurrent-fresh-access' },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('deletes a grant Discord rejects during refresh and requires new consent', async () => {
    const user = await insertUser(harness.db);
    await saveDiscordGrant(harness.db, user.id, {
      access_token: 'expired-access',
      refresh_token: 'revoked-refresh',
      expires_in: 0,
      token_type: 'Bearer',
      scope: 'identify guilds.members.read',
    }, KEY, new Date(0));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid grant', { status: 400 })));
    await expect(
      usableDiscordAccessToken(harness.db, user.id, config, KEY),
    ).resolves.toEqual({ status: 'reauthorization_required' });
    const rows = await harness.db
      .select()
      .from(schema.discordOauthGrants)
      .where(eq(schema.discordOauthGrants.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it('deletes ciphertext that cannot be decrypted with the configured key', async () => {
    const user = await insertUser(harness.db);
    await saveDiscordGrant(harness.db, user.id, {
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'identify guilds.members.read',
    }, KEY);
    const wrongKey = Buffer.alloc(32, 1).toString('base64');
    await expect(
      usableDiscordAccessToken(harness.db, user.id, config, wrongKey),
    ).resolves.toEqual({ status: 'reauthorization_required' });
    const rows = await harness.db
      .select()
      .from(schema.discordOauthGrants)
      .where(eq(schema.discordOauthGrants.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
