/**
 * Admin-only read side of the moderation audit trail. `moderation/routes.ts`
 * is how a moderator FINDS a layout to act on; this is how an admin looks
 * BACK at what already happened to one — every owner and moderator action,
 * with its reason, actor, and before/after snapshot. Same admin-only shape
 * as `users/routes.ts`'s account directory.
 */

import type { FastifyInstance } from 'fastify';

import { requireCapability } from '../auth/capability.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { RequestSchemas } from '../http.js';
import { listModerationActions } from './query.js';

export interface AuditRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

const AUDIT_ACTIONS = [
  'layout.create',
  'layout.update',
  'layout.replace',
  'layout.delete',
  'layout.hide',
  'layout.unhide',
  'layout.remove',
  'layout.restore',
  'layout.moderate_edit',
  'layout.rename_slug',
  'report.create',
  'report.resolve',
  'report.dismiss',
] as const satisfies readonly schema.ModerationAction['action'][];

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    cursor: { type: 'string' },
    slug: { type: 'string', minLength: 1 },
    q: { type: 'string', minLength: 1, maxLength: 200 },
    action: { type: 'string', enum: AUDIT_ACTIONS },
  },
} as const;

export function registerAuditRoutes(app: FastifyInstance, { config, db }: AuditRoutesDeps): void {
  // Types for `request.query`/`params`/`body` come from the JSON Schemas already
  // on each route below, instead of being restated as an interface and cast to.
  // `withTypeProvider` is compile-time only — it changes no runtime behaviour and
  // no schema — so the two can no longer drift apart in silence.
  const typed = app.withTypeProvider<RequestSchemas>();

  typed.get(
    '/api/v1/admin/moderation-actions',
    { schema: { querystring: listQuerySchema } },
    async (request) => {
      await requireCapability(db, config, request, 'admin');
      const query = request.query;

      const { rows, nextCursor } = await listModerationActions(db, {
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        filters: {
          ...(query.slug ? { slug: query.slug } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(query.action ? { action: query.action } : {}),
        },
      });

      return {
        actions: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor,
      };
    },
  );
}
