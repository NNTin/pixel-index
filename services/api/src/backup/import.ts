/**
 * `POST /api/v1/admin/backup/import` — mass-restore from a backup zip built
 * by `GET /api/v1/admin/backup` (#63). Admin-only — deliberately ONLY a
 * Discord-session admin, unlike that route: this one never checks the
 * `X-Backup-Api-Key` header the scheduled backup workflow authenticates
 * with (see export.ts's doc comment for what that key is and why). A key
 * that can only ever trigger a read is a materially smaller blast radius
 * than one that can also mass-overwrite the index; nothing here widens
 * that on purpose.
 *
 * **Collision handling: upsert by slug.** The whole reason this exists (#64's
 * staging/production model) is "import production's backup into develop to
 * refresh staging data" — an admin restoring into a database that already
 * holds a previous copy of the same layouts is the EXPECTED case, not an
 * edge case. Skip-existing would make that primary use case a no-op after the
 * first run, and reject-on-any-collision would make it unusable after the
 * first run entirely. So an entry whose slug already exists is updated in
 * place — content, metadata and visibility all overwritten from the backup —
 * and an entry with a new slug is inserted, using that exact slug rather than
 * a freshly generated one: a restore is reproducing known content at its
 * known address, not publishing something new.
 *
 * **Partial success, not all-or-nothing.** Each entry is validated and
 * written in its own transaction, so one malformed or invalid entry in a
 * multi-hundred-layout backup does not roll back the other 499 — the response
 * reports exactly which slugs succeeded and which failed, and why. An
 * all-or-nothing import would turn "one layout was hand-edited into the zip
 * and no longer validates" into "the entire restore did nothing", which is a
 * worse failure mode for a disaster-recovery tool than reporting the one bad
 * entry and importing everything else.
 *
 * Every entry is validated exactly like a real submission: `validateLayout`
 * for `layout.json`, `validateMeta` for `meta.json`, `validateSlug` for the
 * directory name — the same shared validator `submit.ts` and `manage.ts` use,
 * not a separate ad hoc check.
 */

import {
  type Layout,
  type LayoutMeta,
  layoutStats,
  sha256,
  type ValidationIssue,
} from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FromSchema } from 'json-schema-to-ts';
import JSZip from 'jszip';

import { requireCapability } from '../auth/capability.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import { one } from '../db/rows.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import { isUniqueViolation, validateTagNames } from '../layouts/metadata.js';
import { getLayoutBySlugAnyVisibility, replaceTags, resolveAuthorFromMeta } from '../layouts/query.js';
import type { UpstreamValidator } from '../layouts/upstreamValidator.js';
import { recordModerationAction } from '../moderation/audit.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import { BACKUP_SCHEMA_VERSION } from './manifest.js';

export interface BackupImportRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
  /** Shared with submit.ts/manage.ts — see upstreamValidator.ts. */
  upstream: UpstreamValidator | null;
}

const importQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Optional, unlike manage.ts's moderator PATCH/DELETE: restoring known
    // content at its known slug is not a subjective moderation call an admin
    // has to justify to anyone, the same way seed.ts's system import needs
    // none either — this exists for an admin who wants one on the record
    // anyway (e.g. "restore from 2026-08-14 production backup").
    reason: { type: 'string', maxLength: 300 },
  },
} as const;

export interface ImportFailure {
  slug: string;
  reason: string;
}

export interface ImportReportBody {
  schemaVersion: number;
  created: number;
  updated: number;
  failed: ImportFailure[];
}

function describeIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}

type EntryOutcome = { ok: true; outcome: 'created' | 'updated' } | { ok: false; reason: string };

