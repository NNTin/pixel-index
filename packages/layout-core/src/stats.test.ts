import { describe, expect, it } from 'vitest';

import { layoutStats, sha256 } from './stats.js';
import { makeLayout } from './test-support/fixtures.js';

describe('layoutStats', () => {
  it('counts every collection the index filters on', () => {
    const stats = layoutStats(
      makeLayout({
        cols: 21,
        rows: 22,
        furniture: [{ type: 'CLOCK', col: 1, row: -1 }],
        areas: [{ label: 'Green Room' }, { label: 'Blue Room' }],
        pets: [{}],
        carpets: [{}, {}, {}],
      }),
    );

    expect(stats).toEqual({
      cols: 21,
      rows: 22,
      furniture: 1,
      areas: 2,
      pets: 1,
      carpets: 3,
      layoutRevision: 1,
    });
  });

  it('treats absent collections as zero rather than undefined', () => {
    // The database columns are NOT NULL, so a layout exported without pets must
    // still produce a number.
    const stats = layoutStats(makeLayout({ areas: undefined, pets: undefined }));
    expect(stats.areas).toBe(0);
    expect(stats.pets).toBe(0);
    expect(stats.carpets).toBe(0);
  });

  it('defaults a missing layoutRevision to 0 so the rule can catch it', () => {
    expect(layoutStats(makeLayout({ layoutRevision: undefined })).layoutRevision).toBe(0);
  });
});

describe('sha256', () => {
  it('is stable and content-addressed', () => {
    expect(sha256('pixel')).toBe(sha256(Buffer.from('pixel')));
    expect(sha256('pixel')).not.toBe(sha256('pixels'));
    expect(sha256('')).toHaveLength(64);
  });
});
