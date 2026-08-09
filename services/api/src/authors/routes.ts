/** Public profiles for accounts which have published at least one layout. */
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';

export interface AuthorRoutesDeps {
  db: AnyDatabase;
}

const paramsSchema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const;

const responseSchema = {
  200: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer' },
      author: { $ref: 'PublicAuthor#' },
      publicLayoutCount: { type: 'integer' },
    },
    required: ['schemaVersion', 'author', 'publicLayoutCount'],
  },
} as const;

export function registerAuthorRoutes(app: FastifyInstance, { db }: AuthorRoutesDeps): void {
  app.get(
    '/api/v1/authors/:id',
    { schema: { params: paramsSchema, response: responseSchema } },
    async (request) => {
      const { id } = request.params as { id: string };
      const [row] = await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          globalName: schema.users.globalName,
          guildNickname: schema.users.guildNickname,
          avatarUrl: schema.users.avatarUrl,
          publicLayoutCount: sql<number>`count(${schema.layouts.id})::int`,
        })
        .from(schema.users)
        .innerJoin(
          schema.layouts,
          and(
            eq(schema.layouts.authorUserId, schema.users.id),
            eq(schema.layouts.visibility, 'public'),
          ),
        )
        .where(and(eq(schema.users.id, id), eq(schema.users.isSystem, false)))
        .groupBy(schema.users.id);

      if (!row || row.publicLayoutCount === 0) throw ApiError.notFound('No public author.');
      return {
        schemaVersion: 1,
        author: {
          id: row.id,
          username: row.username,
          displayName: row.guildNickname ?? row.globalName ?? row.username,
          avatarUrl: row.avatarUrl,
        },
        publicLayoutCount: row.publicLayoutCount,
      };
    },
  );
}
