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

import {
  createValidator,
  layoutStats,
  SLUG_RE,
  sha256,
  upstreamPin,
  type Layout,
  type Validator,
} from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/context.js';
import { getUserById } from '../auth/users.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import { requestPreview } from '../renderer/client.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import { attachTags, countUserSubmissionsSince, findLayoutBySha256 } from './query.js';
import { generateUniqueSlug } from './slug.js';
import { toDetail } from './serialize.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24; // matches meta.schema.json's tag maxLength

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

function parseAndValidateTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const names = [...new Set(raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0))];

  if (names.length > MAX_TAGS) {
    throw ApiError.validation(
      [{ code: 'meta.schema', path: '/tags', message: `at most ${MAX_TAGS} tags, got ${names.length}` }],
      'Too many tags.',
    );
  }
  const issues = names
    .filter((name) => !SLUG_RE.test(name) || name.length > MAX_TAG_LENGTH)
    .map((name) => ({
      code: 'meta.schema' as const,
      path: '/tags',
      message: `tag "${name}" must be lowercase kebab-case (a-z, 0-9, hyphen), max ${MAX_TAG_LENGTH} characters`,
    }));
  if (issues.length > 0) throw ApiError.validation(issues, 'One or more tags are invalid.');

  return names;
}

/** Postgres/PGlite unique-violation, optionally narrowed to one constraint. */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  const code = err.code ?? (err.cause as { code?: unknown } | undefined)?.code;
  if (code !== '23505') return false;
  if (!constraint) return true;
  const actualConstraint = err.constraint ?? (err.cause as { constraint?: unknown } | undefined)?.constraint;
  return actualConstraint === constraint;
}

export interface SubmitRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

export function registerSubmitRoutes(app: FastifyInstance, { config, db }: SubmitRoutesDeps): void {
  // Built once at boot, not per request: furnitureCatalog() walks the whole
  // asset tree, and the pin cannot change for the lifetime of one process.
  //
  // This does NOT throw on failure, even though a missing upstream makes
  // every single submission impossible — the same tension /meta already
  // resolved (meta.ts) applies here too, and for the same reason: this
  // process serves reads as well as this one write route, and a self-hoster
  // who forgot `git submodule update --init` should get a broken submission
  // endpoint, not a service that will not start at all. The route below
  // fails every request with a clear 503 instead.
  let upstream: { pin: ReturnType<typeof upstreamPin>; validator: Validator } | null = null;
  try {
    const pin = upstreamPin(config.upstreamDir);
    const validator = createValidator({
      ...(config.upstreamDir ? { upstreamDir: config.upstreamDir } : {}),
      upstreamVersion: pin.version,
    });
    upstream = { pin, validator };
  } catch (error) {
    app.log.error(
      { err: error },
      'Pinned Pixel Agents not found — POST /api/v1/layouts will refuse every submission until this is fixed.',
    );
  }

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
        if (duplicate) {
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
