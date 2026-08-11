/**
 * The moderation console's browse endpoint (#15). #10 built the ability to
 * act on a layout (`PATCH /api/v1/layouts/:slug` in manage.ts) but nothing
 * to find one — a moderator could only act on a slug they already knew.
 * This is that: every layout, any author, any visibility, paginated and
 * filterable the same way #6's public list is.
 */

import type { FastifyInstance } from 'fastify';

import { requireCapability } from '../auth/capability.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { RequestSchemas } from '../http.js';
import { authorsForLayouts, listLayouts, tagsForLayouts } from '../layouts/query.js';
import { toOwnerView } from '../layouts/serialize.js';

export interface ModerationRoutesDeps {
  config: ApiConfig;
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

export function registerModerationRoutes(app: FastifyInstance, { config, db }: ModerationRoutesDeps): void {
  // Types for `request.query`/`params`/`body` come from the JSON Schemas already
  // on each route below, instead of being restated as an interface and cast to.
  // `withTypeProvider` is compile-time only — it changes no runtime behaviour and
  // no schema — so the two can no longer drift apart in silence.
  const typed = app.withTypeProvider<RequestSchemas>();

  typed.get(
    '/api/v1/moderation/layouts',
    { schema: { querystring: listQuerySchema } },
    async (request) => {
      await requireCapability(db, config, request, 'moderator');
      const query = request.query;

      const { rows, total, nextCursor } = await listLayouts(db, {
        // No `?? 24` / `?? 'newest'`: the schema declares those defaults and
        // Fastify's ajv applies them, so the fallbacks were dead — which is
        // exactly what the schema-derived types now say.
        sort: query.sort,
        limit: query.limit,
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
