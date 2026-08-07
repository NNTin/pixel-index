/**
 * The two halves of the bearer-token session (ADR 0001, decision 10).
 *
 * **Access tokens** are stateless: a short-lived, HS256-signed JWT containing
 * `sub` (user id) and `role`, verified with no database hit. That is what
 * makes them cheap enough to send on every request. The cost is staleness —
 * a role change or a block takes up to `accessTokenTtlMs` to take effect for
 * a token already issued. That window is the deliberate trade for not
 * hitting Postgres on every authenticated request; keep the TTL short enough
 * that the trade stays worth it.
 *
 * **Refresh tokens** are the opposite: opaque random bytes, looked up in
 * `auth_refresh_tokens` by their hash on every use, so revocation (logout,
 * reuse detection) is immediate. Only the hash is ever persisted.
 */

import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { Role } from './context.js';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlMs: number,
): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ttlMs) / 1000))
    .sign(secretKey(secret));
}

/** Returns `null` on any failure — expired, malformed, wrong signature. Never throws. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    if (!isRole(payload.role)) return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

function isRole(value: string): value is Role {
  return value === 'user' || value === 'moderator' || value === 'admin';
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** A random opaque token, and the hash of it that actually gets stored. */
export interface OpaqueToken {
  /** Given to the client. Never stored. */
  value: string;
  /** sha256 hex. What actually lives in the database. */
  hash: string;
}

export function generateOpaqueToken(bytes = 32): OpaqueToken {
  const value = randomBytes(bytes).toString('base64url');
  return { value, hash: hashToken(value) };
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
