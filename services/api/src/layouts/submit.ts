/**
 * POST /api/v1/layouts — the whole point of v2. Publishing used to mean a
 * pull request; after this it means logging in with Discord and pasting a
 * `layout.json`.
 *
 * Curation is post-moderation (ADR 0001, decision 6): a valid submission is
 * publicly listed immediately, with no approval queue. That makes this one
 * endpoint the only thing standing between a stranger and the front page, so
 * almost everything here is about refusing bad input cheaply, in order,
 * before anything expensive (validation, a database write, a render) runs:
 * auth -> blocked check -> size -> JSON.parse -> layout-core validation ->
 * dedupe -> daily cap -> insert.
 */

import { layoutStats, sha256, type Layout } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/context.js';
import { getUserById } from '../auth/users.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import { requestPreview } from '../renderer/client.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import { isUniqueViolation, parseAndValidateTags } from './metadata.js';
import { recordModerationAction } from '../moderation/audit.js';
import { attachTags, countUserSubmissionsSince, findLayoutBySha256 } from './query.js';
import { toDetail } from './serialize.js';
import { generateUniqueSlug } from './slug.js';
import type { UpstreamValidator } from './upstreamValidator.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const submitQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: 'string', maxLength: 300 },
    tags: {
      type: 'string',
      description: 'Comma-separated kebab-case tags, up to 8 — e.g. "cosy,small".',
    },
  },
  required: ['title'],
} as const;

interface SubmitQuery {
  title: string;
  description?: string;
  tags?: string;
}

export interface SubmitRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
  /** Built once in server.ts and shared with `manage.ts`'s `PUT .../layout`. */
  upstream: UpstreamValidator | null;
}

