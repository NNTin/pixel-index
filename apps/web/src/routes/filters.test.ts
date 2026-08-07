import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  describeActiveFilters,
  filtersFromSearchParams,
  filtersToApiParams,
  filtersToSearchParams,
  isDefault,
} from './filters';

describe('filtersFromSearchParams / filtersToSearchParams', () => {
  it('round-trips every field through the URL — a shared link reproduces the same view', () => {
    const original = new URLSearchParams({
      q: 'cosy office',
      sort: 'furniture',
      size: 'large',
      minFurniture: '10',
      maxFurniture: '50',
      pets: 'has',
      tags: 'cosy,small',
      author: 'user-123',
      authorLabel: 'someone',
    });
    const filters = filtersFromSearchParams(original);
    const roundTripped = filtersToSearchParams(filters);
    // Every param present in the original survives (order isn't guaranteed).
    for (const [key, value] of original.entries()) {
      expect(roundTripped.get(key)).toBe(value);
    }
  });

  it('defaults (newest sort, no filters) are omitted from the URL, not written explicitly', () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS);
    expect(params.toString()).toBe('');
  });

  it('rejects a garbage `size` or `pets` value rather than passing it through', () => {
    const filters = filtersFromSearchParams(new URLSearchParams({ size: 'huge', pets: 'maybe' }));
    expect(filters.size).toBeNull();
    expect(filters.pets).toBeNull();
  });
});

describe('filtersToApiParams', () => {
  it('translates the size bucket into both axes, AND-ed', () => {
    const filters = { ...DEFAULT_FILTERS, size: 'small' as const };
    const params = filtersToApiParams(filters);
    expect(params).toMatchObject({ minCols: 1, maxCols: 15, minRows: 1, maxRows: 15 });
  });

  it('the largest bucket has no upper bound', () => {
    const params = filtersToApiParams({ ...DEFAULT_FILTERS, size: 'large' });
    expect(params.minCols).toBe(31);
    expect(params.maxCols).toBeUndefined();
  });

  it('"has pets" and "no pets" map to opposite ends of the same range param', () => {
    expect(filtersToApiParams({ ...DEFAULT_FILTERS, pets: 'has' })).toMatchObject({ minPets: 1 });
    expect(filtersToApiParams({ ...DEFAULT_FILTERS, pets: 'none' })).toMatchObject({ maxPets: 0 });
  });

  it('joins multiple tags into the comma-separated form #6 expects', () => {
    const params = filtersToApiParams({ ...DEFAULT_FILTERS, tags: ['cosy', 'small'] });
    expect(params.tags).toBe('cosy,small');
  });

  it('omits every field that has no active filter', () => {
    const params = filtersToApiParams(DEFAULT_FILTERS);
    expect(params).toEqual({ sort: 'newest' });
  });
});

describe('isDefault', () => {
  it('is true only when nothing is filtered', () => {
    expect(isDefault(DEFAULT_FILTERS)).toBe(true);
    expect(isDefault({ ...DEFAULT_FILTERS, q: 'x' })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, tags: ['x'] })).toBe(false);
  });
});

describe('describeActiveFilters', () => {
  it('names every active filter in a human-readable way', () => {
    const description = describeActiveFilters({
      ...DEFAULT_FILTERS,
      q: 'office',
      size: 'medium',
      pets: 'has',
      tags: ['cosy'],
    });
    expect(description).toEqual(['text "office"', 'size: medium', 'has pets', 'tags: cosy']);
  });

  it('is empty when nothing is active', () => {
    expect(describeActiveFilters(DEFAULT_FILTERS)).toEqual([]);
  });
});