async function importOneEntry(
  db: AnyDatabase,
  upstream: UpstreamValidator,
  zip: JSZip,
  slug: string,
  actor: schema.User,
  reason: string | null,
): Promise<EntryOutcome> {
  const { validator, pin } = upstream;

  const slugValidation = validator.validateSlug(slug);
  if (!slugValidation.valid) return { ok: false, reason: describeIssues(slugValidation.issues) };

  const layoutFile = zip.file(`${slug}/layout.json`);
  const metaFile = zip.file(`${slug}/meta.json`);
  if (!layoutFile || !metaFile) {
    return { ok: false, reason: `missing ${!layoutFile ? 'layout.json' : 'meta.json'}` };
  }

  const raw = await layoutFile.async('string');
  const metaRaw = await metaFile.async('string');

  let parsedLayout: unknown;
  let parsedMeta: unknown;
  try {
    parsedLayout = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'layout.json is not valid JSON' };
  }
  try {
    parsedMeta = JSON.parse(metaRaw);
  } catch {
    return { ok: false, reason: 'meta.json is not valid JSON' };
  }

  const layoutValidation = validator.validateLayout(parsedLayout);
  if (!layoutValidation.valid) return { ok: false, reason: describeIssues(layoutValidation.issues) };
  const metaValidation = validator.validateMeta(parsedMeta);
  if (!metaValidation.valid) return { ok: false, reason: describeIssues(metaValidation.issues) };

  const meta = parsedMeta as LayoutMeta;

  let tags: string[];
  try {
    tags = validateTagNames(meta.tags ?? []);
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError ? error.message : 'invalid tags' };
  }

  const stats = layoutStats(parsedLayout as Layout, { catalog: validator.catalog });
  const hash = sha256(raw);
  const visibility = meta.visibility ?? 'public';

  try {
    return await db.transaction(async (tx: AnyDatabase) => {
      const { authorUserId, authorDisplay } = await resolveAuthorFromMeta(tx, meta);
      // A fresh lookup inside the transaction, not a snapshot taken before
      // it: two entries in the same zip can never collide with each other,
      // but a concurrent import run racing this one still could.
      const existing = await getLayoutBySlugAnyVisibility(tx, slug);
      // Only a genuine change stamps who/when — a routine re-import that
      // reproduces the same visibility (the common case: restoring the same
      // backup, or one layout among hundreds that simply did not change)
      // must not overwrite the true history of who last changed it, or
      // silently rewrite the "why is this hidden" timestamp an owner sees on
      // /me/layouts (serialize.ts's OwnerLayoutView) to "just now, the import
      // job". Never set on insert either, for the same reason seed.ts's own
      // insert never does: a first-time creation is not a moderation change.
      const visibilityChanged = existing !== null && existing.visibility !== visibility;

      const columns = {
        title: meta.title,
        description: meta.description,
        authorUserId,
        authorDisplay,
        raw,
        layout: parsedLayout,
        sha256: hash,
        cols: stats.cols,
        rows: stats.rows,
        visibleCols: stats.visibleCols,
        visibleRows: stats.visibleRows,
        furnitureCount: stats.furniture,
        areaCount: stats.areas,
        petCount: stats.pets,
        carpetCount: stats.carpets,
        seatCount: stats.seats,
        layoutRevision: stats.layoutRevision,
        pixelAgentsVersion: pin.version,
        visibility,
        ...(visibilityChanged
          ? { visibilityReason: null, visibilityChangedAt: new Date(), visibilityChangedBy: actor.id }
          : {}),
      };

      // Any existing row at this slug is overwritten regardless of its
      // current visibility, including `deleted` — a restore is authoritative
      // over the slug it names, unlike manage.ts's vanity-slug reassignment
      // (a different scenario: a moderator handing an ALREADY-freed slug to
      // DIFFERENT content). This is the same content reclaiming its own
      // address.
      const row = existing
        ? one(
            await tx
              .update(schema.layouts)
              .set(columns)
              .where(eq(schema.layouts.id, existing.id))
              .returning(),
          )
        : one(await tx.insert(schema.layouts).values({ slug, ...columns }).returning());

      await replaceTags(tx, row.id, tags);
      await recordModerationAction(tx, {
        actorUserId: actor.id,
        actorLabel: actor.username,
        action: 'layout.import',
        targetType: 'layout',
        targetId: row.id,
        reason,
        before: existing
          ? { slug: existing.slug, sha256: existing.sha256, visibility: existing.visibility }
          : null,
        after: { slug: row.slug, sha256: row.sha256, visibility: row.visibility },
      });

      return { ok: true, outcome: existing ? 'updated' : 'created' } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'layouts_slug_key')) {
      return { ok: false, reason: `slug "${slug}" was claimed by a concurrent import` };
    }
    throw error;
  }
}

