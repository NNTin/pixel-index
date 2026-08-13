import { describe, expect, it } from 'vitest';

import { InvalidLayoutError, parseInboundLayout } from './inboundLayout';

/** A layout that satisfies everything the upstream renderer assumes. */
function valid(overrides: Record<string, unknown> = {}) {
  return { version: 1, cols: 2, rows: 2, tiles: [0, 0, 0, 0], furniture: [], ...overrides };
}

describe('parseInboundLayout', () => {
  it('accepts a well-formed layout', () => {
    expect(() => parseInboundLayout(valid())).not.toThrow();
  });

  it('rejects tiles that do not fill the declared grid', () => {
    // The invariant this whole module exists for: `visibleTileBounds` indexes
    // `row * cols + col` for every cell the dimensions declare, so a short
    // array used to hand `undefined` to vendor rendering code. layout-core
    // already rejects this on submission (layout.grid.tiles_mismatch); this is
    // the preview checking the same thing at its own trust boundary.
    expect(() => parseInboundLayout(valid({ tiles: [0, 0] }))).toThrow(InvalidLayoutError);
    expect(() => parseInboundLayout(valid({ tiles: [0, 0] }))).toThrow(/carries 2 tiles/);
  });

  it('rejects dimensions that are not positive whole numbers', () => {
    for (const bad of [0, -2, 2.5, '2', null, undefined]) {
      expect(() => parseInboundLayout(valid({ cols: bad }))).toThrow(InvalidLayoutError);
      expect(() => parseInboundLayout(valid({ rows: bad }))).toThrow(InvalidLayoutError);
    }
  });

  it('rejects a payload that is not an object, or has no tiles', () => {
    for (const bad of [null, undefined, 'a layout', 42]) {
      expect(() => parseInboundLayout(bad)).toThrow(InvalidLayoutError);
    }
    expect(() => parseInboundLayout(valid({ tiles: undefined }))).toThrow(/no tiles/);
  });

  it('accepts a layout whose version is absent or not 1', () => {
    // The upstream type declares `version: 1` as a literal. Inbound JSON is
    // under no such obligation, and refusing to render it would be a
    // regression — only the colour migration is version-gated.
    expect(() => parseInboundLayout(valid({ version: undefined }))).not.toThrow();
    expect(() => parseInboundLayout(valid({ version: 2 }))).not.toThrow();
  });

  it('migrates colours for a version 1 layout, and leaves others alone', () => {
    // migrateLayoutColors normalises legacy per-tile colours; a v1 document is
    // exactly what it expects to be handed.
    const migrated = parseInboundLayout(valid({ tileColors: [null, null, null, null] }));
    expect(migrated.cols).toBe(2);

    const untouched = valid({ version: 2 });
    expect(parseInboundLayout(untouched)).toBe(untouched);
  });
});