export function registerSubmitRoutes(app: FastifyInstance, { config, db, upstream }: SubmitRoutesDeps): void {
  app.register(async (instance) => {
    // Scoped to this plugin only — every other application/json route (list,
    // detail, auth) keeps Fastify's normal parsed-object behaviour. Overriding
    // it globally would break all of them.
    //
    // The layout is accepted as the raw request body, not as a field nested in
    // a JSON envelope, specifically so it can be stored byte-for-byte (#6, #8).
    // Postgres's jsonb (and, just as much, a nested-then-re-stringified JS
    // object) does not preserve whitespace or number formatting — parsing this
    // request as one JSON document and pulling `body.layout` back out would
    // silently reintroduce the exact bytes problem #6's `layouts.raw` exists
    // to solve. Metadata therefore travels as query parameters instead.
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    instance.post(
      '/api/v1/layouts',
      { ...writeRateLimitConfig(config), schema: { querystring: submitQuerySchema } },
      async (request, reply) => {
        if (!upstream) {
          throw new ApiError(
            503,
            'validator_unavailable',
            'Layout submission is temporarily unavailable — the pinned Pixel Agents ' +
              'could not be found. This is a server misconfiguration, not something ' +
              'wrong with your request.',
          );
        }
        const { pin, validator } = upstream;

        const auth = requireAuth(request);
        // Not resolveUser's job (context.ts) — that is deliberately stateless.
        // blockedAt cannot be carried by the access token without being exactly
        // as stale as everything else the token already is, and a write this
        // abuse-sensitive is exactly the path where that staleness matters.
        const user = await getUserById(db, auth.id);
        if (!user) throw ApiError.unauthorized();
        if (user.blockedAt !== null) {
          throw ApiError.forbidden('This account is blocked from submitting layouts.');
        }

        const query = request.query as SubmitQuery;
        const tagNames = parseAndValidateTags(query.tags);

        const raw = request.body as string;
        const byteLength = Buffer.byteLength(raw, 'utf-8');
        if (byteLength > config.maxLayoutBytes) {
          throw new ApiError(
            413,
            'payload_too_large',
            `layout.json must be at most ${config.maxLayoutBytes} bytes (got ${byteLength}).`,
          );
        }

        let parsedLayout: unknown;
        try {
          parsedLayout = JSON.parse(raw);
        } catch {
          throw ApiError.badRequest('Body is not valid JSON.');
        }

        const validation = validator.validateLayout(parsedLayout);
        if (!validation.valid) throw ApiError.validation(validation.issues);

        const hash = sha256(raw);
        const duplicate = await findLayoutBySha256(db, hash);
        // `deleted` is excluded only when it is the SAME owner republishing
        // content they withdrew themselves (schema.ts's own visibility table:
        // "an owner may re-publish something they withdrew") — a stranger's
        // byte-identical resubmission of someone ELSE's deleted layout is
        // still a conflict, or `findLayoutBySha256` would let anyone publish
        // content only because its original owner once deleted it.
        const isOwnersOwnDeleted = duplicate?.visibility === 'deleted' && duplicate.authorUserId === user.id;
        if (duplicate && !isOwnersOwnDeleted) {
          throw ApiError.conflict(
            duplicate.visibility === 'public'
              ? `This exact layout is already published at "${duplicate.slug}".`
              : 'This exact layout was submitted before and is not available.',
          );
        }

        const submittedToday = await countUserSubmissionsSince(
          db,
          user.id,
          new Date(Date.now() - ONE_DAY_MS),
        );
        if (submittedToday >= config.maxSubmissionsPerUserPerDay) {
          throw new ApiError(
            429,
            'too_many_submissions',
            `You have reached the limit of ${config.maxSubmissionsPerUserPerDay} layout submissions per day.`,
          );
        }

        const stats = layoutStats(parsedLayout as Layout);

        // A true race between two concurrent submissions that both generated
        // the same slug before either committed is rare but real — retried
        // rather than surfaced, since it is not the caller's mistake to fix.
        let created: schema.Layout | undefined;
        for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
          const slug = await generateUniqueSlug(db, query.title);
          try {
            created = await db.transaction(async (tx: AnyDatabase) => {
              const [row] = await tx
                .insert(schema.layouts)
                .values({
                  slug,
                  title: query.title,
                  description: query.description ?? '',
                  authorUserId: user.id,
                  raw,
                  layout: parsedLayout,
                  sha256: hash,
                  cols: stats.cols,
                  rows: stats.rows,
                  furnitureCount: stats.furniture,
                  areaCount: stats.areas,
                  petCount: stats.pets,
                  carpetCount: stats.carpets,
                  layoutRevision: stats.layoutRevision,
                  pixelAgentsVersion: pin.version,
                })
                .returning();
              await attachTags(tx, row!.id, tagNames);
              await recordModerationAction(tx, {
                actorUserId: user.id,
                actorLabel: user.username,
                action: 'layout.create',
                targetType: 'layout',
                targetId: row!.id,
                after: { slug, title: query.title, visibility: 'public' },
              });
              return row!;
            });
          } catch (error) {
            if (isUniqueViolation(error, 'layouts_slug_key')) continue;
            throw error;
          }
        }
        if (!created) throw new ApiError(500, 'internal_error', 'Could not generate a unique slug.');

        // Best-effort: warms the renderer's own content-addressed cache and
        // surfaces an obviously-broken render immediately, but a failure here
        // never blocks or reverts the publication already committed above —
        // coupling "can I submit" to "is the renderer up" would make a
        // secondary feature able to take down the core one. The next request
        // for this slug's preview (#6) tries the renderer fresh regardless.
        const preview = await requestPreview(config.rendererUrl, parsedLayout, 1);
        if (!preview.ok) {
          request.log.warn(
            { err: preview.error, slug: created.slug },
            'submission preview render failed; publishing without one',
          );
        }

        reply.code(201).header('location', `/api/v1/layouts/${created.slug}`);
        return { ...toDetail(created, user, tagNames), previewReady: preview.ok };
      },
    );
  });
}
