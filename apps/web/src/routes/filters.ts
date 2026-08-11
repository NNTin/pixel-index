import type { ListLayoutsParams } from '../api/types';

export type PetsFilter = 'has' | 'none';
export const SORT_KEYS = ['newest', 'furniture', 'largest', 'title'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

function isSortKey(value: string | null): value is SortKey {
  return SORT_KEYS.some((key) => key === value);
}

export interface Filters {
  q: string;
  sort: SortKey;
  /** Tile count (cols × rows) — #24: "size is filtered by square unit", not cols/rows independently. */
  minSize: number | null;
  maxSize: number | null;
  minFurniture: number | null;
  maxFurniture: number | null;
  minSeats: number | null;
  maxSeats: number | null;
  pets: PetsFilter | null;
  tags: string[];
  author: string | null;
  /** Not shown in the filter bar — set by clicking an author name on a card. */
  authorLabel: string | null;
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  sort: 'newest',
  minSize: null,
  maxSize: null,
  minFurniture: null,
  maxFurniture: null,
  minSeats: null,
  maxSeats: null,
  pets: null,
  tags: [],
  author: null,
  authorLabel: null,
};

export function filtersFromSearchParams(params: URLSearchParams): Filters {
  const pets = params.get('pets');
  const minSize = params.get('minSize');
  const maxSize = params.get('maxSize');
  const minFurniture = params.get('minFurniture');
  const maxFurniture = params.get('maxFurniture');
  const minSeats = params.get('minSeats');
  const maxSeats = params.get('maxSeats');
  return {
    q: params.get('q') ?? '',
    // Checked, not asserted. This was the one cast in this function, three
    // lines from `pets` doing the honest thing — and `?sort=nope`
    // flowed straight through to the API on the strength of it.
    sort: isSortKey(params.get('sort')) ? (params.get('sort') as SortKey) : 'newest',
    minSize: minSize !== null && minSize !== '' ? Number(minSize) : null,
    maxSize: maxSize !== null && maxSize !== '' ? Number(maxSize) : null,
    minFurniture: minFurniture !== null && minFurniture !== '' ? Number(minFurniture) : null,
    maxFurniture: maxFurniture !== null && maxFurniture !== '' ? Number(maxFurniture) : null,
    minSeats: minSeats !== null && minSeats !== '' ? Number(minSeats) : null,
    maxSeats: maxSeats !== null && maxSeats !== '' ? Number(maxSeats) : null,
    pets: pets === 'has' || pets === 'none' ? pets : null,
    tags: params.get('tags')?.split(',').filter((t) => t.length > 0) ?? [],
    author: params.get('author'),
    authorLabel: params.get('authorLabel'),
  };
}

export function filtersToSearchParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sort !== 'newest') params.set('sort', filters.sort);
  if (filters.minSize !== null) params.set('minSize', String(filters.minSize));
  if (filters.maxSize !== null) params.set('maxSize', String(filters.maxSize));
  if (filters.minFurniture !== null) params.set('minFurniture', String(filters.minFurniture));
  if (filters.maxFurniture !== null) params.set('maxFurniture', String(filters.maxFurniture));
  if (filters.minSeats !== null) params.set('minSeats', String(filters.minSeats));
  if (filters.maxSeats !== null) params.set('maxSeats', String(filters.maxSeats));
  if (filters.pets) params.set('pets', filters.pets);
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
  if (filters.author) params.set('author', filters.author);
  if (filters.authorLabel) params.set('authorLabel', filters.authorLabel);
  return params;
}

/** What actually goes to #6's list endpoint — the URL vocabulary above translated into the API's own. */
export function filtersToApiParams(filters: Filters): ListLayoutsParams {
  return {
    sort: filters.sort,
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.tags.length > 0 ? { tags: filters.tags.join(',') } : {}),
    ...(filters.minSize !== null ? { minSize: filters.minSize } : {}),
    ...(filters.maxSize !== null ? { maxSize: filters.maxSize } : {}),
    ...(filters.minFurniture !== null ? { minFurniture: filters.minFurniture } : {}),
    ...(filters.maxFurniture !== null ? { maxFurniture: filters.maxFurniture } : {}),
    ...(filters.minSeats !== null ? { minSeats: filters.minSeats } : {}),
    ...(filters.maxSeats !== null ? { maxSeats: filters.maxSeats } : {}),
    ...(filters.pets === 'has' ? { minPets: 1 } : {}),
    ...(filters.pets === 'none' ? { maxPets: 0 } : {}),
  };
}

export function isDefault(filters: Filters): boolean {
  return (
    filters.q === '' &&
    filters.sort === 'newest' &&
    filters.minSize === null &&
    filters.maxSize === null &&
    filters.minFurniture === null &&
    filters.maxFurniture === null &&
    filters.minSeats === null &&
    filters.maxSeats === null &&
    filters.pets === null &&
    filters.tags.length === 0 &&
    filters.author === null
  );
}

/** Human-readable summary of every active filter — for the "clear filters" list and the empty-results explanation. */
export function describeActiveFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.q) parts.push(`text "${filters.q}"`);
  if (filters.minSize !== null || filters.maxSize !== null) {
    parts.push(`size: ${filters.minSize ?? 0}–${filters.maxSize ?? '∞'} tiles`);
  }
  if (filters.minFurniture !== null || filters.maxFurniture !== null) {
    parts.push(`furniture: ${filters.minFurniture ?? 0}–${filters.maxFurniture ?? '∞'}`);
  }
  if (filters.minSeats !== null || filters.maxSeats !== null) {
    parts.push(`seats: ${filters.minSeats ?? 0}–${filters.maxSeats ?? '∞'}`);
  }
  if (filters.pets === 'has') parts.push('has pets');
  if (filters.pets === 'none') parts.push('no pets');
  if (filters.tags.length > 0) parts.push(`tags: ${filters.tags.join(', ')}`);
  if (filters.author) parts.push(`author: ${filters.authorLabel ?? filters.author}`);
  return parts;
}
