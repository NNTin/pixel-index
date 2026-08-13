/**
 * Pure layout math for `Masonry.tsx`, split out for the same reason as
 * `facts.ts`/`FactsRow.tsx`: a module exporting both a component and plain
 * functions can't hot-replace (react-refresh/only-export-components), and
 * these functions are worth unit-testing without a DOM.
 */

export interface MasonryPosition {
  top: number;
  left: number;
}

export interface MasonryLayoutResult {
  positions: Map<string, MasonryPosition>;
  height: number;
}

/**
 * As many fixed-width cards (plus one gap each) as fit in `containerWidth`,
 * never fewer than one column.
 */
export function computeColumnCount(containerWidth: number, cardWidth: number, gap: number): number {
  if (containerWidth <= 0) return 1;
  return Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
}

/**
 * Greedy shortest-column placement, walking `keys` in source order — true
 * masonry rather than `columns: N`'s newspaper z-order (see PR description
 * for why that was ruled out).
 *
 * An item not yet in `heights` (its card hasn't reported a measured height
 * yet) uses `fallbackHeight` for this pass; the layout is recomputed once the
 * real height arrives. Deterministic given the same keys/heights/columnCount,
 * so appending keys to the end never moves an already-placed item — which is
 * what makes "Load more" append instead of reshuffling the whole gallery.
 */
export function layoutMasonry(
  keys: readonly string[],
  heights: ReadonlyMap<string, number>,
  columnCount: number,
  cardWidth: number,
  gap: number,
  fallbackHeight: number,
): MasonryLayoutResult {
  const columns = Math.max(1, columnCount);
  const columnHeights: number[] = new Array<number>(columns).fill(0);
  const positions = new Map<string, MasonryPosition>();

  for (const key of keys) {
    let shortestIndex = 0;
    let shortestHeight = columnHeights[0] ?? 0;
    for (let col = 1; col < columns; col += 1) {
      const candidate = columnHeights[col] ?? 0;
      if (candidate < shortestHeight) {
        shortestHeight = candidate;
        shortestIndex = col;
      }
    }
    positions.set(key, { top: shortestHeight, left: shortestIndex * (cardWidth + gap) });
    columnHeights[shortestIndex] = shortestHeight + (heights.get(key) ?? fallbackHeight) + gap;
  }

  const tallest = columnHeights.reduce((max, h) => Math.max(max, h), 0);
  return { positions, height: Math.max(0, tallest - gap) };
}
