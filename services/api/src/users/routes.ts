/**
 * Admin/moderator actions on an account: role changes (#10, admin-only) and
 * blocking (#10, moderator+). Not "user management" broadly — there is no
 * `PATCH /users/:id` for arbitrary fields, deliberately: role and block are
 * two specific, narrow, heavily-audited powers, not a general edit surface.
 */

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { hasAtLeastRole, requireAuth, type Role } from '../auth/context.js';
import { revokeAllSessionsForUser } from '../auth/sessions.js';
import { getUserById } from '../auth/users.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import { hideAllPublicLayoutsForUser } from '../layouts/query.js';
import { recordModerationAction } from '../moderation/audit.js';

/**
 * A fresh actor row, not the access token's `{id, role}` claim. Role changes
 * and blocking are exactly the "path that matters most" ADR 0001's
 * stateless-access-token trade-off names: a moderator demoted a minute ago
 * should not get up to `ACCESS_TOKEN_TTL_MS` more minutes of using this
 * route on the strength of their old token. This also doubles as where the
 * actor's username comes from for `actorLabel` in the audit log.
 */
async function requireFreshRole(
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

export interface UserAdminRoutesDeps {
  db: AnyDatabase;
}

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

interface PublicUserView {
  id: string;
  username: string;
  role: Role;
  blocked: boolean;
  blockedReason: string | null;
}

function toPublicUserView(user: schema.User): PublicUserView {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    blocked: user.blockedAt !== null,
    blockedReason: user.blockedReason,
  };
}

async function loadTarget(db: AnyDatabase, id: string): Promise<schema.User> {
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!target) throw ApiError.notFound('No such user.');
  if (target.isSystem) {
    throw ApiError.badRequest('The system user (#3, owns seed layouts) cannot be modified.');
  }
  return target;
}

const roleParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const;

const roleBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { role: { type: 'string', enum: ['user', 'moderator', 'admin'] } },
  required: ['role'],
} as const;

const blockBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    blocked: { type: 'boolean' },
    reason: { type: 'string', minLength: 1, maxLength: 300 },
  },
  required: ['blocked'],
} as const;

export function registerUserAdminRoutes(app: FastifyInstance, { db }: UserAdminRoutesDeps): void {
  app.patch(
    '/api/v1/users/:id/role',
    { schema: { params: roleParamsSchema, body: roleBodySchema } },
    async (request, reply) => {
      // Role escalation is admin-only, and itself audited (#10's own
      // acceptance criterion) — a moderator granting more power, even to
      // someone else, is exactly the privilege escalation this guards.
      const actor = await requireFreshRole(db, request, 'admin');
      const { id } = request.params as { id: string };
      const { role: newRole } = request.body as { role: Role };

      if (id === actor.id) throw ApiError.forbidden('Cannot change your own role.');
      const target = await loadTarget(db, id);

      if (target.role === newRole) return reply.send(toPublicUserView(target));

      const action = ROLE_RANK[newRole] > ROLE_RANK[target.role] ? 'user.role_grant' : 'user.role_revoke';
      const updated = await db.transaction(async (tx: AnyDatabase) => {
        const [row] = await tx
          .update(schema.users)
          .set({ role: newRole })
          .where(eq(schema.users.id, id))
          .returning();
        await recordModerationAction(tx, {
          actorUserId: actor.id,
          actorLabel: actor.username,
          action,
          targetType: 'user',
          targetId: id,
          before: { role: target.role },
          after: { role: newRole },
        });
        return row!;
      });

      return reply.send(toPublicUserView(updated));
    },
  );

  app.patch(
    '/api/v1/users/:id/block',
    { schema: { params: roleParamsSchema, body: blockBodySchema } },
    async (request, reply) => {
      const actor = await requireFreshRole(db, request, 'moderator');
      const { id } = request.params as { id: string };
      const { blocked, reason } = request.body as { blocked: boolean; reason?: string };

      if (id === actor.id) throw ApiError.forbidden('Cannot block your own account.');
      const target = await loadTarget(db, id);

      // A moderator can block a regular user; blocking a moderator or an
      // admin — de-privileging a privileged account — is admin-only, the
      // same boundary role changes already draw.
      if (target.role !== 'user' && !hasAtLeastRole(actor.role, 'admin')) {
        throw ApiError.forbidden('Only an admin can block a moderator or admin account.');
      }

      if (blocked && !reason) {
        throw ApiError.badRequest('A reason is required to block an account.');
      }

      const updated = await db.transaction(async (tx: AnyDatabase) => {
        const [row] = await tx
          .update(schema.users)
          .set({
            blockedAt: blocked ? new Date() : null,
            blockedReason: blocked ? (reason ?? null) : null,
          })
          .where(eq(schema.users.id, id))
          .returning();

        await recordModerationAction(tx, {
          actorUserId: actor.id,
          actorLabel: actor.username,
          action: blocked ? 'user.block' : 'user.unblock',
          targetType: 'user',
          targetId: id,
          reason: blocked ? (reason ?? null) : null,
          before: { blocked: target.blockedAt !== null },
          after: { blocked },
        });

        // Blocking hides existing content in the same action, not just
        // future submissions (#8 already refuses those via blockedAt) —
        // one audit entry per affected layout, alongside the user.block
        // entry above, so the history says exactly what was hidden and why.
        // Unblocking does NOT auto-restore them: an account back in good
        // standing does not retroactively validate everything it published.
        if (blocked) {
          const hidden = await hideAllPublicLayoutsForUser(tx, id, reason!, actor.id);
          for (const layout of hidden) {
            await recordModerationAction(tx, {
              actorUserId: actor.id,
              actorLabel: actor.username,
              action: 'layout.hide',
              targetType: 'layout',
              targetId: layout.id,
              reason,
              before: { visibility: 'public' },
              after: { visibility: 'hidden' },
            });
          }
        }

        return row!;
      });

      if (blocked) await revokeAllSessionsForUser(db, id);

      return reply.send(toPublicUserView(updated));
    },
  );
}
