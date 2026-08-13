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
  it('falls back to the default sort for a value that is not a sort key', () => {
    // `sort` used to be cast out of the URL rather than checked, three lines
    // from `pets` doing it properly — so `?sort=nope` reached
    // filtersToApiParams and went out to the API, which rejected it. It fails
    // safely, but the SPA should not be the one sending it.
    expect(filtersFromSearchParams(new URLSearchParams({ sort: 'nope' })).sort).toBe('newest');
    expect(filtersFromSearchParams(new URLSearchParams({ sort: '' })).sort).toBe('newest');
    expect(filtersFromSearchParams(new URLSearchParams({ sort: 'title' })).sort).toBe('title');
  });

  it('round-trips every field through the URL — a shared link reproduces the same view', () => {
    const original = new URLSearchParams({
      q: 'cosy office',
      sort: 'furniture',
      minSize: '100',
      maxSize: '500',
      minFurniture: '10',
      maxFurniture: '50',
      minSeats: '2',
      maxSeats: '8',
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

  it('rejects a garbage `pets` value rather than passing it through', () => {
    const filters = filtersFromSearchParams(new URLSearchParams({ pets: 'maybe' }));
    expect(filters.pets).toBeNull();
  });
});

describe('filtersToApiParams', () => {
  it('passes the size range through as minSize/maxSize — the occupied-footprint tile count, not cols/rows independently', () => {
    // #24's worked example: 21×22 = 462.
    const params = filtersToApiParams({ ...DEFAULT_FILTERS, minSize: 462, maxSize: 462 });
    expect(params).toMatchObject({ minSize: 462, maxSize: 462 });
  });

  it('"has pets" and "no pets" map to opposite ends of the same range param', () => {
    expect(filtersToApiParams({ ...DEFAULT_FILTERS, pets: 'has' })).toMatchObject({ minPets: 1 });
    expect(filtersToApiParams({ ...DEFAULT_FILTERS, pets: 'none' })).toMatchObject({ maxPets: 0 });
  });

  it('joins multiple tags into the comma-separated form #6 expects', () => {
    const params = filtersToApiParams({ ...DEFAULT_FILTERS, tags: ['cosy', 'small'] });
    expect(params.tags).toBe('cosy,small');
  });

  it('passes the seat range through as minSeats/maxSeats', () => {
    const params = filtersToApiParams({ ...DEFAULT_FILTERS, minSeats: 2, maxSeats: 8 });
    expect(params).toMatchObject({ minSeats: 2, maxSeats: 8 });
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
    expect(isDefault({ ...DEFAULT_FILTERS, minSeats: 1 })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, maxSeats: 1 })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, minSize: 1 })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, maxSize: 1 })).toBe(false);
  });
});

describe('describeActiveFilters', () => {
  it('names every active filter in a human-readable way', () => {
    const description = describeActiveFilters({
      ...DEFAULT_FILTERS,
      q: 'office',
      minSize: 100,
      maxSize: 500,
      minSeats: 2,
      pets: 'has',
      tags: ['cosy'],
    });
    expect(description).toEqual([
      'text "office"',
      'size: 100–500 tiles',
      'seats: 2–∞',
      'has pets',
      'tags: cosy',
    ]);
  });

  it('is empty when nothing is active', () => {
    expect(describeActiveFilters(DEFAULT_FILTERS)).toEqual([]);
  });
});
