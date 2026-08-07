import { describe, expect, it } from 'vitest';

import { codesOf, makeLayout } from './test-support/fixtures.js';
import { furnitureCatalog } from './upstream.js';
import { createValidator, validateLayout, validateMeta, validateSlug } from './validate.js';

const catalog = furnitureCatalog();
/** Pin the revision so these tests describe the rule, not the current submodule. */
const check = (layout: unknown, requiredRevision = 1) =>
  validateLayout(layout, { catalog, requiredRevision, upstreamVersion: '1.4.0' });

describe('validateSlug', () => {
  it.each(['blue-office', 'four-rooms', 'a', '9-to-5'])('accepts %s', (slug) => {
    expect(validateSlug(slug).valid).toBe(true);
  });

  it.each(['Blue-Office', '-leading', 'has space', 'under_score', ''])('rejects %s', (slug) => {
    const result = validateSlug(slug);
    expect(result.valid).toBe(false);
    expect(codesOf(result.issues)).toEqual(['slug.invalid']);
  });
});

describe('validateMeta', () => {
  const meta = { title: 'Four Rooms', author: 'pablodelucca', description: 'Four walled rooms.' };

  it('accepts the minimum required fields', () => {
    expect(validateMeta(meta).valid).toBe(true);
  });

  it('accepts optional tags and source', () => {
    expect(validateMeta({ ...meta, tags: ['open-plan', 'small'], source: 'https://x.dev' }).valid).toBe(
      true,
    );
  });

  it.each([
    ['missing title', { author: 'a', description: 'd' }],
    ['empty description', { ...meta, description: '' }],
    ['non-array tags', { ...meta, tags: 'open-plan' }],
    ['uppercase tag', { ...meta, tags: ['Open-Plan'] }],
    ['unknown field', { ...meta, license: 'MIT' }],
    ['non-uri source', { ...meta, source: 'not a url' }],
  ])('rejects %s', (_label, candidate) => {
    const result = validateMeta(candidate);
    expect(result.valid).toBe(false);
    expect(codesOf(result.issues)).toContain('meta.schema');
  });

  it('rejects a non-object without throwing', () => {
    expect(codesOf(validateMeta('nope').issues)).toEqual(['meta.invalid_json']);
    expect(codesOf(validateMeta(null).issues)).toEqual(['meta.invalid_json']);
  });
});

describe('validateLayout — structure', () => {
  it('accepts a minimal well-formed layout', () => {
    expect(check(makeLayout()).valid).toBe(true);
  });

  it('rejects an unsupported version', () => {
    expect(codesOf(check(makeLayout({ version: 2 })).issues)).toContain('layout.schema');
  });

  it('rejects a tiles array that does not match cols * rows', () => {
    const result = check(makeLayout({ cols: 3, rows: 3, tiles: [0, 0, 0, 0] }));
    expect(codesOf(result.issues)).toContain('layout.grid.tiles_mismatch');
    expect(result.issues[0]?.message).toMatch(/expected cols \* rows = 9/);
  });

  it('rejects tileColors that do not line up with tiles', () => {
    const result = check(makeLayout({ tileColors: [null, null] }));
    expect(codesOf(result.issues)).toContain('layout.grid.tile_colors_mismatch');
  });

  it('reports a JSON Pointer for each issue', () => {
    const result = check(makeLayout({ cols: 3, tiles: [0, 0, 0, 0] }));
    expect(result.issues.some((issue) => issue.path === '/tiles')).toBe(true);
  });

  it('rejects a non-object without throwing', () => {
    expect(codesOf(check('nope').issues)).toEqual(['layout.invalid_json']);
  });
});

/**
 * The rule that silently eats layouts. Pixel Agents discards a stored layout
 * whose revision is below the bundled default's and resets to the default
 * (server/src/layoutPersistence.ts), so publishing below it means the layout
 * vanishes from the user's office on next start. It is an error, never a
 * warning. If this check is ever removed, these fail.
 */
