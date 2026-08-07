/**
 * The auth seam #7 wires into.
 *
 * #5 is explicitly not responsible for authentication — see ADR 0001,
 * decision 7, on why the cross-origin session mechanism is its own design
 * problem. What #5 owes every later issue is a stable place to hang it: a
 * typed `request.user`, resolved once per request by a single hook, so #7
 * replaces one function body instead of threading a new decorator through
 * every route file that needs to know who is asking.
 *
 * Every route already runs under this hook. #7 only edits `resolveUser`.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';

export type Role = 'user' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
  discordId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the hook below. `null` for an anonymous request. */
    user: AuthUser | null;
  }
}

/**
 * #7 replaces this with real session/bearer-token resolution. Every route
 * already runs after it, so nothing downstream changes shape when it does —
 * `request.user` just starts sometimes being non-null.
 */
async function resolveUser(_request: FastifyRequest): Promise<AuthUser | null> {
  return null;
}

export function registerAuthContext(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    request.user = await resolveUser(request);
  });
}

/**
 * Route-level guard for #7 to use once it can populate `request.user`.
 * Registered now so the seam includes "how a route requires login", not only
 * "where the user lives" — #7 wires the resolver above; #9/#10 then reach for
 * this rather than each writing their own `if (!request.user)` check.
 */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.user) throw ApiError.unauthorized();
  return request.user;
}
