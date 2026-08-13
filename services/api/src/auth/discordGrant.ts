/** Encrypted persistence and refresh of user-scoped Discord OAuth grants. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import {
  DiscordApiError,
  type DiscordTokenResponse,
  refreshDiscordToken,
} from './discord.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const REFRESH_SAFETY_MS = 30_000;

function keyBytes(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Discord OAuth encryption key is not 32 bytes.');
  return key;
}

export function encryptDiscordToken(value: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptDiscordToken(value: string, base64Key: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.');
  if (version !== VERSION || !encodedIv || !encodedTag || encodedCiphertext === undefined) {
    throw new Error('Unsupported Discord OAuth ciphertext.');
  }
  const decipher = createDecipheriv(ALGORITHM, keyBytes(base64Key), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function saveDiscordGrant(
  db: AnyDatabase,
  userId: string,
  token: DiscordTokenResponse,
  encryptionKey: string,
  now = new Date(),
): Promise<void> {
  const values: schema.NewDiscordOauthGrant = {
    userId,
    encryptedAccessToken: encryptDiscordToken(token.access_token, encryptionKey),
    encryptedRefreshToken: encryptDiscordToken(token.refresh_token, encryptionKey),
    accessTokenExpiresAt: new Date(now.getTime() + token.expires_in * 1000),
    scopes: token.scope,
    updatedAt: now,
  };
  await db
    .insert(schema.discordOauthGrants)
    .values(values)
    .onConflictDoUpdate({
      target: schema.discordOauthGrants.userId,
      set: {
        encryptedAccessToken: values.encryptedAccessToken,
        encryptedRefreshToken: values.encryptedRefreshToken,
        accessTokenExpiresAt: values.accessTokenExpiresAt,
        scopes: values.scopes,
        updatedAt: now,
      },
    });
}

export type DiscordAccessTokenOutcome =
  | { status: 'ok'; accessToken: string }
  | { status: 'reauthorization_required' };

export async function discardDiscordGrant(db: AnyDatabase, userId: string): Promise<void> {
  await db.delete(schema.discordOauthGrants).where(eq(schema.discordOauthGrants.userId, userId));
}

/**
 * Refreshes inside a transaction while holding the grant row. That prevents
 * two API requests (including requests handled by different replicas) from
 * spending the same rotating Discord refresh token concurrently.
 */
export async function usableDiscordAccessToken(
  db: AnyDatabase,
  userId: string,
  config: Pick<ApiConfig, 'discordClientId' | 'discordClientSecret'>,
  encryptionKey: string,
  options: { forceRefresh?: boolean; now?: Date } = {},
): Promise<DiscordAccessTokenOutcome> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx: AnyDatabase) => {
    const [grant] = await tx
      .select()
      .from(schema.discordOauthGrants)
      .where(eq(schema.discordOauthGrants.userId, userId))
      .for('update');
    if (!grant) return { status: 'reauthorization_required' };

    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = decryptDiscordToken(grant.encryptedAccessToken, encryptionKey);
      refreshToken = decryptDiscordToken(grant.encryptedRefreshToken, encryptionKey);
    } catch {
      await tx.delete(schema.discordOauthGrants).where(eq(schema.discordOauthGrants.userId, userId));
      return { status: 'reauthorization_required' };
    }

    if (!options.forceRefresh && grant.accessTokenExpiresAt.getTime() > now.getTime() + REFRESH_SAFETY_MS) {
      return { status: 'ok', accessToken };
    }

    let refreshed: DiscordTokenResponse;
    try {
      refreshed = await refreshDiscordToken(
        { clientId: config.discordClientId, clientSecret: config.discordClientSecret },
        refreshToken,
      );
    } catch (error) {
      if (error instanceof DiscordApiError && (error.status === 400 || error.status === 401)) {
        await tx.delete(schema.discordOauthGrants).where(eq(schema.discordOauthGrants.userId, userId));
        return { status: 'reauthorization_required' };
      }
      throw error;
    }

    const refreshedAt = options.now ?? new Date();
    await tx
      .update(schema.discordOauthGrants)
      .set({
        encryptedAccessToken: encryptDiscordToken(refreshed.access_token, encryptionKey),
        encryptedRefreshToken: encryptDiscordToken(refreshed.refresh_token, encryptionKey),
        accessTokenExpiresAt: new Date(refreshedAt.getTime() + refreshed.expires_in * 1000),
        scopes: refreshed.scope,
        updatedAt: refreshedAt,
      })
      .where(eq(schema.discordOauthGrants.userId, userId));
    return { status: 'ok', accessToken: refreshed.access_token };
  });
}
