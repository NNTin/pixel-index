/**
 * The markdown the PR body and the job summary are made of.
 *
 * A check that says "1 test failed" on a robot's pull request gets ignored
 * within a month. A check that names the slug and the issue code gets read, so
 * everything here is organised around naming things: which layouts regressed,
 * why, and what the reviewer is being asked to decide.
 */

import type { PinRun, Verdict } from './types.js';

/** Enough rows to be actionable; past this the PR body stops being readable. */
const MAX_LISTED = 25;

function shortSha(commit: string | null): string {
  return commit ? commit.slice(0, 7) : 'unknown';
}

function pinLabel(run: PinRun): string {
  const version = run.pin.version ? `${run.pin.version} ` : '';
  return `${version}(${shortSha(run.pin.commit)}), layoutRevision ${run.pin.layoutRevision}`;
}

export interface ReportInput {
  baseline: PinRun;
  candidate: PinRun;
  verdict: Verdict;
  /** e.g. "seed" / "live index" — what the reader should think this covers. */
  gate: string;
}

export function verdictHeadline(verdict: Verdict, gate: string): string {
  switch (verdict.tier) {
    case 'pass':
      return `✅ ${gate}: no layout that rendered before fails now (${verdict.comparable} checked).`;
    case 'regressions':
      return `⚠️ ${gate}: ${verdict.regressions.length} of ${verdict.comparable} layouts regressed.`;
    case 'systemic':
      return `❌ ${gate}: ${verdict.regressions.length} of ${verdict.comparable} layouts regressed — this looks like a breaking upstream change.`;
  }
}

export function renderReport({ baseline, candidate, verdict, gate }: ReportInput): string {
  const lines: string[] = [];

  lines.push(`### ${verdictHeadline(verdict, gate)}`, '');
  lines.push(`| | Pixel Agents |`, `| --- | --- |`);
  lines.push(`| Baseline | ${pinLabel(baseline)} |`);
  lines.push(`| Candidate | ${pinLabel(candidate)} |`);
  lines.push(`| Layouts | ${verdict.comparable}, from ${candidate.source} |`, '');

  if (verdict.regressions.length > 0) {
    lines.push(`#### Broken by this update`, '');
    lines.push(`| Layout | Kind | Why |`, `| --- | --- | --- |`);
    for (const regression of verdict.regressions.slice(0, MAX_LISTED)) {
      // Pipes inside a validation message would otherwise tear the table apart.
      const detail = regression.detail.replace(/\|/g, '\\|').slice(0, 300);
      lines.push(`| \`${regression.slug}\` | ${regression.kind} | ${detail} |`);
    }
    if (verdict.regressions.length > MAX_LISTED) {
      lines.push(`| … | | ${verdict.regressions.length - MAX_LISTED} more — see the job log |`);
    }
    lines.push('');
  }

  if (verdict.visuallyChanged.length > 0) {
    lines.push(
      `#### Renders differently (not a failure)`,
      '',
      `${verdict.visuallyChanged.length} layout(s) still render but produce different pixels. ` +
        `This is what validation cannot see, so it is worth a look at the preview:`,
      '',
      verdict.visuallyChanged
        .slice(0, MAX_LISTED)
        .map((slug) => `\`${slug}\``)
        .join(', ') + (verdict.visuallyChanged.length > MAX_LISTED ? ', …' : ''),
      '',
    );
  }

  if (verdict.alreadyBroken.length > 0) {
    lines.push(
      `<details><summary>${verdict.alreadyBroken.length} layout(s) were already broken before this update</summary>`,
      '',
      `Not caused by this bump and not counted against it.`,
      '',
      verdict.alreadyBroken.map((slug) => `- \`${slug}\``).join('\n'),
      '',
      `</details>`,
      '',
    );
  }

  return lines.join('\n');
}

/**
 * The PR body. Deliberately regenerated whole on every run rather than appended
 * to: upstream can move several times before anyone merges, and a body that
 * accumulates four stale reports is a body nobody reads.
 */
export function renderPullRequestBody(options: {
  baselineCommit: string;
  candidateCommit: string;
  repoUrl: string;
  sections: string[];
  previewUrl?: string;
}): string {
  const { baselineCommit, candidateCommit, repoUrl, sections, previewUrl } = options;
  const compare = `${repoUrl}/compare/${baselineCommit}...${candidateCommit}`;

  const lines = [
    `Updates the pinned \`vendor/pixel-agents\` from \`${baselineCommit.slice(0, 7)}\` to \`${candidateCommit.slice(0, 7)}\`.`,
    '',
    `[Upstream changes](${compare})`,
    '',
  ];

  if (previewUrl) {
    lines.push(
      `**Previews on this PR are rendered against the candidate pin**, not the ` +
        `production API's — see the banner on the preview deployment. ` +
        `[Manifest](${previewUrl})`,
      '',
    );
  }

  lines.push(...sections);
  lines.push(
    '',
    '---',
    '',
    '<sub>Opened by the vendor-update workflow. Re-run it to refresh this PR against a newer upstream; ' +
      'it reuses this branch rather than opening another. Merging is a human decision: a green check ' +
      'means nothing that rendered before fails now, not that the pixels are still right.</sub>',
  );

  return lines.join('\n');
}
