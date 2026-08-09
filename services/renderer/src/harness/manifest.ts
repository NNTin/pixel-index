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

import type { PinRun } from './types.js';

export interface PreviewManifest {
  /** ISO timestamp, so a stale manifest is obvious to a human reading it. */
  generatedAt: string;
  candidate: { commit: string | null; version: string | null };
  baseline: { commit: string | null; version: string | null };
  /** Absolute, with a trailing slash. Each layout's `file` is resolved against it. */
  baseUrl: string;
  layouts: Record<string, { file: string } | { failed: string }>;
}

export function buildPreviewManifest(options: {
  baseline: PinRun;
  candidate: PinRun;
  baseUrl: string;
}): PreviewManifest {
  const { baseline, candidate, baseUrl } = options;

  const layouts: PreviewManifest['layouts'] = {};
  for (const [slug, outcome] of Object.entries(candidate.outcomes)) {
    layouts[slug] =
      outcome.status === 'ok'
        ? { file: `${slug}.png` }
        : // A layout that fails on the candidate must NOT fall back to the
          // API's stale image. Showing the old picture where the new pin draws
          // nothing is precisely the lie this whole mechanism exists to stop —
          // the web app renders a "fails on candidate" placeholder instead.
          { failed: outcome.status };
  }

  return {
    generatedAt: new Date().toISOString(),
    candidate: { commit: candidate.pin.commit, version: candidate.pin.version },
    baseline: { commit: baseline.pin.commit, version: baseline.pin.version },
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    layouts,
  };
}
