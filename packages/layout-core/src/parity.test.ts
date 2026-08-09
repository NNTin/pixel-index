import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { layoutStats } from './stats.js';
import type { Layout, LayoutMeta } from './types.js';
import { createValidator } from './validate.js';

/**
 * The extraction must not change what counts as valid.
 *
 * Every layout published today has to stay valid, and the two false positives
 * that were fixed once in v1 (virtual `:left` ids, wall furniture at negative
 * rows) both appear in this real data — so this doubles as the regression test
 * that the extraction preserved those fixes.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SEED_DIR = path.join(REPO_ROOT, 'seed');

const slugs = fs.existsSync(SEED_DIR)
  ? fs
      .readdirSync(SEED_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

describe('published layouts', () => {
  const validator = createValidator();

  it('finds the layouts to check', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  it.each(slugs)('%s validates clean', (slug) => {
    const dir = path.join(SEED_DIR, slug);
    // The `as` casts are the point of the suite, not a shortcut around it:
    // these files are untrusted input as far as the validator is concerned, and
    // what follows is the assertion that they really do have this shape.
    const layout = JSON.parse(
      fs.readFileSync(path.join(dir, 'layout.json'), 'utf-8'),
    ) as Layout;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as LayoutMeta;

    const layoutResult = validator.validateLayout(layout);
    const metaResult = validator.validateMeta(meta);

    // Show the actual issues on failure rather than a bare `false`.
    expect(layoutResult.issues).toEqual([]);
    expect(metaResult.issues).toEqual([]);
    expect(validator.validateSlug(slug).valid).toBe(true);
  });

  it('four-rooms still exercises the wall-furniture case', () => {
    // Guards the regression test itself: if this layout ever loses its negative
    // rows, the parity suite silently stops covering that fix.
    const layout = JSON.parse(
      fs.readFileSync(path.join(SEED_DIR, 'four-rooms/layout.json'), 'utf-8'),
    ) as Layout;
    const negative = layout.furniture.filter((item) => item.row < 0);
    expect(negative.length).toBeGreaterThan(0);
  });

  it('produces the stats the index publishes', () => {
    const layout = JSON.parse(
      fs.readFileSync(path.join(SEED_DIR, 'blue-office/layout.json'), 'utf-8'),
    ) as Layout;
    expect(layoutStats(layout)).toMatchObject({ cols: 25, rows: 22, furniture: 59, areas: 4 });
  });
});
