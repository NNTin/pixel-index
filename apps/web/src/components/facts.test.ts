import { describe, expect, it } from 'vitest';

import { factsFor } from './facts';

describe('factsFor', () => {
  it('shows the occupied footprint, not the declared canvas (#55)', () => {
    // The bug report's own example: severance-office, four-rooms and default
    // all declare the same 21×22 canvas but occupy very different actual
    // footprints (see layout-core's stats.test.ts for the source numbers).
    // Reading cols/rows directly reported "21×22" for all three.
    const facts = factsFor({
      visibleCols: 20,
      visibleRows: 12,
      furniture: 15,
      areas: 0,
      pets: 0,
      seats: 4,
    });
    expect(facts[0]).toBe('20×12');
    expect(facts).not.toContain('21×22');
  });

  it('omits zero-valued collections', () => {
    const facts = factsFor({
      visibleCols: 4,
      visibleRows: 4,
      furniture: 3,
      areas: 0,
      pets: 0,
      seats: 0,
    });
    expect(facts).toEqual(['4×4', '3 furniture']);
  });
});
