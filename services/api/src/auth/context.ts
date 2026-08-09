/**
 * The auth seam #5 left, now wired up.
 *
 * `request.user` is resolved once per request from a signed access token.
 * Tokens identify an internal user only; Discord capability is deliberately
 * absent and is resolved through capability.ts so a stale JWT can never keep
 * moderator/admin authority after Discord removes it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

export type Role = 'user' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the hook below. `null` for an anonymous request. */
    user: AuthUser | null;
  }
}

const BEARER_PREFIX = 'Bearer ';

async function resolveUser(
  request: FastifyRequest,
  sessionSecret: string,
): Promise<AuthUser | null> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token === '') return null;

  const claims = await verifyAccessToken(token, sessionSecret);
  if (!claims) return null;
  return { id: claims.sub };
}

export function registerAuthContext(app: FastifyInstance, sessionSecret: string): void {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    request.user = await resolveUser(request, sessionSecret);
  });
}

/** Any logged-in user. Throws a 401 in the shared envelope otherwise. */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.user) throw ApiError.unauthorized();
  return request.user;
}
