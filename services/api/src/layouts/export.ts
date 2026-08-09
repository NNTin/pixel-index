/**
 * `GET /api/v1/export/layouts.ndjson` — the whole public index, one layout
 * per line.
 *
 * Why this exists rather than "just page through /api/v1/layouts": #26's
 * vendor-update gate has to fetch *every* layout and render it against a
 * candidate Pixel Agents pin. Doing that over the paginated routes is one
 * request per layout, which is both slow and — at anything past a few hundred
 * layouts — throttled by the general rate-limit bucket. This is the same data
 * in one streamed request.
 *
 * Deliberately **public and unauthenticated**. Every byte here is already
 * public via `/api/v1/layouts/:slug/download`; putting a credential in front
 * of the convenient form while the inconvenient form stays open would buy
 * nothing and cost a secret to provision, rotate and leak. What actually
 * protects the host is on this route instead: its own stricter rate-limit
 * bucket, an ETag so a repeat caller costs one query rather than a full scan,
 * and constant-memory streaming so index size can never translate into server
 * memory.
 *
 * ## `layout`, not `raw`
 *
 * `/download` serves the exact stored bytes because a third party dedupes on
 * their sha256. This serves the *parsed* layout, because embedding a JSON
 * document as a JSON string inside a JSON line doubles the payload and forces
 * every consumer to parse twice. `sha256` is still reported — it identifies
 * the layout and matches what the list routes report — but it is the hash of
 * the original upload, not of the bytes on this line. Anyone needing
 * byte-exactness wants `/download`.
 *
 * This is also the form the renderer actually consumes: `routes.ts`'s preview
 * path hands `layout.layout` to the renderer, and the renderer keys its cache
 * on `JSON.stringify(layout)`. A gate rendering from this endpoint is therefore
 * rendering exactly what production renders, not a near-miss.
 */

import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import { PUBLIC_REVALIDATED, respondNotModifiedIfMatching } from './caching.js';
import { publicLayoutsFingerprint, streamPublicLayouts } from './query.js';

export interface ExportRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

/** How many rows one keyset page pulls. Big enough to amortise, small enough to stay bounded. */
const BATCH_SIZE = 200;

export function registerExportRoutes(app: FastifyInstance, { config, db }: ExportRoutesDeps): void {
  app.get(
    '/api/v1/export/layouts.ndjson',
    {
      // No `response` schema on purpose. Declaring one makes Fastify install a
      // JSON serializer over the payload, which is exactly wrong for a stream
      // of newline-delimited documents — the same reason `/download` (routes.ts)
      // declares none either. @fastify/swagger still lists the route.
      schema: {
        summary: 'Every public layout, newline-delimited.',
        description:
          'One JSON object per line: { slug, sha256, layoutRevision, pixelAgentsVersion, layout }. ' +
          'Streamed, so the response is not a JSON array and must be parsed line by line. ' +
          '`x-total-count` reports how many lines to expect — compare it against the number ' +
          'received to detect a stream truncated by a mid-response failure, which cannot be ' +
          'signalled with a status code once the 200 has been sent. ' +
          '`sha256` is the hash of the layout as originally uploaded (see /download), not of ' +
          'the bytes on this line.',
        tags: ['layouts'],
      },
      config: {
        rateLimit: {
          max: config.exportRateLimit.max,
          timeWindow: config.exportRateLimit.windowMs,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { count, digest } = await publicLayoutsFingerprint(db);

      // The same short-lived, revalidated policy as every other public read
      // path (caching.ts) — the content behind this URL changes whenever
      // anyone submits.
      reply.header('cache-control', PUBLIC_REVALIDATED);
      if (respondNotModifiedIfMatching(request, reply, `"${digest}"`)) return;

      reply.header('content-type', 'application/x-ndjson; charset=utf-8');
      reply.header('x-total-count', String(count));

      async function* lines(): AsyncGenerator<string> {
        for await (const row of streamPublicLayouts(db, BATCH_SIZE)) {
          yield `${JSON.stringify(row)}\n`;
        }
      }

      // Readable.from over the generator, rather than writing to reply.raw:
      // Fastify then owns backpressure and teardown, and a client that hangs
      // up mid-download stops the database scan instead of draining it into a
      // socket nobody is reading.
      return reply.send(Readable.from(lines(), { objectMode: false }));
    },
  );
}
