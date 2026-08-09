import { describe, expect, it } from 'vitest';

import { renderPullRequestBody, renderReport, verdictHeadline } from './report.js';
import type { PinRun, Verdict } from './types.js';

const run = (commit: string, version = '1.4.0'): PinRun => ({
  pin: { version, commit, layoutRevision: 1 },
  source: 'seed/',
  outcomes: {},
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
});

const verdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  tier: 'pass',
  regressions: [],
  visuallyChanged: [],
  alreadyBroken: [],
  comparable: 4,
  ...overrides,
});

describe('renderReport', () => {
  it('names the slug and the issue code, not just a count', () => {
    // A red check saying "1 failed" gets ignored; one naming the layout and
    // what upstream removed gets acted on.
    const report = renderReport({
      baseline: run('a'.repeat(40)),
      candidate: run('b'.repeat(40)),
      gate: 'Seed gate',
      verdict: verdict({
        tier: 'systemic',
        regressions: [
          { slug: 'four-rooms', kind: 'invalid', detail: 'layout.furniture.unknown: PLANT_TALL' },
        ],
      }),
    });

    expect(report).toContain('four-rooms');
    expect(report).toContain('layout.furniture.unknown');
  });

  it('escapes a pipe in a validation message so the table survives it', () => {
    const report = renderReport({
      baseline: run('a'.repeat(40)),
      candidate: run('b'.repeat(40)),
      gate: 'Seed gate',
      verdict: verdict({
        tier: 'regressions',
        comparable: 100,
        regressions: [{ slug: 'x', kind: 'invalid', detail: 'got a|b, wanted c' }],
      }),
    });
    expect(report).toContain('got a\\|b, wanted c');
  });

  it('presents a pixel change as information, not failure', () => {
    const report = renderReport({
      baseline: run('a'.repeat(40)),
      candidate: run('b'.repeat(40)),
      gate: 'Seed gate',
      verdict: verdict({ visuallyChanged: ['blue-office'] }),
    });
    expect(report).toContain('not a failure');
    expect(report).toContain('blue-office');
  });
});

describe('verdictHeadline', () => {
  it('distinguishes a minority regression from a breaking change', () => {
    expect(verdictHeadline(verdict({ tier: 'regressions', regressions: [] }), 'G')).toContain('⚠️');
    expect(verdictHeadline(verdict({ tier: 'systemic' }), 'G')).toContain('breaking');
    expect(verdictHeadline(verdict(), 'G')).toContain('✅');
  });
});

describe('renderPullRequestBody', () => {
  const base = {
    baselineCommit: 'a'.repeat(40),
    candidateCommit: 'b'.repeat(40),
    repoUrl: 'https://github.com/pixel-agents-hq/pixel-agents',
  };

  it('separates sections with a blank line so a heading stays a heading', () => {
    // Sections arrive trimmed, so without this a `###` lands directly under a
    // table row — which CommonMark does not treat as a heading at all.
    const body = renderPullRequestBody({
      ...base,
      sections: ['| a | b |\n| --- | --- |\n| 1 | 2 |', '### Second'],
    });
    expect(body).toContain('| 1 | 2 |\n\n### Second');
  });

  it('mentions the candidate previews only when there are any', () => {
    const withPreview = renderPullRequestBody({
      ...base,
      sections: [],
      previewUrl: 'https://renders.example.com/bbb',
    });
    expect(withPreview).toContain('rendered against the candidate pin');

    expect(renderPullRequestBody({ ...base, sections: [] })).not.toContain(
      'rendered against the candidate pin',
    );
  });

  it('links the upstream commit range a reviewer is actually merging', () => {
    const body = renderPullRequestBody({ ...base, sections: [] });
    expect(body).toContain(`${base.repoUrl}/compare/${base.baselineCommit}...${base.candidateCommit}`);
  });
});
