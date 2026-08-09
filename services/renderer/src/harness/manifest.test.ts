import { describe, expect, it } from 'vitest';

import { buildPreviewManifest, PUBLISH_CAP } from './manifest.js';
import type { PinRun, Verdict } from './types.js';

const run = (commit: string): PinRun => ({
  pin: { version: '1.4.0', commit, layoutRevision: 1 },
  source: 'the live index',
  outcomes: {},
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
});

const baseline = run('a'.repeat(40));
const candidate = run('b'.repeat(40));

const verdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  tier: 'pass',
  regressions: [],
  visuallyChanged: [],
  alreadyBroken: [],
  comparable: 1000,
  ...overrides,
});

const build = (v: Verdict, cap?: number) =>
  buildPreviewManifest({
    baseline,
    candidate,
    verdict: v,
    baseUrl: 'https://renders.example.com/bbb',
    ...(cap !== undefined ? { cap } : {}),
  });

describe('buildPreviewManifest', () => {
  it('publishes nothing when the candidate draws every layout identically', () => {
    // The normal week, and the whole reason this scales. Renders are
    // deterministic, so an unchanged layout is already being served correctly
    // by the API — publishing a copy would duplicate the entire index weekly
    // to say nothing at all.
    const manifest = build(verdict());
    expect(manifest.layouts).toEqual({});
    expect(manifest.shown).toBe(0);
    expect(manifest.changed).toBe(0);
  });

  it('publishes a render for a layout that draws differently', () => {
    const manifest = build(verdict({ visuallyChanged: ['blue-office'] }));
    expect(manifest.layouts).toEqual({ 'blue-office': { file: 'blue-office.png' } });
    expect(manifest.changed).toBe(1);
    expect(manifest.shown).toBe(1);
  });

  it('marks a layout the candidate cannot draw, with no image', () => {
    // Falling back to the API's picture would show the OLD pin's render for a
    // layout the new pin cannot draw — the exact lie this exists to stop.
    const manifest = build(
      verdict({
        tier: 'regressions',
        regressions: [{ slug: 'four-rooms', kind: 'invalid', detail: 'unknown furniture' }],
      }),
    );
    expect(manifest.layouts).toEqual({ 'four-rooms': { failed: 'invalid' } });
    expect(manifest.failed).toBe(1);
  });

  it('caps the published set, and still reports the true totals', () => {
    // A palette change upstream alters everything at once. The page shows a
    // sample; the counts must describe the population, or a reader concludes
    // the other 750 were fine.
    const changed = Array.from({ length: 800 }, (_, i) => `layout-${i}`);
    const manifest = build(verdict({ visuallyChanged: changed }));

    expect(Object.keys(manifest.layouts)).toHaveLength(PUBLISH_CAP);
    expect(manifest.shown).toBe(PUBLISH_CAP);
    expect(manifest.changed).toBe(800);
    expect(manifest.cap).toBe(PUBLISH_CAP);
  });

  it('spends the cap on failures before pixel differences', () => {
    // A layout that does not render at all is more urgent than one that
    // renders differently, and costs no bytes to report.
    const manifest = build(
      verdict({
        tier: 'regressions',
        regressions: [{ slug: 'broken', kind: 'invalid', detail: 'unknown furniture' }],
        visuallyChanged: ['changed-a', 'changed-b'],
      }),
      2,
    );

    expect(manifest.layouts).toEqual({
      broken: { failed: 'invalid' },
      'changed-a': { file: 'changed-a.png' },
    });
    // 'changed-b' fell outside the cap, but the total still counts it.
    expect(manifest.changed).toBe(2);
    expect(manifest.shown).toBe(2);
  });

  it('publishes nothing at all when the cap is spent entirely on failures', () => {
    const manifest = build(
      verdict({
        tier: 'systemic',
        regressions: [
          { slug: 'a', kind: 'invalid', detail: 'x' },
          { slug: 'b', kind: 'invalid', detail: 'x' },
        ],
        visuallyChanged: ['c'],
      }),
      2,
    );
    expect(Object.values(manifest.layouts).every((entry) => 'failed' in entry)).toBe(true);
  });

  it('carries both pins so the page can prove which one the API is on', () => {
    const manifest = build(verdict());
    expect(manifest.candidate.commit).toBe('b'.repeat(40));
    expect(manifest.baseline.commit).toBe('a'.repeat(40));
  });

  it('normalises the base URL to a trailing slash', () => {
    expect(build(verdict()).baseUrl).toBe('https://renders.example.com/bbb/');
  });

  it('carries the upstream repository so the page can link a pin to its commit', () => {
    const manifest = buildPreviewManifest({
      baseline,
      candidate,
      verdict: verdict(),
      baseUrl: 'https://renders.example.com/bbb/',
      // Trailing slash stripped, so the page can append /commit/<sha> without
      // producing a double slash.
      upstreamUrl: 'https://github.com/pixel-agents-hq/pixel-agents/',
    });
    expect(manifest.upstreamUrl).toBe('https://github.com/pixel-agents-hq/pixel-agents');
  });

  it('reports a null upstream rather than guessing one', () => {
    expect(build(verdict()).upstreamUrl).toBeNull();
  });
});
