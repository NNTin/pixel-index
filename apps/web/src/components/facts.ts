import type { LayoutSummary } from '../api/types';

/**
 * `25×22`, `59 furniture`, `4 areas`, `2 pets`, `20 seats` — carried over
 * from `tools/build-site.mjs` (seats added for #48).
 *
 * The size shown is `visibleCols`×`visibleRows` (the occupied footprint), not
 * `cols`×`rows` (the declared canvas) — several bundled seeds share a canvas
 * allocation despite being wildly different visual sizes, which is what a
 * viewer actually compares two layouts by (#55).
 *
 * Beside `FactsRow` rather than inside it: a module that exports both a
 * component and a plain function cannot be hot-replaced in place
 * (react-refresh/only-export-components).
 */
export function factsFor(
  layout: Pick<LayoutSummary, 'visibleCols' | 'visibleRows' | 'furniture' | 'areas' | 'pets' | 'seats'>,
): string[] {
  return [
    `${layout.visibleCols}×${layout.visibleRows}`,
    `${layout.furniture} furniture`,
    layout.areas > 0 ? `${layout.areas} areas` : null,
    layout.pets > 0 ? `${layout.pets} pets` : null,
    layout.seats > 0 ? `${layout.seats} seats` : null,
  ].filter((fact): fact is string => fact !== null);
}
