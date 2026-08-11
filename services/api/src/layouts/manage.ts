/**
 * Everything a layout's owner (#9) — or, for visibility and metadata only, a
 * moderator/admin (#10) — can do to a layout that already exists:
 * `PATCH` (edit), `PUT .../layout` (replace the content), `DELETE` (owner
 * withdrawal), and `GET /me/layouts` (the owner's own full history,
 * including what is not public right now).
 *
 * #10 does not add its own hide/remove/restore endpoints — it reuses this
 * file's `PATCH`. A moderator sets `visibility` (with a required `reason`)
 * in the same request shape an owner uses to fix a typo in their
 * description; the difference is which fields the caller is allowed to
 * touch, checked once per request, not a different URL. See the comment
 * thread on issue #10 for why.
 */

import { type Layout, layoutStats, sha256, SLUG_RE, validateSlug } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FromSchema } from 'json-schema-to-ts';

import { requireSubmissionCapability } from '../auth/capability.js';
import { requireAuth } from '../auth/context.js';
import { getUserById } from '../auth/users.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import { one } from '../db/rows.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { RequestSchemas } from '../http.js';
import { recordModerationAction } from '../moderation/audit.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import { requestPreview } from '../renderer/client.js';
import {
  isUniqueViolation,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  validateTagNames,
} from './metadata.js';
import {
  authorForLayout,
  findLayoutBySha256,
  getLayoutBySlugAnyVisibility,
  listLayouts,
  replaceTags,
  tagsForLayouts,
} from './query.js';
import { slugParamsSchema } from './schemas.js';
import { toOwnerView } from './serialize.js';
import { isSlugReserved } from './slug.js';
import type { UpstreamValidator } from './upstreamValidator.js';

export interface ManageRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
  /** Shared with submit.ts — see upstreamValidator.ts. */
  upstream: UpstreamValidator | null;
}

const MODERATOR_VISIBILITIES = ['public', 'hidden', 'removed'] as const;
type ModeratorVisibility = (typeof MODERATOR_VISIBILITIES)[number];

// A vanity slug is still a URL segment, not free text — same practical bound
// as a title, even though (#29) it is no longer derived from one.
const MAX_SLUG_LENGTH = 60;

const patchBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
    tags: { type: 'array', items: { type: 'string' }, maxItems: MAX_TAGS },
    visibility: { type: 'string', enum: MODERATOR_VISIBILITIES },
    // Moderator-only (#29) — see the `slug` handling below. Format-checked
    // here for a fast 400; `validateSlug` (shared with layout-core) is the
    // actual source of truth and runs again in the handler.
    slug: { type: 'string', minLength: 1, maxLength: MAX_SLUG_LENGTH, pattern: SLUG_RE.source },
    reason: { type: 'string', minLength: 1, maxLength: 300 },
  },
} as const;

/** `hidden`/`removed`/`public` transitions map onto the four enum actions schema.ts already has. */
function visibilityAuditAction(
  from: schema.Layout['visibility'],
  to: ModeratorVisibility,
): schema.ModerationAction['action'] {
  if (to === 'removed') return 'layout.remove';
  if (from === 'removed') return 'layout.restore';
  return to === 'hidden' ? 'layout.hide' : 'layout.unhide';
}

async function requireAuthenticatedUser(db: AnyDatabase, request: FastifyRequest): Promise<schema.User> {
  const auth = requireAuth(request);
  const user = await getUserById(db, auth.id);
  if (!user) throw ApiError.unauthorized();
  return user;
}

