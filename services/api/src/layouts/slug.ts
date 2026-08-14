/**
 * Random slug generation for a submission.
 *
 * Deliberately unrelated to the submitted title (#29): a title-derived slug
 * is a first-come-first-served vanity name, free for the taking by anyone
 * fast enough to submit it — a real abuse vector regardless of the author's
 * role. Every submission, admin or community member alike, gets a random,
 * unpredictable slug instead; a human-chosen vanity slug is a privilege a
 * moderator grants deliberately afterwards, via `PATCH /api/v1/layouts/:slug`
 * (manage.ts), never something a submitter picks for themselves.
 *
 * The slug is never regenerated from a later title edit (#9) — it is a
 * permanent, linkable, downloadable URL, and silently moving it out from
 * under a link someone already shared would be a worse surprise than a slug
 * that no longer matches a since-renamed title.
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
 * True if `slug` is currently held by some row in `layouts`, regardless of
 * visibility. A `deleted` row still literally holds its slug value — the
 * unique index (`layouts_slug_key`, schema.ts) is not visibility-aware, so
 * this has to check every row or it could hand a fresh random candidate to a
 * submission and have the insert rejected. Only used for picking a genuinely
 * free *random* candidate; a moderator's vanity-slug claim (manage.ts) needs
 * the actual row, not just this boolean, because it is willing to evict a
 * deleted holder rather than treat it as blocking — see manage.ts for why.
 */
export async function isSlugReserved(db: AnyDatabase, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ slug: schema.layouts.slug })
    .from(schema.layouts)
    .where(eq(schema.layouts.slug, slug));
  return row !== undefined;
}

export async function generateUniqueSlug(db: AnyDatabase): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomSlugCandidate();
    if (!(await isSlugReserved(db, candidate))) return candidate;
  }
  throw new Error('Could not generate a unique slug after multiple attempts.');
}
