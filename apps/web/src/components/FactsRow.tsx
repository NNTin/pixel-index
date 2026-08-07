import type { LayoutSummary } from '../api/types';

/** `25×22`, `59 furniture`, `4 areas`, `2 pets` — carried over from `tools/build-site.mjs`. */
export function factsFor(layout: Pick<LayoutSummary, 'cols' | 'rows' | 'furniture' | 'areas' | 'pets'>): string[] {
  return [
    `${layout.cols}×${layout.rows}`,
    `${layout.furniture} furniture`,
    layout.areas > 0 ? `${layout.areas} areas` : null,
    layout.pets > 0 ? `${layout.pets} pets` : null,
  ].filter((fact): fact is string => fact !== null);
}

export function FactsRow({ facts }: { facts: string[] }) {
  return (
    <p className="m-0 flex flex-wrap gap-1.5">
      {facts.map((fact) => (
        <span key={fact} className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {fact}
        </span>
      ))}
    </p>
  );
}
