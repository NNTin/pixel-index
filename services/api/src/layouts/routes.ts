/**
 * The public layout API — the contract third parties integrate against, and
 * what our own frontend consumes too, so it never has a backend-for-frontend
 * shortcut this API itself lacks. No auth anywhere in this file: reading is
 * public, per the requirements, and every query already filters to
 * `visibility = 'public'` (query.ts) — a hidden or removed layout is 404,
 * indistinguishable from a slug that never existed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import { ApiError } from '../errors.js';
import { requestPreview } from '../renderer/client.js';
import {
  authorForLayout,
  authorsForLayouts,
  getLayoutBySlug,
  listLayouts,
  listPublicTags,
  tagsForLayouts,
  type NumericRange,
} from './query.js';
import {
  layoutDetailResponseSchema,
  listLayoutsQuerySchema,
  listLayoutsResponseSchema,
  listTagsResponseSchema,
  slugParamsSchema,
} from './schemas.js';
import { toDetail, toSummary } from './serialize.js';

export interface LayoutRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

const SCHEMA_VERSION = 1;

interface ListQuery {
  limit?: number;
  cursor?: string;
  sort?: 'newest' | 'furniture' | 'largest' | 'title';
  author?: string;
  tags?: string;
  q?: string;
  minCols?: number;
  maxCols?: number;
  minRows?: number;
  maxRows?: number;
  minFurniture?: number;
  maxFurniture?: number;
  minAreas?: number;
  maxAreas?: number;
  minPets?: number;
  maxPets?: number;
}

function range(min: number | undefined, max: number | undefined): NumericRange | undefined {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** `true` means "send 304, stop" — the caller should return immediately. */
function respondNotModifiedIfMatching(request: FastifyRequest, reply: FastifyReply, etag: string): boolean {
  reply.header('etag', etag);
  if (request.headers['if-none-match'] === etag) {
    reply.code(304).send();
    return true;
  }
  return false;
}

export function registerLayoutRoutes(app: FastifyInstance, { config, db }: LayoutRoutesDeps): void {
  app.get(
    '/api/v1/layouts',
    { schema: { querystring: listLayoutsQuerySchema, response: listLayoutsResponseSchema } },
    async (request) => {
      const query = request.query as ListQuery;
      const tags = query.tags
        ? query.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
        : undefined;

      const { rows, total, nextCursor } = await listLayouts(db, {
        sort: query.sort ?? 'newest',
        limit: query.limit ?? 24,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        filters: {
          ...(query.author ? { author: query.author } : {}),
          ...(tags && tags.length > 0 ? { tags } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(range(query.minCols, query.maxCols) ? { cols: range(query.minCols, query.maxCols) } : {}),
          ...(range(query.minRows, query.maxRows) ? { rows: range(query.minRows, query.maxRows) } : {}),
          ...(range(query.minFurniture, query.maxFurniture)
            ? { furniture: range(query.minFurniture, query.maxFurniture) }
            : {}),
          ...(range(query.minAreas, query.maxAreas)
            ? { areas: range(query.minAreas, query.maxAreas) }
            : {}),
          ...(range(query.minPets, query.maxPets) ? { pets: range(query.minPets, query.maxPets) } : {}),
        },
      });

      const [authors, tagsByLayout] = await Promise.all([
        authorsForLayouts(db, rows.map((row) => row.authorUserId)),
        tagsForLayouts(db, rows.map((row) => row.id)),
      ]);

      return {
        schemaVersion: SCHEMA_VERSION,
        total,
        layouts: rows.map((row) =>
          toSummary(row, authors.get(row.authorUserId) ?? null, tagsByLayout.get(row.id) ?? []),
        ),
        nextCursor,
      };
    },
  );

  app.get('/api/v1/tags', { schema: { response: listTagsResponseSchema } }, async () => {
    const tags = await listPublicTags(db);
    return { schemaVersion: SCHEMA_VERSION, tags };
  });

  app.get(
    '/api/v1/layouts/:slug',
    { schema: { params: slugParamsSchema, response: layoutDetailResponseSchema } },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const layout = await getLayoutBySlug(db, slug);
      if (!layout) throw ApiError.notFound(`No public layout "${slug}".`);

      // Slug-addressed, and a layout's content can change under it (#9), so
      // this is short-lived + revalidated, not "immutable" — unlike the
      // renderer's own content-addressed cache.
      reply.header('cache-control', 'public, max-age=60, must-revalidate');
      if (respondNotModifiedIfMatching(request, reply, `"${layout.sha256}"`)) return;

      const [author, tags] = await Promise.all([
        authorForLayout(db, layout.authorUserId),
        tagsForLayouts(db, [layout.id]).then((map) => map.get(layout.id) ?? []),
      ]);
      return toDetail(layout, author, tags);
    },
  );

  app.get(
    '/api/v1/layouts/:slug/download',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const layout = await getLayoutBySlug(db, slug);
      if (!layout) throw ApiError.notFound(`No public layout "${slug}".`);

      reply.header('cache-control', 'public, max-age=60, must-revalidate');
      if (respondNotModifiedIfMatching(request, reply, `"${layout.sha256}"`)) return;

      // The exact bytes as uploaded, verbatim — see schema.ts on why this is
      // `raw` and not a re-stringified `layout`.
      return reply
        .header('content-type', 'application/json')
        .header('content-disposition', `attachment; filename="${slug}.json"`)
        .send(layout.raw);
    },
  );

  async function servePreview(
    request: FastifyRequest,
    reply: FastifyReply,
    slug: string,
    scale: 1 | 0.25,
  ) {
    const layout = await getLayoutBySlug(db, slug);
    if (!layout) throw ApiError.notFound(`No public layout "${slug}".`);

    const outcome = await requestPreview(config.rendererUrl, layout.layout, scale);
    if (!outcome.ok) {
      request.log.warn({ err: outcome.error, slug }, 'preview render failed');
      if (outcome.error.kind === 'invalid_layout') {
        // A stored layout failing validation means it was written badly, not
        // that the client asked for something wrong — that is our bug.
        throw new ApiError(500, 'internal_error', 'This layout could not be rendered.');
      }
      throw new ApiError(502, 'renderer_unavailable', outcome.error.message);
    }

    // Slug-addressed like the routes above, so the same short-lived,
    // revalidated policy applies — never the renderer's own "immutable",
    // which is only true for its content-addressed cache key, not for this URL.
    reply.header('cache-control', 'public, max-age=60, must-revalidate');
    const etag = outcome.result.etag ?? `"${layout.sha256}-${scale}"`;
    if (respondNotModifiedIfMatching(request, reply, etag)) return;

    return reply.header('content-type', outcome.result.contentType).send(outcome.result.body);
  }

  app.get('/api/v1/layouts/:slug/preview.png', { schema: { params: slugParamsSchema } }, (request, reply) => {
    const { slug } = request.params as { slug: string };
    return servePreview(request, reply, slug, 1);
  });

  app.get(
    '/api/v1/layouts/:slug/thumbnail.png',
    { schema: { params: slugParamsSchema } },
    (request, reply) => {
      const { slug } = request.params as { slug: string };
      // 0.25, not 0.5: measured across every seed layout, a 0.5-scale PNG is
      // LARGER than the full image every time (halving pixel art destroys the
      // runs its filters exploit) — see services/renderer/README.md. 0.25 is
      // the only scale that actually saves bytes.
      return servePreview(request, reply, slug, 0.25);
    },
  );
}
