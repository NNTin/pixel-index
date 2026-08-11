import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiError, listLayouts } from '../api/client';
import type { LayoutSummary } from '../api/types';
import { ErrorNotice } from '../components/ErrorNotice';
import { FilterBar } from '../components/FilterBar';
import { LayoutCard } from '../components/LayoutCard';
import { Masonry } from '../components/Masonry';
import { describeActiveFilters, filtersFromSearchParams, filtersToApiParams, filtersToSearchParams, isDefault } from './filters';

const PAGE_SIZE = 24;

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Memoised on `searchParams`, which react-router keeps stable per location.
  // The effect below used to depend on `searchParams.toString()` and suppress
  // exhaustive-deps, because `filters` was rebuilt on every render and would
  // have re-fetched on every render. Deriving it once makes the dependency the
  // rule wants and the dependency the effect needs the same object — every
  // filter change is still a full re-fetch from page one, never an append.
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The current filter's request. loadMore() rides on it — see the effect. */
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Held in a ref as well as locally so loadMore() below can ride on the same
    // cancellation: a "load more" in flight when the filters change would
    // otherwise APPEND the old filter's page to the new list.
    const controller = new AbortController();
    requestRef.current = controller;
    // Clearing before the fetch is what makes the gallery show its skeleton on
    // a filter change instead of the previous filter's results. Same pattern
    // and same trade-off as useApi.ts — see the note there.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayouts(null);
    setError(null);
    listLayouts({ ...filtersToApiParams(filters), limit: PAGE_SIZE }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLayouts(response.layouts);
        setTotal(response.total);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        // A superseded request's failure is not this page's failure — its
        // banner would outlive the request nobody is waiting for.
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      controller.abort();
    };
  }, [filters]);

  function loadMore() {
    if (!cursor) return;
    // Shares the effect's controller: changing the filters aborts this too,
    // which is what stops a page fetched for the old filters being appended to
    // the new list.
    const signal = requestRef.current?.signal;
    setLoadingMore(true);
    listLayouts({ ...filtersToApiParams(filters), limit: PAGE_SIZE, cursor }, signal)
      .then((response) => {
        if (signal?.aborted) return;
        setLayouts((existing) => [...(existing ?? []), ...response.layouts]);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        if (signal?.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      })
      .finally(() => {
        if (!signal?.aborted) setLoadingMore(false);
      });
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
    return <p className="text-muted">Loading layouts…</p>;
  }

  if (layouts.length === 0) {
    return (
      <div className="text-muted">
        {filtersActive ? (
          <>
            <p>No layouts match the current filters ({activeFilterSummary.join(' · ')}).</p>
            <button type="button" onClick={onClearFilters} className="mt-2 text-accent underline">
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
      <p className="mb-4 text-sm text-muted">
        {total} layout{total === 1 ? '' : 's'}
      </p>
      <Masonry
        items={layouts}
        keyFor={(layout) => layout.slug}
        renderItem={(layout) => <LayoutCard layout={layout} />}
        className="list-none p-0"
      />
      {cursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="border-2 border-border px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
