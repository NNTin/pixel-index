import { describe, expect, it } from 'vitest';

import { one } from './rows.js';

describe('one', () => {
  it('returns the row', () => {
    expect(one([{ id: 'a' }])).toEqual({ id: 'a' });
  });

  it('throws when the write returned nothing', () => {
    // The whole point. `rows[0]!` returns undefined here and the failure
    // surfaces somewhere else entirely, as a property read on undefined.
    expect(() => one([])).toThrow('expected exactly one row, got 0');
  });

  it('throws when the write matched more than one row', () => {
    // Not pedantry: every caller is an insert of one value or an update keyed
    // on a primary key, so a second row means the predicate is wrong and the
    // first row is an arbitrary choice among several.
    expect(() => one([{ id: 'a' }, { id: 'b' }])).toThrow('expected exactly one row, got 2');
  });
});
