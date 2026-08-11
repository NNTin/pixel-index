/**
 * Issuing, rotating and revoking the bearer-token session.
 *
 * See tokens.ts for what an access vs. refresh token actually is. This file
 * is the part that talks to Postgres: minting a token pair on login, rotating
 * a refresh token on `/auth/refresh` (with reuse detection), and revoking a
 * family on logout.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import { one } from '../db/rows.js';
import * as schema from '../db/schema.js';
import { generateOpaqueToken, hashToken, signAccessToken } from './tokens.js';

export interface SessionConfig {
  sessionSecret: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  loginCodeTtlMs: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInMs: number;
}

/** A brand new login: a fresh token family. */
export async function createSession(
  db: AnyDatabase,
  user: Pick<schema.User, 'id'>,
  config: SessionConfig,
): Promise<TokenPair> {
  const familyId = randomUUID();
  const { tokens } = await issueTokenPair(db, user, familyId, config);
  return tokens;
}

/**
 * Returns the stored row's id alongside the pair.
 *
 * `rotateRefreshToken` needs it to link a spent token to its successor, and
 * used to recover it by hashing the token it had just been handed and selecting
 * the row back out — a second round trip, and an assertion, for a value the
 * insert already knew.
 */
async function issueTokenPair(
  db: AnyDatabase,
  user: { id: string },
  familyId: string,
  config: SessionConfig,
): Promise<{ tokens: TokenPair; refreshTokenId: string }> {
  const refresh = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlMs);

  const stored = one(
    await db
      .insert(schema.authRefreshTokens)
      .values({
        userId: user.id,
        tokenHash: refresh.hash,
        familyId,
        expiresAt,
      })
      .returning({ id: schema.authRefreshTokens.id }),
  );

  const accessToken = await signAccessToken(
    { sub: user.id },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );

  return {
    tokens: { accessToken, refreshToken: refresh.value, expiresInMs: config.accessTokenTtlMs },
    refreshTokenId: stored.id,
  };
}

export type RefreshOutcome =
  | { status: 'ok'; tokens: TokenPair }
  | { status: 'invalid' }
  | { status: 'reused' }

/**
 * Spend a refresh token for a new pair.
 *
 * A token that was already rotated once (`rotatedToId` set) being presented
 * again means it was copied — by an attacker, or by a client retrying a
 * request it thought failed. Either way neither copy can be trusted, so the
 * whole family is revoked rather than just this row.
 */
export async function rotateRefreshToken(
  db: AnyDatabase,
  rawToken: string,
  config: SessionConfig,
): Promise<RefreshOutcome> {
  const hash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(schema.authRefreshTokens)
    .where(eq(schema.authRefreshTokens.tokenHash, hash));

  // Two statements, not `row?.revokedAt !== null || …`: that reads the same but
  // does not narrow `row`, so `row.expiresAt` here and `row.rotatedToId` below
  // would both become "possibly undefined" under noUncheckedIndexedAccess.
  if (!row) return { status: 'invalid' };
  if (row.revokedAt !== null || row.expiresAt.getTime() < Date.now()) {
    return { status: 'invalid' };
  }
  if (row.rotatedToId !== null) {
    await revokeFamily(db, row.familyId);
    return { status: 'reused' };
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  if (!user) return { status: 'invalid' };

  const { tokens, refreshTokenId } = await issueTokenPair(db, user, row.familyId, config);
  // Link the spent token to its successor.
  await db
    .update(schema.authRefreshTokens)
    .set({ rotatedToId: refreshTokenId })
    .where(eq(schema.authRefreshTokens.id, row.id));

  return { status: 'ok', tokens };
}

/** Logout: revoke the whole family the presented token belongs to. */
export async function revokeSession(db: AnyDatabase, rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  const [row] = await db
    .select({ familyId: schema.authRefreshTokens.familyId })
    .from(schema.authRefreshTokens)
    .where(eq(schema.authRefreshTokens.tokenHash, hash));
  if (row) await revokeFamily(db, row.familyId);
}

async function revokeFamily(db: AnyDatabase, familyId: string): Promise<void> {
  await db
    .update(schema.authRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.authRefreshTokens.familyId, familyId), isNull(schema.authRefreshTokens.revokedAt)),
    );
}

/**
 * Every session belonging to a user, everywhere. #10's "block a user" reaches
 * for this so a block takes effect immediately rather than waiting for every
 * refresh token to individually expire.
 */
export async function revokeAllSessionsForUser(db: AnyDatabase, userId: string): Promise<void> {
  await db
    .update(schema.authRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.authRefreshTokens.userId, userId), isNull(schema.authRefreshTokens.revokedAt)),
    );
}

/** The one-time code handed to the SPA at the end of /callback. */
export async function createLoginCode(
  db: AnyDatabase,
  userId: string,
  config: SessionConfig,
): Promise<string> {
  const code = generateOpaqueToken(24);
  await db.insert(schema.authLoginCodes).values({
    userId,
    codeHash: code.hash,
    expiresAt: new Date(Date.now() + config.loginCodeTtlMs),
  });
  return code.value;
}

/**
 * Atomically claim a login code: `WHERE consumedAt IS NULL AND expiresAt >
 * now()` makes both a concurrent double-spend and a replay of an expired
 * code impossible without an explicit transaction — a second or late attempt
 * simply matches zero rows and never mutates the (already-unusable) row.
 */
export async function consumeLoginCode(db: AnyDatabase, rawCode: string): Promise<schema.User | null> {
  const hash = hashToken(rawCode);
  const [claimed] = await db
    .update(schema.authLoginCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(schema.authLoginCodes.codeHash, hash),
        isNull(schema.authLoginCodes.consumedAt),
        gt(schema.authLoginCodes.expiresAt, new Date()),
      ),
    )
    .returning();

  if (!claimed) return null;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, claimed.userId));
  return user ?? null;
}
