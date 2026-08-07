/**
 * The auth seam #5 left, now wired up.
 *
 * `request.user` is resolved once per request, from the `Authorization:
 * Bearer <access token>` header alone — verifying the JWT's signature and
 * expiry, with **no database hit**. That is the whole point of making access
 * tokens stateless (see tokens.ts): the cost is that a role change or a
 * block takes up to `accessTokenTtlMs` to be reflected in a token already in
 * a client's hands. That window is a deliberate, documented trade — see ADR
 * 0001, decision 10 — not an oversight. A route that needs more than id and
 * role (username, avatar, blocked status) fetches it itself, keyed by
 * `request.user.id`; `/api/v1/me` is exactly that.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

export type Role = 'user' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
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
  return { id: claims.sub, role: claims.role };
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

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

/**
 * A logged-in user with at least `role`. `admin` satisfies a `moderator`
 * check — roles are a ladder, not a set of exclusive labels.
 */
export function requireRole(request: FastifyRequest, role: Role): AuthUser {
  const user = requireAuth(request);
  if (ROLE_RANK[user.role] < ROLE_RANK[role]) {
    throw ApiError.forbidden(`This action requires the ${role} role.`);
  }
  return user;
}
