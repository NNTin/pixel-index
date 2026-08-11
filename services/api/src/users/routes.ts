/** Read-only Admin directory of accounts which have interacted with Pixel Index. */
import { and, asc, eq, gt, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { requireCapability } from '../auth/capability.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { RequestSchemas } from '../http.js';

/** One row of `GET /api/v1/admin/users`. Deliberately no discordId or roleIds. */
export interface AdminUserView {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  capability: string;
  capabilityCheckedAt: string | null;
  layoutCount: number;
}

/** `GET /api/v1/admin/users` */
export interface ListAdminUsersBody {
  users: AdminUserView[];
  nextCursor: string | null;
}

export interface UserAdminRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    cursor: { type: 'string', format: 'uuid' },
    q: { type: 'string', minLength: 1, maxLength: 100 },
    capability: { type: 'string', enum: ['user', 'moderator', 'admin'] },
  },
} as const;

export function registerUserAdminRoutes(
  app: FastifyInstance,
  { config, db }: UserAdminRoutesDeps,
): void {
  // Types for `request.query`/`params`/`body` come from the JSON Schemas already
  // on each route below, instead of being restated as an interface and cast to.
  // `withTypeProvider` is compile-time only — it changes no runtime behaviour and
  // no schema — so the two can no longer drift apart in silence.
  const typed = app.withTypeProvider<RequestSchemas>();

  typed.get(
    '/api/v1/admin/users',
    { schema: { querystring: listQuerySchema } },
    async (request): Promise<ListAdminUsersBody> => {
      await requireCapability(db, config, request, 'admin');
      const query = request.query;
      // Defaulted by the schema, applied by ajv — see layouts/routes.ts.
      const limit = query.limit;
      const conditions = [eq(schema.users.isSystem, false)];
      if (query.cursor) conditions.push(gt(schema.users.id, query.cursor));
      if (query.q) conditions.push(ilike(schema.users.username, `%${query.q}%`));
      if (query.capability) conditions.push(eq(schema.users.role, query.capability));

      const page = await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          globalName: schema.users.globalName,
          guildNickname: schema.users.guildNickname,
          avatarUrl: schema.users.avatarUrl,
          capability: schema.users.role,
          capabilityCheckedAt: schema.users.discordMembershipCheckedAt,
          layoutCount: sql<number>`count(${schema.layouts.id})::int`,
        })
        .from(schema.users)
        .leftJoin(schema.layouts, eq(schema.layouts.authorUserId, schema.users.id))
        .where(and(...conditions))
        .groupBy(schema.users.id)
        .orderBy(asc(schema.users.id))
        .limit(limit + 1);

      const hasMore = page.length > limit;
      const users = hasMore ? page.slice(0, limit) : page;
      const lastUser = users.at(-1);
      return {
        users: users.map(({ globalName, guildNickname, capabilityCheckedAt, ...user }) => ({
          ...user,
          displayName: guildNickname ?? globalName ?? user.username,
          capabilityCheckedAt: capabilityCheckedAt?.toISOString() ?? null,
        })),
        nextCursor: hasMore && lastUser ? lastUser.id : null,
      };
    },
  );
}
