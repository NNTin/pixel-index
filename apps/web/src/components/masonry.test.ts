import { describe, expect, it } from 'vitest';

import { computeColumnCount, layoutMasonry } from './masonry';

describe('computeColumnCount', () => {
  it('fits as many fixed-width cards (plus a trailing gap) as the container allows', () => {
    // 3 cards of 280 + 2 internal gaps of 24 = 888; a 4th needs 1192.
    expect(computeColumnCount(900, 280, 24)).toBe(3);
    expect(computeColumnCount(1192, 280, 24)).toBe(4);
  });

  it('reduces columns, not card width, as the container shrinks', () => {
    // A 2nd column needs 280*2 + 24 = 584: below that, one column; at or above, two.
    expect(computeColumnCount(300, 280, 24)).toBe(1);
    expect(computeColumnCount(583, 280, 24)).toBe(1);
    expect(computeColumnCount(584, 280, 24)).toBe(2);
  });

  it('never returns fewer than one column, even for a container narrower than one card', () => {
    expect(computeColumnCount(50, 280, 24)).toBe(1);
    expect(computeColumnCount(0, 280, 24)).toBe(1);
    expect(computeColumnCount(-10, 280, 24)).toBe(1);
  });
});

describe('layoutMasonry', () => {
  it('places each item in the shortest column so far, not row by row', () => {
    // 2 columns. Item A (tall) -> col 0. Item B (short) -> col 1 (0 < A's height).
    // Item C then goes to col 1 again, since B's column is still shorter than A's,
    // even though a row-based layout would have put C back in col 0.
    const heights = new Map([
      ['a', 500],
      ['b', 50],
      ['c', 100],
    ]);
    const { positions } = layoutMasonry(['a', 'b', 'c'], heights, 2, 280, 24, 360);

    expect(positions.get('a')).toEqual({ top: 0, left: 0 });
    expect(positions.get('b')).toEqual({ top: 0, left: 304 }); // 280 + 24 gap
    expect(positions.get('c')).toEqual({ top: 74, left: 304 }); // 50 + 24 gap, same column as b
  });

  it('breaks ties by the lowest column index', () => {
    const { positions } = layoutMasonry(['a', 'b', 'c'], new Map(), 2, 280, 24, 100);
    expect(positions.get('a')).toEqual({ top: 0, left: 0 });
    expect(positions.get('b')).toEqual({ top: 0, left: 304 });
    // Both columns are now equally tall (100 + 24 each) — ties go to column 0.
    expect(positions.get('c')).toEqual({ top: 124, left: 0 });
  });

  it('uses the fallback height for an item not yet measured', () => {
    const { positions, height } = layoutMasonry(['a'], new Map(), 1, 280, 24, 360);
    expect(positions.get('a')).toEqual({ top: 0, left: 0 });
    expect(height).toBe(360); // fallback height, no trailing gap
  });

  it('computes container height as the tallest column, minus the trailing gap', () => {
    const heights = new Map([
      ['a', 500],
      ['b', 50],
    ]);
    const { height } = layoutMasonry(['a', 'b'], heights, 2, 280, 24, 100);
    expect(height).toBe(500); // column a: 500 + 24 gap - 24 trailing = 500
  });

  it('never moves an already-placed item when new keys are appended (Load more)', () => {
    const heights = new Map([
      ['a', 500],
      ['b', 50],
      ['c', 100],
    ]);
    const before = layoutMasonry(['a', 'b'], heights, 2, 280, 24, 360);
    const after = layoutMasonry(['a', 'b', 'c'], heights, 2, 280, 24, 360);

    expect(after.positions.get('a')).toEqual(before.positions.get('a'));
    expect(after.positions.get('b')).toEqual(before.positions.get('b'));
    // The new item flows into whichever column is shortest at append time.
    expect(after.positions.get('c')).toEqual({ top: 74, left: 304 });
  });
});
