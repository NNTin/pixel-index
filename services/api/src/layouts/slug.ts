/**
 * Slug generation for a submission, and the "has this slug ever existed"
 * check shared with a moderator's later vanity rename (manage.ts).
 *
 * Deliberately unrelated to the submitted title (#29): a title-derived slug
 * is a first-come-first-served vanity name, free for the taking by anyone
 * fast enough to submit it — a real abuse vector regardless of the author's
 * role. Every submission, admin or community member alike, gets a random,
 * unpredictable slug instead; a human-chosen vanity slug is a privilege a
 * moderator grants deliberately afterwards, via `PATCH /api/v1/layouts/:slug`
 * (manage.ts), never something a submitter picks for themselves.
 *
 * Collision-safe and stable: generated once at submission time and never
 * regenerated from a later title edit (#9), because the slug is a permanent,
 * linkable, downloadable URL — silently moving it out from under a link
 * someone already shared would be a worse surprise than a slug that no
 * longer matches a since-renamed title.
 */

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';

// 5 bytes -> 10 lowercase hex characters. Hex is exactly the [a-z0-9]
// alphabet SLUG_RE (layout-core) and the `layouts_slug_format` check
// constraint (schema.ts) require, so every candidate is valid by
// construction — no further formatting or validation needed.
const RANDOM_SLUG_BYTES = 5;
const MAX_ATTEMPTS = 5;

/** A CSPRNG candidate, not a guessable counter or Math.random() — see the file header. */
function randomSlugCandidate(): string {
  return randomBytes(RANDOM_SLUG_BYTES).toString('hex');
}

/**
 * True if `slug` is currently in use by a layout (any visibility — see
 * below) OR was retired by a past vanity rename (schema.ts's
 * `retiredSlugs`). Shared by random generation here and by a moderator's
 * vanity-slug collision check (manage.ts), so the two can never diverge on
 * what counts as "taken".
 *
 * No visibility filter on the `layouts` lookup: a moderator-removed layout
 * still reserves its slug forever (schema.ts's own comment on
 * `layouts_slug_key` — slug reuse by a different author is a quiet
 * impersonation vector), so this has to agree or it would hand out a slug
 * the database then rejects on insert.
 */
export async function isSlugReserved(db: AnyDatabase, slug: string): Promise<boolean> {
  const [active] = await db
    .select({ slug: schema.layouts.slug })
    .from(schema.layouts)
    .where(eq(schema.layouts.slug, slug));
  if (active) return true;

  const [retired] = await db
    .select({ slug: schema.retiredSlugs.slug })
    .from(schema.retiredSlugs)
    .where(eq(schema.retiredSlugs.slug, slug));
  return retired !== undefined;
}

export async function generateUniqueSlug(db: AnyDatabase): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomSlugCandidate();
    if (!(await isSlugReserved(db, candidate))) return candidate;
  }
  throw new Error('Could not generate a unique slug after multiple attempts.');
}
