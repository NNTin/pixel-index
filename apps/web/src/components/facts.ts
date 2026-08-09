import type { LayoutSummary } from '../api/types';

/**
 * `25×22`, `59 furniture`, `4 areas`, `2 pets` — carried over from
 * `tools/build-site.mjs`.
 *
 * Beside `FactsRow` rather than inside it: a module that exports both a
 * component and a plain function cannot be hot-replaced in place
 * (react-refresh/only-export-components).
 */
export function factsFor(
  layout: Pick<LayoutSummary, 'cols' | 'rows' | 'furniture' | 'areas' | 'pets'>,
): string[] {
  return [
    `${layout.cols}×${layout.rows}`,
    `${layout.furniture} furniture`,
    layout.areas > 0 ? `${layout.areas} areas` : null,
    layout.pets > 0 ? `${layout.pets} pets` : null,
  ].filter((fact): fact is string => fact !== null);
}
