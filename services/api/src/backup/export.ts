/**
 * `GET /api/v1/admin/backup` — a zip of every non-deleted layout, mirroring
 * `seed/`'s own `<slug>/{layout.json,meta.json}` shape (#63).
 *
 * Admin-only and deliberately NOT the same route as `GET
 * /api/v1/export/layouts.ndjson` (export.ts): that one is public,
 * unauthenticated, and public-visibility-only by design (#26's vendor-update
 * gate, which has no business seeing hidden content). This one exists
 * specifically because `hidden` layouts need backing up too, which is not
 * something a public, unauthenticated route can ever serve.
 *
 * Buffered, not streamed: JSZip has to hold the whole archive to produce a
 * single `generateAsync()` result, and at today's scale (an admin-only route,
 * not the public index) that is a fine trade for the simplicity of "one zip,
 * one response". If the index grows large enough for this to matter, the fix
 * is a streaming zip writer piped straight to the response — worth doing
 * later, not worth the complexity now. The one thing this already does NOT
 * do is hold the whole *database result set* in memory at once: rows are
 * paged in from `streamBackupLayouts` and each page's authors/tags are
 * batch-fetched together, the same shape `export.ts` uses for the public feed.
 */

import type { LayoutMeta } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';

import { requireCapability } from '../auth/capability.js';
import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import type * as schema from '../db/schema.js';
import { authorsForLayouts, streamBackupLayouts, tagsForLayouts } from '../layouts/query.js';
import { publicAuthor } from '../layouts/serialize.js';
import { BACKUP_SCHEMA_VERSION, type BackupManifest } from './manifest.js';

export interface BackupExportRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

/** How many rows are paged in — and how many authors/tags are batch-fetched — at a time. */
const BATCH_SIZE = 200;

/** One layout row → the `meta.json` this backup ships beside its `layout.json`. */
function toBackupMeta(layout: schema.Layout, author: schema.User | null, tags: string[]): LayoutMeta {
  const credited = publicAuthor(layout, author);
  return {
    title: layout.title,
    author: credited.displayName,
    // `credited.discordId` is already `null` for the same "unlinked legacy
    // credit" case meta.schema.json's `authorDiscordId` has to stay absent
    // for — see publicAuthor() for that rule.
    ...(credited.discordId ? { authorDiscordId: credited.discordId } : {}),
    description: layout.description,
    ...(tags.length > 0 ? { tags } : {}),
    // `streamBackupLayouts` only ever yields `public`/`hidden` rows, but the
    // column type is wider — this is what says so without an unsafe cast.
    visibility: layout.visibility === 'hidden' ? 'hidden' : 'public',
    createdAt: layout.createdAt.toISOString(),
  };
}

async function buildBackupZip(db: AnyDatabase): Promise<{ zip: JSZip; count: number }> {
  const zip = new JSZip();
  let batch: schema.Layout[] = [];
  let count = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const [authors, tagsByLayout] = await Promise.all([
      authorsForLayouts(db, batch.map((row) => row.authorUserId)),
      tagsForLayouts(db, batch.map((row) => row.id)),
    ]);
    for (const row of batch) {
      const folder = zip.folder(row.slug);
      // `slug` is DB-constrained to `layouts_slug_format` (schema.ts), which
      // is a strict subset of what JSZip accepts as a folder name — this
      // never actually returns null, but the library's own type says it can.
      if (!folder) continue;
      folder.file('layout.json', row.raw);
      folder.file(
        'meta.json',
        JSON.stringify(
          toBackupMeta(row, authors.get(row.authorUserId) ?? null, tagsByLayout.get(row.id) ?? []),
          null,
          2,
        ),
      );
    }
    count += batch.length;
    batch = [];
  };

  for await (const row of streamBackupLayouts(db, BATCH_SIZE)) {
    batch.push(row);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return { zip, count };
}

export function registerBackupExportRoutes(app: FastifyInstance, { config, db }: BackupExportRoutesDeps): void {
  app.get(
    '/api/v1/admin/backup',
    {
      schema: {
        summary: 'A zip backup of every public and hidden layout, mirroring seed/\'s folder shape.',
        description:
          'Admin only. manifest.json at the root, then <slug>/{layout.json,meta.json} per layout — ' +
          'the same shape seed/ uses, so this can be mass-imported with POST ' +
          '/api/v1/admin/backup/import. deleted layouts are excluded: there is nothing to back up ' +
          'for a layout that is gone for good.',
        tags: ['admin'],
      },
      // Its own bucket, not the general one: like the public NDJSON export,
      // this route's cost scales with the size of the index rather than being
      // constant, and it is the one place that is true for an admin route too.
      config: {
        rateLimit: {
          max: config.exportRateLimit.max,
          timeWindow: config.exportRateLimit.windowMs,
        },
      },
    },
    async (request, reply) => {
      await requireCapability(db, config, request, 'admin');

      const { zip, count } = await buildBackupZip(db);
      const manifest: BackupManifest = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        count,
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const filename = `pixel-index-backup-${manifest.generatedAt.slice(0, 10)}.zip`;
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    },
  );
}
