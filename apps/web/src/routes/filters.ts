import type { ListLayoutsParams } from '../api/types';

export type SizeBucket = 'small' | 'medium' | 'large';
export type PetsFilter = 'has' | 'none';
export type SortKey = 'newest' | 'furniture' | 'largest' | 'title';

/**
 * Both axes, ANDed — a known imprecision the issue itself calls out ("tile
 * count is probably more intuitive than two independent axes"): a long,
 * thin layout (say 8x40) falls outside every bucket, since #6 only offers
 * independent min/max on cols and rows, not on cols*rows. Good enough for a
 * first pass; a real fix is a computed tile-count column, not a client
 * heuristic.
 */
const SIZE_BUCKET_RANGES: Record<SizeBucket, { min: number; max?: number }> = {
  small: { min: 1, max: 15 },
  medium: { min: 16, max: 30 },
  large: { min: 31 },
};

export interface Filters {
  q: string;
  sort: SortKey;
  size: SizeBucket | null;
  minFurniture: number | null;
  maxFurniture: number | null;
  pets: PetsFilter | null;
  tags: string[];
  author: string | null;
  /** Not shown in the filter bar — set by clicking an author name on a card. */
  authorLabel: string | null;
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  sort: 'newest',
  size: null,
  minFurniture: null,
  maxFurniture: null,
  pets: null,
  tags: [],
  author: null,
  authorLabel: null,
};

export function filtersFromSearchParams(params: URLSearchParams): Filters {
  const size = params.get('size');
  const pets = params.get('pets');
  const minFurniture = params.get('minFurniture');
  const maxFurniture = params.get('maxFurniture');
  return {
    q: params.get('q') ?? '',
    sort: (params.get('sort') as SortKey | null) ?? 'newest',
    size: size === 'small' || size === 'medium' || size === 'large' ? size : null,
    minFurniture: minFurniture !== null && minFurniture !== '' ? Number(minFurniture) : null,
    maxFurniture: maxFurniture !== null && maxFurniture !== '' ? Number(maxFurniture) : null,
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
  if (filters.size) params.set('size', filters.size);
  if (filters.minFurniture !== null) params.set('minFurniture', String(filters.minFurniture));
  if (filters.maxFurniture !== null) params.set('maxFurniture', String(filters.maxFurniture));
  if (filters.pets) params.set('pets', filters.pets);
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
  if (filters.author) params.set('author', filters.author);
  if (filters.authorLabel) params.set('authorLabel', filters.authorLabel);
  return params;
}

/** What actually goes to #6's list endpoint — the URL vocabulary above translated into the API's own. */
export function filtersToApiParams(filters: Filters): ListLayoutsParams {
  const sizeRange = filters.size ? SIZE_BUCKET_RANGES[filters.size] : null;
  return {
    sort: filters.sort,
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.tags.length > 0 ? { tags: filters.tags.join(',') } : {}),
    ...(sizeRange ? { minCols: sizeRange.min, minRows: sizeRange.min } : {}),
    ...(sizeRange?.max !== undefined ? { maxCols: sizeRange.max, maxRows: sizeRange.max } : {}),
    ...(filters.minFurniture !== null ? { minFurniture: filters.minFurniture } : {}),
    ...(filters.maxFurniture !== null ? { maxFurniture: filters.maxFurniture } : {}),
    ...(filters.pets === 'has' ? { minPets: 1 } : {}),
    ...(filters.pets === 'none' ? { maxPets: 0 } : {}),
  };
}

export function isDefault(filters: Filters): boolean {
  return (
    filters.q === '' &&
    filters.sort === 'newest' &&
    filters.size === null &&
    filters.minFurniture === null &&
    filters.maxFurniture === null &&
    filters.pets === null &&
    filters.tags.length === 0 &&
    filters.author === null
  );
}

/** Human-readable summary of every active filter — for the "clear filters" list and the empty-results explanation. */
export function describeActiveFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.q) parts.push(`text "${filters.q}"`);
  if (filters.size) parts.push(`size: ${filters.size}`);
  if (filters.minFurniture !== null || filters.maxFurniture !== null) {
    parts.push(`furniture: ${filters.minFurniture ?? 0}–${filters.maxFurniture ?? '∞'}`);
  }
  if (filters.pets === 'has') parts.push('has pets');
  if (filters.pets === 'none') parts.push('no pets');
  if (filters.tags.length > 0) parts.push(`tags: ${filters.tags.join(', ')}`);
  if (filters.author) parts.push(`author: ${filters.authorLabel ?? filters.author}`);
  return parts;
}
