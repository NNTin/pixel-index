import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import {
  consumeLoginCode,
  createLoginCode,
  createSession,
  revokeAllSessionsForUser,
  revokeSession,
  rotateRefreshToken,
} from './sessions.js';
import { verifyAccessToken } from './tokens.js';

const CONFIG = {
  sessionSecret: 'a'.repeat(32),
  accessTokenTtlMs: 60_000,
  refreshTokenTtlMs: 60_000,
  loginCodeTtlMs: 60_000,
};

let harness: Harness;
beforeAll(async () => {
  harness = await createTestDatabase();
});
afterAll(async () => harness.close());

async function insertUser(overrides: Partial<schema.NewUser> = {}) {
  const [user] = await harness.db
    .insert(schema.users)
    .values({ discordId: `d-${Math.random()}`, username: 'someone', role: 'user', ...overrides })
    .returning();
  return user!;
}

describe('createSession', () => {
  it('mints an access token that verifies and carries the right claims', async () => {
    const user = await insertUser({ role: 'moderator' });
    const tokens = await createSession(harness.db, user, CONFIG);
    const claims = await verifyAccessToken(tokens.accessToken, CONFIG.sessionSecret);
    expect(claims).toEqual({ sub: user.id });
  });

  it('stores only the refresh token hash, never the raw value', async () => {
    const user = await insertUser();
    const tokens = await createSession(harness.db, user, CONFIG);
    const rows = await harness.db
      .select()
      .from(schema.authRefreshTokens)
      .where(eq(schema.authRefreshTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(tokens.refreshToken);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two logins get two independent families', async () => {
    const user = await insertUser();
    await createSession(harness.db, user, CONFIG);
    await createSession(harness.db, user, CONFIG);
    const rows = await harness.db
      .select()
      .from(schema.authRefreshTokens)
      .where(eq(schema.authRefreshTokens.userId, user.id));
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(2);
  });
});

describe('rotateRefreshToken', () => {
  it('rotating gives a usable new pair', async () => {
    const user = await insertUser();
    const first = await createSession(harness.db, user, CONFIG);
    const outcome = await rotateRefreshToken(harness.db, first.refreshToken, CONFIG);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('unreachable');
    expect(outcome.tokens.refreshToken).not.toBe(first.refreshToken);
    const claims = await verifyAccessToken(outcome.tokens.accessToken, CONFIG.sessionSecret);
    expect(claims?.sub).toBe(user.id);
  });

  it('rejects an unknown token', async () => {
    const outcome = await rotateRefreshToken(harness.db, 'never-issued', CONFIG);
    expect(outcome.status).toBe('invalid');
  });

  it('rejects an expired token', async () => {
    const user = await insertUser();
    const expired = await createSession(harness.db, user, { ...CONFIG, refreshTokenTtlMs: -1 });
    const outcome = await rotateRefreshToken(harness.db, expired.refreshToken, CONFIG);
    expect(outcome.status).toBe('invalid');
  });

  it('rejects a revoked token', async () => {
    const user = await insertUser();
    const tokens = await createSession(harness.db, user, CONFIG);
    await revokeSession(harness.db, tokens.refreshToken);
    const outcome = await rotateRefreshToken(harness.db, tokens.refreshToken, CONFIG);
    expect(outcome.status).toBe('invalid');
  });

  it('reuse of an already-rotated token revokes the WHOLE family, not just that token', async () => {
    // This is the reuse-detection property the ADR calls out: a stolen and
    // replayed refresh token has to poison the legitimate holder's session
    // too, since at that point neither copy can be trusted.
    const user = await insertUser();
    const first = await createSession(harness.db, user, CONFIG);
    const rotated = await rotateRefreshToken(harness.db, first.refreshToken, CONFIG);
    expect(rotated.status).toBe('ok');
    if (rotated.status !== 'ok') throw new Error('unreachable');

    // The original token is replayed (e.g. by whoever stole it).
    const replay = await rotateRefreshToken(harness.db, first.refreshToken, CONFIG);
    expect(replay.status).toBe('reused');

    // The legitimate holder's rotated-forward token is now dead too.
    const legitimateAttempt = await rotateRefreshToken(harness.db, rotated.tokens.refreshToken, CONFIG);
    expect(legitimateAttempt.status).toBe('invalid');
  });

});

describe('revokeSession (logout)', () => {
  it('an unknown token is a harmless no-op — logout never leaks validity', async () => {
    await expect(revokeSession(harness.db, 'never-issued')).resolves.not.toThrow();
  });

  it('revokes every token in the family, not only the one presented', async () => {
    const user = await insertUser();
    const first = await createSession(harness.db, user, CONFIG);
    const rotated = await rotateRefreshToken(harness.db, first.refreshToken, CONFIG);
    if (rotated.status !== 'ok') throw new Error('unreachable');

    await revokeSession(harness.db, rotated.tokens.refreshToken);

    const rows = await harness.db
      .select()
      .from(schema.authRefreshTokens)
      .where(eq(schema.authRefreshTokens.userId, user.id));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });
});

describe('revokeAllSessionsForUser', () => {
  it('kills every family a user has, for #10s block flow', async () => {
    const user = await insertUser();
    await createSession(harness.db, user, CONFIG);
    await createSession(harness.db, user, CONFIG);

    await revokeAllSessionsForUser(harness.db, user.id);

    const rows = await harness.db
      .select()
      .from(schema.authRefreshTokens)
      .where(eq(schema.authRefreshTokens.userId, user.id));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('does not touch another user\'s sessions', async () => {
    const a = await insertUser();
    const b = await insertUser();
    const tokensB = await createSession(harness.db, b, CONFIG);

    await revokeAllSessionsForUser(harness.db, a.id);

    const outcome = await rotateRefreshToken(harness.db, tokensB.refreshToken, CONFIG);
    expect(outcome.status).toBe('ok');
  });
});

describe('login codes', () => {
  it('a fresh code resolves to the right user, once', async () => {
    const user = await insertUser();
    const code = await createLoginCode(harness.db, user.id, CONFIG);
    const resolved = await consumeLoginCode(harness.db, code);
    expect(resolved?.id).toBe(user.id);
  });

  it('cannot be spent twice', async () => {
    const user = await insertUser();
    const code = await createLoginCode(harness.db, user.id, CONFIG);
    await consumeLoginCode(harness.db, code);
    const second = await consumeLoginCode(harness.db, code);
    expect(second).toBeNull();
  });

  it('an unknown code resolves to nothing', async () => {
    expect(await consumeLoginCode(harness.db, 'never-issued')).toBeNull();
  });

  it('an expired code cannot be consumed', async () => {
    const user = await insertUser();
    const code = await createLoginCode(harness.db, user.id, { ...CONFIG, loginCodeTtlMs: -1 });
    expect(await consumeLoginCode(harness.db, code)).toBeNull();
  });
});
