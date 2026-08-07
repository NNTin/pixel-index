import { SLUG_RE } from '@pixel-index/layout-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertLayout } from '../test-support/layouts.js';
import { generateUniqueSlug, slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My Cool Office')).toBe('my-cool-office');
  });

  it('collapses runs of non-alphanumeric characters to one hyphen', () => {
    expect(slugify('Office!!  --  ##2000')).toBe('office-2000');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -Office- ')).toBe('office');
  });

  it('strips accents rather than dropping the letters entirely', () => {
    expect(slugify('Café Office')).toBe('cafe-office');
  });

  it('truncates to 60 characters without leaving a trailing hyphen', () => {
    const long = 'a'.repeat(70);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('-')).toBe(false);
  });

  it('falls back to a generic base when nothing ASCII-alphanumeric survives', () => {
    expect(slugify('日本語')).toBe('layout');
    expect(slugify('🎉🎊')).toBe('layout');
    expect(slugify('')).toBe('layout');
  });

  it.each([
    'My Cool Office',
    'Office!!  --  ##2000',
    '  -Office- ',
    'Café Office',
    'a'.repeat(70),
    '日本語',
    '🎉🎊',
    '',
    '---',
    '123',
  ])('always produces something the database check constraint accepts: %s', (title) => {
    expect(slugify(title)).toMatch(SLUG_RE);
  });
});

describe('generateUniqueSlug', () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await createTestDatabase();
  });
  afterAll(async () => harness.close());

  it('uses the bare slug when it is free', async () => {
    expect(await generateUniqueSlug(harness.db, 'Totally Unique Title')).toBe(
      'totally-unique-title',
    );
  });

  it('appends -2, then -3, as the base and each numbered variant get taken', async () => {
    await insertLayout(harness.db, { slug: 'collision-title' });
    expect(await generateUniqueSlug(harness.db, 'Collision Title')).toBe('collision-title-2');

    await insertLayout(harness.db, { slug: 'collision-title-2' });
    expect(await generateUniqueSlug(harness.db, 'Collision Title')).toBe('collision-title-3');
  });

  it('does not get confused by a numbered slug existing without its base', async () => {
    // Base is free even though "-3" is taken; nothing requires -2 to exist too.
    await insertLayout(harness.db, { slug: 'sparse-collision-3' });
    expect(await generateUniqueSlug(harness.db, 'Sparse Collision')).toBe('sparse-collision');
  });

  it('considers a REMOVED layout\'s slug just as taken as a public one', async () => {
    // The unique index has no visibility filter (schema.ts) — a moderator
    // removal still reserves the slug forever, and slug generation has to
    // agree or it would produce a slug the database then rejects on insert.
    await insertLayout(harness.db, { slug: 'moderated-away', visibility: 'removed' });
    expect(await generateUniqueSlug(harness.db, 'Moderated Away')).toBe('moderated-away-2');
  });
});
