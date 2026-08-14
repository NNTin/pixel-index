#!/usr/bin/env node
/**
 * Loads the git-versioned seed (`seed/<slug>/{layout.json,meta.json}`) into
 * the database on first boot, so a fresh install is never an empty page
 * (#18). Idempotent — runs before every start, same as migrate.ts, and is a
 * silent no-op once any layout exists, seeded or not: this only ever fills
 * an empty table, never reconciles one that already has content.
 *
 * Bundled layouts carry their author's Discord id (#23) and therefore have
 * the same real, clickable owner as a submitted layout. Custom/legacy seeds
 * may omit it and retain the synthetic-user + `authorDisplay` fallback.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createValidator,
  type Layout,
  type LayoutMeta,
  layoutStats,
  sha256,
  upstreamPin,
} from '@pixel-index/layout-core';
import { eq, sql } from 'drizzle-orm';

import { validateTagNames } from '../layouts/metadata.js';
import { attachTags } from '../layouts/query.js';
import { recordModerationAction } from '../moderation/audit.js';
import { type AnyDatabase, createDatabase } from './client.js';
import { SYSTEM_USER_ID } from './constants.js';
import { one } from './rows.js';
import * as schema from './schema.js';

/** Resolves identically from `src/` under tsx and from `dist/` after a build — same trick as migrate.ts's MIGRATIONS_FOLDER. */
export const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../seed');

function readSeedSlugs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function seedIfEmpty(db: AnyDatabase, dir: string = SEED_DIR): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.layouts);
  const count = row?.count ?? 0;
  if (count > 0) {
    console.log(`${count} layout(s) already exist — skipping seed.`);
    return 0;
  }

  const slugs = readSeedSlugs(dir);
  if (slugs.length === 0) {
    console.log(`No seed layouts found at ${dir} — nothing to seed.`);
    return 0;
  }

  const pin = upstreamPin();
  const validator = createValidator({ upstreamVersion: pin.version });

  for (const slug of slugs) {
    const raw = fs.readFileSync(path.join(dir, slug, 'layout.json'), 'utf-8');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, slug, 'meta.json'), 'utf-8')) as LayoutMeta;
    const parsedLayout: unknown = JSON.parse(raw);

    // Seed layouts are shipped by this repo, but they still go through the
    // exact same validation a real submission would — a seed layout the API
    // itself would reject is a bug worth crashing the boot for, not silently
    // publishing.
    const validation = validator.validateLayout(parsedLayout);
    if (!validation.valid) {
      throw new Error(
        `Seed layout "${slug}" fails validation against pixel-agents ${pin.version ?? 'unknown'}: ` +
          JSON.stringify(validation.issues),
      );
    }

    const stats = layoutStats(parsedLayout as Layout, { catalog: validator.catalog });
    const tags = validateTagNames(meta.tags ?? []);
    // `deleted` is not a meta.json value (meta.schema.json) — there is nothing
    // to seed for a layout that no longer exists.
    const visibility = meta.visibility ?? 'public';

    await db.transaction(async (tx: AnyDatabase) => {
      let authorUserId = SYSTEM_USER_ID;
      let authorDisplay: string | null = meta.author;
      if (meta.authorDiscordId) {
        const [known] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.discordId, meta.authorDiscordId));
        if (known) {
          authorUserId = known.id;
        } else {
          const created = one(
            await tx
              .insert(schema.users)
              .values({ discordId: meta.authorDiscordId, username: meta.author })
              .returning({ id: schema.users.id }),
          );
          authorUserId = created.id;
        }
        authorDisplay = null;
      }

      const row = one(
        await tx
        .insert(schema.layouts)
        .values({
          slug,
          title: meta.title,
          description: meta.description,
          authorUserId,
          authorDisplay,
          visibility,
          raw,
          layout: parsedLayout,
          sha256: sha256(raw),
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
        })
        .returning(),
      );
      await attachTags(tx, row.id, tags);
      await recordModerationAction(tx, {
        actorUserId: SYSTEM_USER_ID,
        actorLabel: 'seed',
        action: 'layout.create',
        targetType: 'layout',
        targetId: row.id,
        after: { slug, title: meta.title, visibility },
      });
    });
    console.log(`Seeded ${slug}.`);
  }

  console.log(`Seeded ${slugs.length} layout(s).`);
  return slugs.length;
}

// Only run when executed directly, so importing this for tests is harmless —
// same pattern as migrate.ts.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { db, pool } = createDatabase();
  seedIfEmpty(db)
    .then(() => pool.end())
    .catch((error: unknown) => {
      console.error('Seeding failed:', error);
      return pool.end().finally(() => process.exit(1));
    });
}
