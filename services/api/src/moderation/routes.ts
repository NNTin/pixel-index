/**
 * The moderation console's browse endpoint (#15). #10 built the ability to
 * act on a layout (`PATCH /api/v1/layouts/:slug` in manage.ts) but nothing
 * to find one — a moderator could only act on a slug they already knew.
 * This is that: every layout, any author, any visibility, paginated and
 * filterable the same way #6's public list is.
 */

import type { FastifyInstance } from 'fastify';

import { requireFreshRole } from '../auth/freshRole.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { authorsForLayouts, listLayouts, tagsForLayouts } from '../layouts/query.js';
import { toOwnerView } from '../layouts/serialize.js';

export interface ModerationRoutesDeps {
  db: AnyDatabase;
}

const MODERATION_VISIBILITIES = ['public', 'hidden', 'removed', 'deleted'] as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
    cursor: { type: 'string' },
    sort: { type: 'string', enum: ['newest', 'furniture', 'largest', 'title'], default: 'newest' },
    visibility: { type: 'string', enum: MODERATION_VISIBILITIES },
    author: { type: 'string', format: 'uuid' },
    q: { type: 'string', maxLength: 200 },
  },
} as const;

interface ListQuery {
  limit?: number;
  cursor?: string;
  sort?: 'newest' | 'furniture' | 'largest' | 'title';
  visibility?: (typeof MODERATION_VISIBILITIES)[number];
  author?: string;
  q?: string;
}

export function registerModerationRoutes(app: FastifyInstance, { db }: ModerationRoutesDeps): void {
  app.get(
    '/api/v1/moderation/layouts',
    { schema: { querystring: listQuerySchema } },
    async (request) => {
      await requireFreshRole(db, request, 'moderator');
      const query = request.query as ListQuery;

      const { rows, total, nextCursor } = await listLayouts(db, {
        sort: query.sort ?? 'newest',
        limit: query.limit ?? 24,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        filters: {
          ...(query.visibility ? { visibility: query.visibility } : {}),
          ...(query.author ? { author: query.author } : {}),
          ...(query.q ? { q: query.q } : {}),
        },
        scope: { type: 'moderator' },
      });

      const [authors, tagsByLayout] = await Promise.all([
        authorsForLayouts(db, rows.map((row: schema.Layout) => row.authorUserId)),
        tagsForLayouts(db, rows.map((row: schema.Layout) => row.id)),
      ]);

      return {
        schemaVersion: 1,
        total,
        layouts: rows.map((row: schema.Layout) =>
          toOwnerView(row, authors.get(row.authorUserId) ?? null, tagsByLayout.get(row.id) ?? []),
        ),
        nextCursor,
      };
    },
  );
}
