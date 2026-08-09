import { describe, expect, it } from 'vitest';

import { diffRuns, SYSTEMIC_COUNT, tierFor } from './diff.js';
import type { LayoutOutcome, PinRun } from './types.js';

const ok = (hash = 'a'): LayoutOutcome => ({ status: 'ok', pngSha256: hash, bytes: 100 });
const invalid = (message: string): LayoutOutcome => ({
  status: 'invalid',
  issues: [{ code: 'layout.furniture.unknown', path: '/furniture', message }],
});
const renderFailed = (): LayoutOutcome => ({
  status: 'render_failed',
  kind: 'timeout',
  message: 'Render exceeded 1000ms',
});

function run(outcomes: Record<string, LayoutOutcome>, commit = 'a'.repeat(40)): PinRun {
  return {
    pin: { version: '1.4.0', commit, layoutRevision: 1 },
    source: 'seed/',
    outcomes,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
  };
}

describe('diffRuns', () => {
  it('reports a layout that rendered before and does not now', () => {
    const verdict = diffRuns(run({ a: ok() }), run({ a: invalid('no such chair') }));
    expect(verdict.regressions).toEqual([
      { slug: 'a', kind: 'invalid', detail: 'layout.furniture.unknown: no such chair' },
    ]);
  });

  it('does NOT report a layout that was already broken', () => {
    // The whole reason the gate renders twice. Without this the check would be
    // permanently red on any real index, for reasons merging cannot fix.
    const verdict = diffRuns(
      run({ a: invalid('was already bad') }),
      run({ a: invalid('still bad') }),
    );
    expect(verdict.regressions).toEqual([]);
    expect(verdict.alreadyBroken).toEqual(['a']);
    expect(verdict.tier).toBe('pass');
  });

  it('treats a layout the update FIXED as neither a regression nor pre-existing', () => {
    const verdict = diffRuns(run({ a: invalid('bad') }), run({ a: ok() }));
    expect(verdict.regressions).toEqual([]);
    expect(verdict.alreadyBroken).toEqual([]);
    expect(verdict.tier).toBe('pass');
  });

  it('separates a render failure from a validation failure in the report', () => {
    const verdict = diffRuns(run({ a: ok() }), run({ a: renderFailed() }));
    expect(verdict.regressions[0]?.kind).toBe('render_failed');
  });

  it('flags a layout that still renders but draws different pixels', () => {
    const verdict = diffRuns(run({ a: ok('before') }), run({ a: ok('after') }));
    expect(verdict.visuallyChanged).toEqual(['a']);
    // Different pixels is information for the reviewer, not a failure — a
    // sprite tweak upstream is a legitimate reason for every layout to change.
    expect(verdict.tier).toBe('pass');
    expect(verdict.regressions).toEqual([]);
  });

  it('ignores a layout that vanished between the two runs', () => {
    // The live index can change under a run; that is not the vendor's fault.
    const verdict = diffRuns(run({ a: ok(), b: ok() }), run({ a: ok() }));
    expect(verdict.comparable).toBe(1);
    expect(verdict.regressions).toEqual([]);
  });
});

describe('tierFor', () => {
  it('calls any regression on a small corpus systemic', () => {
    // A percentage is meaningless over four seed layouts, and the hermetic
    // gate's rule is simply that nothing may regress.
    expect(tierFor(1, 4)).toBe('systemic');
  });

  it('calls a minority of a real index a regression, not a breaking change', () => {
    expect(tierFor(2, 100)).toBe('regressions');
  });

  it('calls a tenth of the index systemic', () => {
    expect(tierFor(10, 100)).toBe('systemic');
  });

  it('calls an absolute count systemic even on a large index', () => {
    // A layoutRevision bump invalidates everything at once and lands here.
    expect(tierFor(SYSTEMIC_COUNT, 1000)).toBe('systemic');
    expect(tierFor(SYSTEMIC_COUNT - 1, 1000)).toBe('regressions');
  });

  it('passes when nothing regressed', () => {
    expect(tierFor(0, 1000)).toBe('pass');
  });
});
