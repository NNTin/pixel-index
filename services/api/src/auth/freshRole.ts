/**
 * A fresh actor row, not the access token's `{id, role}` claim. Role
 * changes, blocking, and now the moderation console's browse endpoint (#15)
 * are exactly the "path that matters most" ADR 0001's stateless-access-token
 * trade-off names: a moderator demoted a minute ago should not get up to
 * `ACCESS_TOKEN_TTL_MS` more minutes of using these routes on the strength
 * of their old token. This also doubles as where an actor's username comes
 * from for `actorLabel` in the audit log.
 */
import { hasAtLeastRole, requireAuth, type Role } from './context.js';
import { getUserById } from './users.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';

export async function requireFreshRole(
  db: AnyDatabase,
  request: Parameters<typeof requireAuth>[0],
  role: Role,
): Promise<schema.User> {
  const auth = requireAuth(request);
  const actor = await getUserById(db, auth.id);
  if (!actor) throw ApiError.unauthorized();
  if (!hasAtLeastRole(actor.role, role)) {
    throw ApiError.forbidden(`This action requires the ${role} role.`);
  }
  return actor;
}