describe('validateLayout — the layoutRevision rule', () => {
  it('rejects a layout below the bundled revision', () => {
    const result = check(makeLayout({ layoutRevision: 0 }), 1);
    expect(result.valid).toBe(false);
    expect(codesOf(result.issues)).toContain('layout.revision.below_bundled');
  });

  it('explains why, rather than just refusing', () => {
    const [issue] = check(makeLayout({ layoutRevision: 2 }), 5).issues;
    expect(issue?.message).toMatch(/would be discarded on the next start/);
    expect(issue?.message).toMatch(/Re-export it/);
    expect(issue?.path).toBe('/layoutRevision');
  });

  it('treats a missing layoutRevision as 0', () => {
    const result = check(makeLayout({ layoutRevision: undefined }), 1);
    expect(codesOf(result.issues)).toContain('layout.revision.below_bundled');
  });

  it('accepts equal to the bundled revision', () => {
    expect(check(makeLayout({ layoutRevision: 1 }), 1).valid).toBe(true);
  });

  it('accepts ahead of the bundled revision — newer is not broken', () => {
    expect(check(makeLayout({ layoutRevision: 9 }), 1).valid).toBe(true);
  });
});

describe('validateLayout — furniture', () => {
  it('rejects ids the pinned upstream cannot draw', () => {
    const result = check(
      makeLayout({ furniture: [{ type: 'NOT_A_REAL_THING', col: 0, row: 0 }] }),
    );
    expect(codesOf(result.issues)).toContain('layout.furniture.unknown');
    expect(result.issues[0]?.message).toMatch(/pixel-agents 1\.4\.0/);
  });

  it('accepts the virtual :left ids', () => {
    // PC_SIDE:left exists only because upstream synthesises it for mirrorSide
    // assets. A catalog that misses it reports this valid layout as unknown.
    const result = check(makeLayout({ furniture: [{ type: 'PC_SIDE:left', col: 0, row: 0 }] }));
    expect(result.valid).toBe(true);
  });

  it('accepts wall furniture at a negative row', () => {
    // Wall-mounted furniture is anchored by its BOTTOM row
    // (getWallPlacementRow: row - (footprintH - 1)), so CLOCK (footprintH 2) on
    // the top wall legitimately sits at row -1. This is a real placement in the
    // published four-rooms layout.
    const result = check(
      makeLayout({ cols: 8, rows: 8, tiles: Array(64).fill(0), furniture: [{ type: 'CLOCK', col: 1, row: -1 }] }),
    );
    expect(result.valid).toBe(true);
  });

  it('still rejects wall furniture above its own footprint', () => {
    // CLOCK is 2 tall, so -1 is the limit and -2 is off the grid.
    const result = check(
      makeLayout({ cols: 8, rows: 8, tiles: Array(64).fill(0), furniture: [{ type: 'CLOCK', col: 1, row: -2 }] }),
    );
    expect(codesOf(result.issues)).toContain('layout.furniture.out_of_bounds');
  });

  it('rejects a negative row for furniture that cannot go on walls', () => {
    const result = check(
      makeLayout({ cols: 8, rows: 8, tiles: Array(64).fill(0), furniture: [{ type: 'TABLE_FRONT', col: 1, row: -1 }] }),
    );
    expect(codesOf(result.issues)).toContain('layout.furniture.out_of_bounds');
  });

  it('rejects furniture past the right and bottom edges', () => {
    const result = check(makeLayout({ furniture: [{ type: 'TABLE_FRONT', col: 2, row: 0 }] }));
    expect(codesOf(result.issues)).toContain('layout.furniture.out_of_bounds');
  });

  it('truncates a long list of misplaced items but says how many were hidden', () => {
    const furniture = Array.from({ length: 9 }, (_, i) => ({
      type: 'TABLE_FRONT',
      col: 50 + i,
      row: 0,
    }));
    const [issue] = check(makeLayout({ furniture })).issues;
    expect(issue?.message).toMatch(/\+4 more/);
  });
});

describe('createValidator', () => {
  it('exposes the upstream facts it loaded once', () => {
    const validator = createValidator();
    expect(validator.catalog.size).toBeGreaterThan(0);
    expect(Number.isInteger(validator.requiredRevision)).toBe(true);
  });

  it('validates without re-reading the catalog per call', () => {
    const validator = createValidator();
    expect(validator.validateLayout(makeLayout({ layoutRevision: 99 })).valid).toBe(true);
    expect(validator.validateSlug('ok-slug').valid).toBe(true);
  });
});
