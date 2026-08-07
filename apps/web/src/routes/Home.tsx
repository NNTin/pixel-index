import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiError, listLayouts } from '../api/client';
import type { LayoutSummary } from '../api/types';
import { ErrorNotice } from '../components/ErrorNotice';
import { FilterBar } from '../components/FilterBar';
import { LayoutCard } from '../components/LayoutCard';
import { describeActiveFilters, filtersFromSearchParams, filtersToApiParams, filtersToSearchParams, isDefault } from './filters';

const PAGE_SIZE = 24;

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearchParams(searchParams);
  // Keyed by the filter state itself (via the URL's own query string) —
  // every filter change is a full re-fetch from page one, never an append.
  const filterKey = searchParams.toString();

  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLayouts(null);
    setError(null);
    listLayouts({ ...filtersToApiParams(filters), limit: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setLayouts(response.layouts);
        setTotal(response.total);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      cancelled = true;
    };
    // Re-runs on every filter change (encoded in filterKey), not on every
    // render — filters itself is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    listLayouts({ ...filtersToApiParams(filters), limit: PAGE_SIZE, cursor })
      .then((response) => {
        setLayouts((existing) => [...(existing ?? []), ...response.layouts]);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      })
      .finally(() => setLoadingMore(false));
  }

  return (
    <div>
      <FilterBar filters={filters} onChange={(next) => setSearchParams(filtersToSearchParams(next))} />
      <GalleryBody
        error={error}
        layouts={layouts}
        total={total}
        cursor={cursor}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        filtersActive={!isDefault(filters)}
        onClearFilters={() => setSearchParams(new URLSearchParams())}
        activeFilterSummary={describeActiveFilters(filters)}
      />
    </div>
  );
}

function GalleryBody({
  error,
  layouts,
  total,
  cursor,
  loadingMore,
  onLoadMore,
  filtersActive,
  onClearFilters,
  activeFilterSummary,
}: {
  error: ApiError | null;
  layouts: LayoutSummary[] | null;
  total: number;
  cursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  filtersActive: boolean;
  onClearFilters: () => void;
  activeFilterSummary: string[];
}) {
  if (error) {
    return <ErrorNotice error={error} />;
  }

  if (layouts === null) {
    return <p className="text-slate-400">Loading layouts…</p>;
  }

  if (layouts.length === 0) {
    return (
      <div className="text-slate-400">
        {filtersActive ? (
          <>
            <p>No layouts match the current filters ({activeFilterSummary.join(' · ')}).</p>
            <button type="button" onClick={onClearFilters} className="mt-2 text-sky-400 underline">
              Clear filters
            </button>{' '}
            to see everything.
          </>
        ) : (
          <p>No layouts published yet.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">
        {total} layout{total === 1 ? '' : 's'}
      </p>
      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6 p-0">
        {layouts.map((layout) => (
          <li key={layout.slug}>
            <LayoutCard layout={layout} />
          </li>
        ))}
      </ul>
      {cursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="border-2 border-slate-700 px-4 py-2 text-sm hover:border-slate-500 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
