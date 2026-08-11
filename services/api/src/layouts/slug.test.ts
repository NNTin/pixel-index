import { randomBytes } from 'node:crypto';

import { SLUG_RE } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertLayout } from '../test-support/layouts.js';
import { generateUniqueSlug, isSlugReserved } from './slug.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

// `randomBytes` is overloaded (sync-returning vs. callback-taking); casting
// once here, rather than at every call site, is what lets `.mockReturnValueOnce`
// below see the plain synchronous signature slug.ts actually calls.
const mockedRandomBytes = randomBytes as unknown as Mock<(size: number) => Buffer>;

describe('generateUniqueSlug', () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await createTestDatabase();
  });
  afterAll(async () => harness.close());

  it('produces a slug matching the shared SLUG_RE format', async () => {
    const slug = await generateUniqueSlug(harness.db);
    expect(slug).toMatch(SLUG_RE);
  });

  it('is not derived from any title — repeated calls are unrelated and unpredictable', async () => {
    const a = await generateUniqueSlug(harness.db);
    const b = await generateUniqueSlug(harness.db);
    expect(a).not.toBe(b);
  });

  it('retries when the randomly generated candidate is already taken', async () => {
    await insertLayout(harness.db, { slug: 'aaaaaaaaaa' });
    mockedRandomBytes
      .mockReturnValueOnce(Buffer.from('aaaaaaaaaa', 'hex'))
      .mockReturnValueOnce(Buffer.from('bbbbbbbbbb', 'hex'));

    expect(await generateUniqueSlug(harness.db)).toBe('bbbbbbbbbb');
  });

  it("considers a REMOVED layout's slug just as taken as a public one", async () => {
    // The unique index has no visibility filter (schema.ts) — a removed row
    // still literally holds its slug value at rest, and random generation has
    // to agree or it would hand out a slug the database then rejects on
    // insert. (A moderator's vanity-slug claim, unlike random generation, is
    // willing to evict a removed/deleted holder instead — see manage.ts.)
    await insertLayout(harness.db, { slug: 'ccccccccc1', visibility: 'removed' });
    mockedRandomBytes
      .mockReturnValueOnce(Buffer.from('ccccccccc1', 'hex'))
      .mockReturnValueOnce(Buffer.from('dddddddddd', 'hex'));

    expect(await generateUniqueSlug(harness.db)).toBe('dddddddddd');
  });

  it('gives up after repeated collisions rather than looping forever', async () => {
    await insertLayout(harness.db, { slug: 'eeeeeeeeee' });
    mockedRandomBytes.mockReturnValue(Buffer.from('eeeeeeeeee', 'hex'));

    await expect(generateUniqueSlug(harness.db)).rejects.toThrow(
      'Could not generate a unique slug after multiple attempts.',
    );
  });
});

describe('isSlugReserved', () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await createTestDatabase();
  });
  afterAll(async () => harness.close());

  it('is false for a slug nothing has ever used', async () => {
    expect(await isSlugReserved(harness.db, 'never-used-office')).toBe(false);
  });

  it('is true for a slug a public layout currently holds', async () => {
    await insertLayout(harness.db, { slug: 'active-office' });
    expect(await isSlugReserved(harness.db, 'active-office')).toBe(true);
  });

  it('is true for a slug a removed layout still holds — it is not visibility-aware', async () => {
    await insertLayout(harness.db, { slug: 'removed-office', visibility: 'removed' });
    expect(await isSlugReserved(harness.db, 'removed-office')).toBe(true);
  });

  it('is false again once a layout renames away from a slug — nothing holds it any more', async () => {
    const layout = await insertLayout(harness.db, { slug: 'about-to-move' });
    expect(await isSlugReserved(harness.db, 'about-to-move')).toBe(true);

    await harness.db.update(schema.layouts).set({ slug: 'moved-away' }).where(eq(schema.layouts.id, layout.id));

    expect(await isSlugReserved(harness.db, 'about-to-move')).toBe(false);
  });
});