export function registerBackupImportRoutes(
  app: FastifyInstance,
  { config, db, upstream }: BackupImportRoutesDeps,
): void {
  // Same reasoning, same trick as submit.ts/manage.ts: a scoped content-type
  // parser so only this route gets raw bytes instead of Fastify's normal
  // parsed-JSON behaviour.
  // eslint-disable-next-line @typescript-eslint/require-await
  app.register(async (instance) => {
    instance.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    instance.post<{ Body: Buffer; Querystring: FromSchema<typeof importQuerySchema> }>(
      '/api/v1/admin/backup/import',
      {
        ...writeRateLimitConfig(config),
        // The one route allowed to exceed the global bodyLimit — see
        // config.ts's `maxImportBytes` doc comment for why.
        bodyLimit: config.maxImportBytes,
        schema: {
          querystring: importQuerySchema,
          summary: 'Mass-import layouts from a backup zip (GET /api/v1/admin/backup\'s own shape).',
          description:
            'Admin only. Upserts by slug: an existing slug is overwritten, a new one is created ' +
            'at the exact slug the zip names. Each entry is validated and written independently, ' +
            'so one invalid entry is reported rather than failing the whole import.',
          tags: ['admin'],
        },
      },
      async (request, reply): Promise<ImportReportBody> => {
        if (!upstream) {
          throw new ApiError(
            503,
            'validator_unavailable',
            'Backup import is temporarily unavailable — the pinned Pixel Agents could not be ' +
              'found. This is a server misconfiguration, not something wrong with your request.',
          );
        }

        const actor = await requireCapability(db, config, request, 'admin');

        const raw = request.body;
        if (!Buffer.isBuffer(raw) || raw.length === 0) {
          throw ApiError.badRequest('Body must be a non-empty zip file.');
        }

        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(raw);
        } catch {
          throw ApiError.badRequest('Body is not a valid zip file.');
        }

        const reason = request.query.reason ?? null;

        // Every `<slug>/layout.json` names a candidate entry; `meta.json`'s
        // presence (or absence, reported as a per-entry failure) is checked
        // inside importOneEntry rather than here, so a directory with one
        // file but not the other is a reported failure, not a silent skip.
        const slugs = new Set<string>();
        for (const path of Object.keys(zip.files)) {
          const match = /^([^/]+)\/layout\.json$/.exec(path);
          if (match?.[1]) slugs.add(match[1]);
        }

        const report: ImportReportBody = {
          schemaVersion: BACKUP_SCHEMA_VERSION,
          created: 0,
          updated: 0,
          failed: [],
        };

        for (const slug of [...slugs].sort()) {
          let outcome: EntryOutcome;
          try {
            outcome = await importOneEntry(db, upstream, zip, slug, actor, reason);
          } catch (error) {
            request.log.error({ err: error, slug }, 'backup import: unexpected failure for one entry');
            outcome = { ok: false, reason: 'Unexpected server error processing this entry.' };
          }

          if (outcome.ok) {
            if (outcome.outcome === 'created') report.created += 1;
            else report.updated += 1;
          } else {
            report.failed.push({ slug, reason: outcome.reason });
          }
        }

        return reply.send(report);
      },
    );
  });
}
