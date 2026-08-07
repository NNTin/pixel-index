import { useEffect, useRef, useState } from 'react';

import { ApiError, listLayouts } from '../api/client';
import type { LayoutSummary } from '../api/types';
import { ErrorNotice } from '../components/ErrorNotice';
import { LayoutCard } from '../components/LayoutCard';

const PAGE_SIZE = 24;

export function Home() {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // StrictMode double-invokes effects in dev; without this the first page
  // loads twice and briefly shows double the layouts before settling.
  const initialLoadStarted = useRef(false);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    listLayouts({ limit: PAGE_SIZE })
      .then((response) => {
        setLayouts(response.layouts);
        setTotal(response.total);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
  }, []);

  function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    listLayouts({ limit: PAGE_SIZE, cursor })
      .then((response) => {
        setLayouts((existing) => [...(existing ?? []), ...response.layouts]);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      })
      .finally(() => setLoadingMore(false));
  }

  if (error) {
    return <ErrorNotice error={error} />;
  }

  if (layouts === null) {
    return <p className="text-slate-400">Loading layouts…</p>;
  }

  if (layouts.length === 0) {
    return <p className="text-slate-400">No layouts published yet.</p>;
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
            onClick={loadMore}
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
