import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { bundledLayoutRevision } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { SYSTEM_USER_ID } from './constants.js';
import * as schema from './schema.js';
import { seedIfEmpty } from './seed.js';
import { createTestDatabase, type Harness } from './test-support/harness.js';

const BUNDLED_REVISION = bundledLayoutRevision();

/** A throwaway seed/ directory with N valid, distinctly-sized layouts. */
function writeFixtureSeed(entries: { slug: string; cols: number; title: string; tags?: string[] }[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-index-seed-test-'));
  for (const entry of entries) {
    const layoutDir = path.join(dir, entry.slug);
    fs.mkdirSync(layoutDir, { recursive: true });
    fs.writeFileSync(
      path.join(layoutDir, 'layout.json'),
      JSON.stringify({
        version: 1,
        layoutRevision: BUNDLED_REVISION,
        cols: entry.cols,
        rows: entry.cols,
        tiles: Array(entry.cols * entry.cols).fill(0),
        furniture: [],
      }),
    );
    fs.writeFileSync(
      path.join(layoutDir, 'meta.json'),
      JSON.stringify({
        title: entry.title,
        author: 'pablodelucca',
        description: `${entry.title} description`,
        tags: entry.tags ?? [],
      }),
    );
  }
  return dir;
}

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

describe('seedIfEmpty', () => {
  it('loads every layout under seed/ into an empty database', async () => {
    harness = await createTestDatabase();
    const dir = writeFixtureSeed([
      { slug: 'seed-a', cols: 4, title: 'Seed A', tags: ['cosy'] },
      { slug: 'seed-b', cols: 5, title: 'Seed B' },
    ]);

    const seeded = await seedIfEmpty(harness.db, dir);
    expect(seeded).toBe(2);

    const rows = await harness.db.select().from(schema.layouts).orderBy(schema.layouts.slug);
    expect(rows.map((r) => r.slug)).toEqual(['seed-a', 'seed-b']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('attributes seed layouts to the system user, with the human credit in authorDisplay', async () => {
    harness = await createTestDatabase();
    const dir = writeFixtureSeed([{ slug: 'seed-attrib', cols: 4, title: 'Seed Attrib' }]);

    await seedIfEmpty(harness.db, dir);

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.slug, 'seed-attrib'));
    expect(row!.authorUserId).toBe(SYSTEM_USER_ID);
    expect(row!.authorDisplay).toBe('pablodelucca');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('attaches tags from meta.json', async () => {
    harness = await createTestDatabase();
    const dir = writeFixtureSeed([{ slug: 'seed-tagged', cols: 4, title: 'Seed Tagged', tags: ['cosy', 'small'] }]);

    await seedIfEmpty(harness.db, dir);

    const [layout] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.slug, 'seed-tagged'));
    const tagRows = await harness.db
      .select({ name: schema.tags.name })
      .from(schema.layoutTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.layoutTags.tagId))
      .where(eq(schema.layoutTags.layoutId, layout!.id));
    expect(tagRows.map((t) => t.name).sort()).toEqual(['cosy', 'small']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a layout.create audit entry per seeded layout', async () => {
    harness = await createTestDatabase();
    const dir = writeFixtureSeed([{ slug: 'seed-audited', cols: 4, title: 'Seed Audited' }]);

    await seedIfEmpty(harness.db, dir);

    const [layout] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.slug, 'seed-audited'));
    const [action] = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, layout!.id));
    expect(action?.action).toBe('layout.create');
    expect(action?.actorLabel).toBe('seed');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent — does nothing when any layout already exists', async () => {
    harness = await createTestDatabase();
    const dir = writeFixtureSeed([{ slug: 'seed-once', cols: 4, title: 'Seed Once' }]);

    const first = await seedIfEmpty(harness.db, dir);
    expect(first).toBe(1);

    // Re-running (the entrypoint runs this on every boot, not just the
    // first) must not duplicate anything, even against the same directory.
    const second = await seedIfEmpty(harness.db, dir);
    expect(second).toBe(0);

    const rows = await harness.db.select().from(schema.layouts);
    expect(rows.length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when the database already has a layout from somewhere else', async () => {
    harness = await createTestDatabase();
    await harness.db.insert(schema.layouts).values({
      slug: 'not-from-seed',
      title: 'Not From Seed',
      authorUserId: SYSTEM_USER_ID,
      raw: '{}',
      layout: {},
      sha256: 'a'.repeat(64),
      cols: 1,
      rows: 1,
    });
    const dir = writeFixtureSeed([{ slug: 'seed-c', cols: 4, title: 'Seed C' }]);

    const seeded = await seedIfEmpty(harness.db, dir);
    expect(seeded).toBe(0);
    const rows = await harness.db.select().from(schema.layouts);
    expect(rows.map((r) => r.slug)).toEqual(['not-from-seed']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a seed layout that would fail real submission validation, rather than silently publishing it', async () => {
    harness = await createTestDatabase();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-index-seed-bad-'));
    fs.mkdirSync(path.join(dir, 'broken'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'broken', 'layout.json'),
      JSON.stringify({ version: 1, layoutRevision: BUNDLED_REVISION, cols: 4, rows: 4, tiles: [0, 0], furniture: [] }),
    );
    fs.writeFileSync(
      path.join(dir, 'broken', 'meta.json'),
      JSON.stringify({ title: 'Broken', author: 'pablodelucca', description: '', tags: [] }),
    );

    await expect(seedIfEmpty(harness.db, dir)).rejects.toThrow(/fails validation/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is a clean no-op when the directory does not exist', async () => {
    harness = await createTestDatabase();
    const seeded = await seedIfEmpty(harness.db, '/does/not/exist');
    expect(seeded).toBe(0);
  });
});
