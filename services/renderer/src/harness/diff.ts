/**
 * Baseline vs candidate — the differential that makes this gate trustworthy.
 *
 * The question a vendor-update PR asks is not "is this layout broken?" but
 * "did **this update** break it?". Those differ constantly: an index of real,
 * user-submitted layouts always contains a few that were already failing, and a
 * gate that reports them would be permanently red for reasons the update did
 * not cause and merging it would not fix. So only a layout that **passed on the
 * baseline pin and fails on the candidate** counts against the update.
 *
 * The same comparison gives a second answer almost free: layouts that render
 * on both pins but produce *different pixels*. That is not a failure, but on a
 * vendor bump it is the single most useful thing a reviewer can be told,
 * because it is exactly what validation cannot see.
 */

import type { LayoutOutcome, PinRun, Regression, Verdict } from './types.js';

/**
 * Above this many layouts, "systemic" is a proportion; at or below it, any
 * regression is systemic.
 *
 * A percentage is meaningless on a handful of layouts — one failure out of four
 * is 25%, which would trip any threshold worth having, so expressing it as a
 * proportion just obscures the actual rule. On the seed corpus the rule is
 * simply "nothing may regress", which is what the hermetic gate is for.
 */
export const SMALL_CORPUS = 10;

/** A tenth of the index failing is the update's problem, not the layouts'. */
export const SYSTEMIC_FRACTION = 0.1;

/** …and an absolute ceiling, so a large index cannot quietly lose 19 layouts. */
export const SYSTEMIC_COUNT = 20;

function isBroken(outcome: LayoutOutcome | undefined): boolean {
  return outcome !== undefined && outcome.status !== 'ok';
}

function describe(outcome: LayoutOutcome): string {
  switch (outcome.status) {
    case 'ok':
      return 'rendered';
    case 'invalid':
      // The codes are the actionable part (`layout.furniture.unknown` tells a
      // maintainer exactly what upstream removed), so lead with them.
      return outcome.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    case 'render_failed':
      return `${outcome.kind}: ${outcome.message}`;
  }
}

export function diffRuns(baseline: PinRun, candidate: PinRun): Verdict {
  const regressions: Regression[] = [];
  const visuallyChanged: string[] = [];
  const alreadyBroken: string[] = [];
  let comparable = 0;

  for (const [slug, before] of Object.entries(baseline.outcomes)) {
    const after = candidate.outcomes[slug];
    // Present in the baseline but not the candidate means the index changed
    // under us mid-run. Not comparable, and not something to blame the vendor
    // for either.
    if (after === undefined) continue;
    comparable += 1;

    if (isBroken(before)) {
      // Broken before, broken after — pre-existing. Broken before, fine after —
      // the update FIXED it, which is worth nothing but a mention in neither
      // bucket.
      if (isBroken(after)) alreadyBroken.push(slug);
      continue;
    }

    if (isBroken(after)) {
      regressions.push({
        slug,
        kind: after.status === 'invalid' ? 'invalid' : 'render_failed',
        detail: describe(after),
      });
      continue;
    }

    if (before.status === 'ok' && after.status === 'ok' && before.pngSha256 !== after.pngSha256) {
      visuallyChanged.push(slug);
    }
  }

  return {
    tier: tierFor(regressions.length, comparable),
    regressions,
    visuallyChanged,
    alreadyBroken,
    comparable,
  };
}

export function tierFor(regressionCount: number, comparable: number): Verdict['tier'] {
  if (regressionCount === 0) return 'pass';
  if (comparable <= SMALL_CORPUS) return 'systemic';
  if (regressionCount >= SYSTEMIC_COUNT) return 'systemic';
  if (regressionCount / comparable >= SYSTEMIC_FRACTION) return 'systemic';
  return 'regressions';
}
