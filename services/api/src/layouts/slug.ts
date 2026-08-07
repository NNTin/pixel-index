/**
 * Slug generation from a submitted title.
 *
 * Collision-safe and stable: generated once at submission time and never
 * regenerated from a later title edit (#9), because the slug is a permanent,
 * linkable, downloadable URL — silently moving it out from under a link
 * someone already shared would be a worse surprise than a slug that no
 * longer matches a since-renamed title.
 */

import { sql } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';

const MAX_SLUG_LENGTH = 60; // matches the title length limit it is derived from
const FALLBACK_BASE = 'layout';

/**
 * A title to a bare slug base — no collision handling yet. Mirrors
 * `layouts_slug_format` (schema.ts) and layout-core's `SLUG_RE`
 * (`^[a-z0-9][a-z0-9-]*$`) exactly, since the database check constraint will
 * reject anything this function could produce that does not match it.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining diacritical marks (U+0300–U+036F) left behind by NFKD
    // decomposition, so "Café" -> "cafe" rather than losing the "e" entirely.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ''); // truncation can leave a trailing "-"

  // A title that is all emoji, all CJK, or otherwise contributes nothing
  // ASCII-alphanumeric still needs a valid, non-empty slug to exist under.
  return base.length > 0 ? base : FALLBACK_BASE;
}

/**
 * The slug column has no visibility filter on its unique index (schema.ts) —
 * a moderator-removed layout still reserves its slug forever, so a resubmission
 * of similarly-titled content cannot collide with, or launder into, a slug
 * that was already taken. This query has to agree with that: no visibility
 * filter here either.
 */
export async function generateUniqueSlug(db: AnyDatabase, title: string): Promise<string> {
  const base = slugify(title);

  const taken = await db
    .select({ slug: schema.layouts.slug })
    .from(schema.layouts)
    .where(sql`${schema.layouts.slug} = ${base} OR ${schema.layouts.slug} ~ ${`^${escapeRegex(base)}-[0-9]+$`}`);

  if (taken.length === 0) return base;

  const takenSet = new Set(taken.map((row) => row.slug));
  if (!takenSet.has(base)) return base; // shouldn't happen given the query above, but cheap to keep correct

  let suffix = 2;
  while (takenSet.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
