/**
 * The candidate-preview manifest — how a vendor-update PR gets to show the
 * *new* pictures.
 *
 * The problem it solves: the web app's preview deployment for a vendor-update
 * PR still calls the production API, whose renderer runs the **old** pin. So
 * without this, a reviewer opening the preview of a Pixel Agents bump sees
 * thumbnails drawn by exactly the vendor the PR is replacing — the one view
 * where seeing the difference matters most is the one view that cannot show it.
 *
 * The fix costs almost nothing because the gate has already rendered every
 * layout against the candidate pin to produce its verdict. Those PNGs are the
 * missing pictures; this file is the index that points the web app at them.
 *
 * The manifest is deliberately self-disarming — see `apps/web/src/api/previewSource.ts`
 * for the rule. It carries the candidate commit, so once the PR merges and the
 * API redeploys onto that same pin, the override stops applying on its own
 * rather than needing a cleanup commit nobody would remember to make.
 */

import type { PinRun, Verdict } from './types.js';

export interface PreviewManifest {
  /** ISO timestamp, so a stale manifest is obvious to a human reading it. */
  generatedAt: string;
  candidate: { commit: string | null; version: string | null };
  baseline: { commit: string | null; version: string | null };
  /** Absolute, with a trailing slash. Each layout's `file` is resolved against it. */
  baseUrl: string;
  /**
   * The upstream repository, so the page can link a pin to the commit it names.
   * From `.gitmodules` rather than written in, so a fork linking at its own
   * upstream points there. `null` when it could not be read — the page then
   * shows the short sha as plain text rather than a link to nowhere.
   */
  upstreamUrl: string | null;
  /** How many layouts render differently under the candidate, in total. */
  changed: number;
  /** How many fail under the candidate, in total. */
  failed: number;
  /** How many of those `layouts` describes. Never more than `cap`. */
  shown: number;
  cap: number;
  layouts: Record<string, { file: string } | { failed: string }>;
}

/**
 * How many layouts one manifest may describe.
 *
 * The number is not the interesting part; the fact that there *is* one is.
 * A palette change upstream alters every layout at once, and the 51st example
 * of the same recoloured chair teaches a reviewer nothing the 5th did — so the
 * published set is bounded by what is worth looking at rather than by how big
 * the index happens to be. That is what stops this from being something to
 * revisit at 1,000 layouts, and then again at 10,000.
 */
export const PUBLISH_CAP = 50;

/**
 * Which layouts the preview page needs pictures for — and, deliberately, which
 * it does not.
 *
 * **A layout that renders identically under both pins needs nothing published.**
 * Renders are deterministic: same layout plus same pin gives the same PNG on any
 * machine (`upstream.test.ts`, and measured across CI, the deployed renderer and
 * a laptop). So when the candidate draws a layout exactly as the baseline did,
 * the image the API is already serving *is* the candidate's render. Publishing a
 * copy of it would be duplicating a file the page can already fetch, for every
 * layout in the index, every week.
 *
 * What is left is small and stays small: the layouts that changed, and the ones
 * that broke. Usually that is nothing at all.
 */
export function buildPreviewManifest(options: {
  baseline: PinRun;
  candidate: PinRun;
  verdict: Verdict;
  baseUrl: string;
  upstreamUrl?: string | null;
  cap?: number;
}): PreviewManifest {
  const { baseline, candidate, verdict, baseUrl, upstreamUrl = null, cap = PUBLISH_CAP } = options;

  const layouts: PreviewManifest['layouts'] = {};
  let shown = 0;

  // Failures first. A layout the candidate cannot draw is the more urgent thing
  // to see, and it costs no bytes — there is no image, only a marker. It must
  // never fall through to the API's picture: showing the old pin's render where
  // the new one draws nothing is precisely the lie this exists to prevent.
  for (const regression of verdict.regressions) {
    if (shown >= cap) break;
    layouts[regression.slug] = { failed: regression.kind };
    shown += 1;
  }

  // Then whatever room is left goes to layouts that still render but differently
  // — the thing validation cannot see, and the only reason to look at pictures.
  for (const slug of verdict.visuallyChanged) {
    if (shown >= cap) break;
    layouts[slug] = { file: `${slug}.png` };
    shown += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    candidate: { commit: candidate.pin.commit, version: candidate.pin.version },
    baseline: { commit: baseline.pin.commit, version: baseline.pin.version },
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    upstreamUrl: upstreamUrl === null ? null : upstreamUrl.replace(/\/$/, ''),
    // The totals are the whole population, not the sample: the page has to be
    // able to say "800 changed, here are 50" rather than quietly implying 50.
    changed: verdict.visuallyChanged.length,
    failed: verdict.regressions.length,
    shown,
    cap,
    layouts,
  };
}
