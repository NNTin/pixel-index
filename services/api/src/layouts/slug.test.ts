import { randomBytes } from 'node:crypto';

import { SLUG_RE } from '@pixel-index/layout-core';
import { afterAll, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertLayout } from '../test-support/layouts.js';
import { generateUniqueSlug } from './slug.js';

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
    // The unique index has no visibility filter (schema.ts) — a moderator
    // removal still reserves the slug forever, and random generation has to
    // agree or it would hand out a slug the database then rejects on insert.
    await insertLayout(harness.db, { slug: 'ccccccccc1', visibility: 'removed' });
    mockedRandomBytes
      .mockReturnValueOnce(Buffer.from('ccccccccc1', 'hex'))
      .mockReturnValueOnce(Buffer.from('dddddddddd', 'hex'));

    expect(await generateUniqueSlug(harness.db)).toBe('dddddddddd');
  });

  it('considers a retired (renamed-away) slug just as taken, even though no layout holds it now', async () => {
    const owner = await insertLayout(harness.db, { slug: 'still-current-slug' });
    await harness.db.insert(schema.retiredSlugs).values({ slug: 'ffffffffff', layoutId: owner.id });
    mockedRandomBytes
      .mockReturnValueOnce(Buffer.from('ffffffffff', 'hex'))
      .mockReturnValueOnce(Buffer.from('1111111111', 'hex'));

    expect(await generateUniqueSlug(harness.db)).toBe('1111111111');
  });

  it('gives up after repeated collisions rather than looping forever', async () => {
    await insertLayout(harness.db, { slug: 'eeeeeeeeee' });
    mockedRandomBytes.mockReturnValue(Buffer.from('eeeeeeeeee', 'hex'));

    await expect(generateUniqueSlug(harness.db)).rejects.toThrow(
      'Could not generate a unique slug after multiple attempts.',
    );
  });
});