export function registerManageRoutes(app: FastifyInstance, { config, db, upstream }: ManageRoutesDeps): void {
  // Types for `request.query`/`params`/`body` come from the JSON Schemas already
  // on each route below, instead of being restated as an interface and cast to.
  // `withTypeProvider` is compile-time only — it changes no runtime behaviour and
  // no schema — so the two can no longer drift apart in silence.
  const typed = app.withTypeProvider<RequestSchemas>();

  typed.patch(
    '/api/v1/layouts/:slug',
    { schema: { params: slugParamsSchema, body: patchBodySchema } },
    async (request, reply) => {
      const user = await requireSubmissionCapability(db, config, request);
      const { slug } = request.params;
      const body = request.body;

      const layout = await getLayoutBySlugAnyVisibility(db, slug);
      if (!layout) throw ApiError.notFound(`No layout "${slug}".`);

      const isOwner = layout.authorUserId === user.id;
      const isModerator = user.role === 'moderator' || user.role === 'admin';
      if (!isOwner && !isModerator) throw ApiError.forbidden();

      if (body.visibility !== undefined && !isModerator) {
        throw ApiError.forbidden("Only a moderator can change a layout's visibility.");
      }
      // A vanity slug is a privilege granted by staff, never something even
      // the owner of the layout can pick for themselves (#29) — same rule,
      // same message shape as the visibility check above.
      if (body.slug !== undefined && !isModerator) {
        throw ApiError.forbidden("Only a moderator can change a layout's slug.");
      }

      // A no-op resubmission of the layout's own current slug (e.g. an
      // untouched form field) is not a rename — do not demand a reason or
      // write an audit entry for a change that never happened. Narrowed to a
      // plain string-or-null, rather than testing `body.slug` again below,
      // so nothing downstream needs a non-null assertion to use it.
      const newSlug = body.slug !== undefined && body.slug !== layout.slug ? body.slug : null;
      const slugChanged = newSlug !== null;

      // Metadata on someone ELSE's layout, or any visibility/slug change, is
      // moderation — "no silent moderation" (#10) means it needs a reason.
      // An owner editing their own needs none; nobody has to justify their
      // own choices to themselves.
      const actingAsModerator = !isOwner || body.visibility !== undefined || slugChanged;
      if (actingAsModerator && !body.reason) {
        throw ApiError.badRequest('A reason is required for this change.');
      }

      if (newSlug !== null) {
        // Redundant with the schema's `pattern`, but the source of truth
        // shared with layout-core rather than a second regex that could drift.
        const slugValidation = validateSlug(newSlug);
        if (!slugValidation.valid) throw ApiError.validation(slugValidation.issues);

        // An exact rejection, never a silent `-2` suffix (that is
        // generateUniqueSlug's behaviour for an auto-generated slug, not for
        // a moderator's deliberately chosen string) — a moderator typing a
        // vanity slug expects that exact string or a clear error.
        //
        // The old slug is not freed for reuse: it is retired into
        // `retired_slugs` below, alongside the rename, so it stays reserved
        // forever exactly like a removed/deleted layout's slug already does.
        // `isSlugReserved` checks both currently-active slugs and that
        // retired history, so a moderator cannot vanity-rename a layout onto
        // a string some OTHER layout used to answer to either. Nothing
        // currently holding the old URL is redirected to the new one — #29's
        // request reads as a same-day, pre-share correction, not a
        // durable-link migration, and a freshly random-slugged layout has had
        // ~no opportunity to be shared before a moderator gives it a vanity
        // slug. See the PR description if that assumption ever stops holding.
        if (await isSlugReserved(db, newSlug)) {
          throw ApiError.conflict(`The slug "${newSlug}" is already in use.`);
        }
      }

      const tags = body.tags !== undefined ? validateTagNames(body.tags) : undefined;

      const before = {
        title: layout.title,
        description: layout.description,
        visibility: layout.visibility,
        slug: layout.slug,
      };
      const columns: Partial<schema.NewLayout> = {};
      if (body.title !== undefined) columns.title = body.title;
      if (body.description !== undefined) columns.description = body.description;
      if (body.visibility !== undefined) {
        columns.visibility = body.visibility;
        columns.visibilityReason = body.reason ?? null;
        columns.visibilityChangedAt = new Date();
        columns.visibilityChangedBy = user.id;
      }
      if (newSlug !== null) columns.slug = newSlug;

      const action = slugChanged
        ? 'layout.rename_slug'
        : body.visibility
          ? visibilityAuditAction(layout.visibility, body.visibility)
          : isOwner
            ? 'layout.update'
            : 'layout.moderate_edit';

      let updated: schema.Layout;
      try {
        updated = await db.transaction(async (tx: AnyDatabase) => {
          // One row binding rather than a one-element array: the `: [layout]`
          // branch only existed so both arms could be indexed the same way, and
          // indexing was what needed the assertion.
          const row =
            Object.keys(columns).length > 0
              ? one(
                  await tx
                    .update(schema.layouts)
                    .set(columns)
                    .where(eq(schema.layouts.id, layout.id))
                    .returning(),
                )
              : layout;
          if (tags !== undefined) await replaceTags(tx, layout.id, tags);
          // Retire the OLD slug in the same transaction as the rename that
          // vacates it — either both happen or neither does, so the "never
          // reused" invariant can't be defeated by a crash between the two.
          if (newSlug !== null) {
            await tx.insert(schema.retiredSlugs).values({ slug: layout.slug, layoutId: layout.id });
          }

          await recordModerationAction(tx, {
            actorUserId: user.id,
            actorLabel: user.username,
            action,
            targetType: 'layout',
            targetId: layout.id,
            reason: actingAsModerator ? (body.reason ?? null) : null,
            before,
            after: {
              title: row.title,
              description: row.description,
              visibility: row.visibility,
              slug: row.slug,
            },
          });
          return row;
        });
      } catch (error) {
        // The pre-check above closes almost every window, but a concurrent
        // moderator racing for the exact same vanity string is still
        // possible — the unique index is the actual last word.
        if (newSlug !== null && isUniqueViolation(error, 'layouts_slug_key')) {
          throw ApiError.conflict(`The slug "${newSlug}" is already in use.`);
        }
        throw error;
      }

      const [author, finalTags] = await Promise.all([
        authorForLayout(db, updated.authorUserId),
        tags !== undefined ? Promise.resolve(tags) : tagsForLayouts(db, [updated.id]).then((m) => m.get(updated.id) ?? []),
      ]);
      return reply.send(toOwnerView(updated, author, finalTags));
    },
  );

  // `async` selects Fastify's FastifyPluginAsync overload. Without it the
  // callback overload applies, which takes a third `done` argument and must
  // call it — so the plugin would never finish booting. The body has no
  // `await` because addContentTypeParser and the route registration below are
  // both synchronous; the `async` is the encapsulation contract, not a smell.
  // eslint-disable-next-line @typescript-eslint/require-await
  app.register(async (instance) => {
    // Same reasoning, same trick as submit.ts: the replacement layout is the
    // raw request body so it can be stored byte-for-byte, not a field nested
    // in a JSON envelope that would get re-serialised on the way in.
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

      // `Body: string` rather than a schema: the scoped content-type parser above
      // hands this route the request bytes verbatim, which is the whole point —
      // the layout is stored byte-for-byte. `Params`/`Querystring` still come
      // from the schemas, via FromSchema, because supplying any explicit route
      // generic switches the type provider off for the whole route.
    instance.put<{ Body: string; Params: FromSchema<typeof slugParamsSchema> }>(
      '/api/v1/layouts/:slug/layout',
      { ...writeRateLimitConfig(config), schema: { params: slugParamsSchema } },
      async (request, reply) => {
        if (!upstream) {
          throw new ApiError(
            503,
            'validator_unavailable',
            'Layout replacement is temporarily unavailable — the pinned Pixel Agents ' +
              'could not be found. This is a server misconfiguration, not something ' +
              'wrong with your request.',
          );
        }
        const { pin, validator } = upstream;

        const user = await requireSubmissionCapability(db, config, request);
        const { slug } = request.params;

        const layout = await getLayoutBySlugAnyVisibility(db, slug);
        if (!layout) throw ApiError.notFound(`No layout "${slug}".`);
        // Replace is deliberately owner-only, even for a moderator — #10's
        // scope is "edit metadata on any layout", never someone else's
        // design. A moderator who thinks a layout's content is the problem
        // hides or removes it (PATCH visibility) rather than rewriting it.
        if (layout.authorUserId !== user.id) throw ApiError.forbidden();

        const raw = request.body;
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
        if (hash !== layout.sha256) {
          // Same dedupe rule as submission, and the same `deleted` exception
          // (#9's fix note) — but only when it is the SAME owner's own
          // previously-deleted layout; a byte-identical match against
          // someone ELSE's deleted layout is still a conflict, see submit.ts.
          const duplicate = await findLayoutBySha256(db, hash);
          const isOwnersOwnDeleted =
            duplicate?.visibility === 'deleted' && duplicate.authorUserId === user.id;
          if (duplicate && duplicate.id !== layout.id && !isOwnersOwnDeleted) {
            throw ApiError.conflict(
              duplicate.visibility === 'public'
                ? `This exact layout is already published at "${duplicate.slug}".`
                : 'This exact layout was submitted before and is not available.',
            );
          }
        }

        const stats = layoutStats(parsedLayout as Layout, { catalog: validator.catalog });
        const updated = await db.transaction(async (tx: AnyDatabase) => {
          const row = one(
            await tx
            .update(schema.layouts)
            .set({
              raw,
              layout: parsedLayout,
              sha256: hash,
              cols: stats.cols,
              rows: stats.rows,
              furnitureCount: stats.furniture,
              areaCount: stats.areas,
              petCount: stats.pets,
              carpetCount: stats.carpets,
              seatCount: stats.seats,
              layoutRevision: stats.layoutRevision,
              pixelAgentsVersion: pin.version,
            })
            .where(eq(schema.layouts.id, layout.id))
            .returning(),
          );
          await recordModerationAction(tx, {
            actorUserId: user.id,
            actorLabel: user.username,
            action: 'layout.replace',
            targetType: 'layout',
            targetId: layout.id,
            before: { sha256: layout.sha256, layoutRevision: layout.layoutRevision },
            after: { sha256: row.sha256, layoutRevision: row.layoutRevision },
          });
          return row;
        });

        const preview = await requestPreview(config.rendererUrl, parsedLayout);
        if (!preview.ok) {
          request.log.warn(
            { err: preview.error, slug: updated.slug },
            'replacement preview render failed; publishing without one',
          );
        }

        const [author, tags] = await Promise.all([
          authorForLayout(db, updated.authorUserId),
          tagsForLayouts(db, [updated.id]).then((m) => m.get(updated.id) ?? []),
        ]);
        return reply.send({ ...toOwnerView(updated, author, tags), previewReady: preview.ok });
      },
    );
  });

  typed.delete(
    '/api/v1/layouts/:slug',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      // Deleting one's own content remains available after leaving the guild
      // or when Discord needs reconnecting; edits/replacements above do not.
      const user = await requireAuthenticatedUser(db, request);
      const { slug } = request.params;

      const layout = await getLayoutBySlugAnyVisibility(db, slug);
      if (!layout) throw ApiError.notFound(`No layout "${slug}".`);
      // Deletion is owner-only — a moderator removes via PATCH visibility,
      // never DELETE. Different actor, different action, even though both
      // land the layout out of the public API.
      if (layout.authorUserId !== user.id) throw ApiError.forbidden();

      if (layout.visibility === 'deleted') return reply.code(204).send();

      await db.transaction(async (tx: AnyDatabase) => {
        await tx
          .update(schema.layouts)
          .set({
            visibility: 'deleted',
            visibilityReason: null,
            visibilityChangedAt: new Date(),
            visibilityChangedBy: user.id,
          })
          .where(eq(schema.layouts.id, layout.id));
        await recordModerationAction(tx, {
          actorUserId: user.id,
          actorLabel: user.username,
          action: 'layout.delete',
          targetType: 'layout',
          targetId: layout.id,
          before: { visibility: layout.visibility },
          after: { visibility: 'deleted' },
        });
      });

      return reply.code(204).send();
    },
  );

  const meLayoutsQuerySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
      cursor: { type: 'string' },
    },
  } as const;

  typed.get(
    '/api/v1/me/layouts',
    { schema: { querystring: meLayoutsQuerySchema } },
    async (request) => {
      const user = requireAuth(request);
      const query = request.query;

      const { rows, total, nextCursor } = await listLayouts(db, {
        filters: {},
        sort: 'newest',
        // Defaulted by the schema, applied by ajv — see layouts/routes.ts.
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        scope: { type: 'owner', userId: user.id },
      });

      const [authors, tagsByLayout] = await Promise.all([
        authorForLayout(db, user.id).then((author) => new Map(author ? [[author.id, author]] : [])),
        tagsForLayouts(db, rows.map((row) => row.id)),
      ]);

      return {
        schemaVersion: 1,
        total,
        layouts: rows.map((row) =>
          toOwnerView(row, authors.get(row.authorUserId) ?? null, tagsByLayout.get(row.id) ?? []),
        ),
        nextCursor,
      };
    },
  );
}
