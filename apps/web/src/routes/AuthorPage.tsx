import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ApiError, getAuthor, listLayouts } from '../api/client';
import type { LayoutSummary, PublicAuthorResponse } from '../api/types';
import { ErrorNotice } from '../components/ErrorNotice';
import { LayoutCard } from '../components/LayoutCard';

const PAGE_SIZE = 24;

export function AuthorPage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicAuthorResponse | null>(null);
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getAuthor(id), listLayouts({ author: id, limit: PAGE_SIZE })])
      .then(([author, page]) => {
        if (cancelled) return;
        setProfile(author);
        setLayouts(page.layouts);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => { cancelled = true; };
  }, [id]);

  function loadMore() {
    if (!id || !cursor) return;
    setLoadingMore(true);
    listLayouts({ author: id, limit: PAGE_SIZE, cursor })
      .then((page) => {
        setLayouts((current) => [...(current ?? []), ...page.layouts]);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.')),
      )
      .finally(() => setLoadingMore(false));
  }

  if (error) return <ErrorNotice error={error} />;
  if (!profile || !layouts) return <p className="text-muted">Loading author…</p>;

  return (
    <div>
      <header className="mb-6 flex items-center gap-4">
        {profile.author.avatarUrl && (
          <img src={profile.author.avatarUrl} alt="" className="h-16 w-16 rounded-full" />
        )}
        <div>
          <h1 className="font-display text-2xl text-ink">{profile.author.displayName}</h1>
          {profile.author.displayName !== profile.author.username && (
            <p className="text-sm text-muted">@{profile.author.username}</p>
          )}
          <p className="text-sm text-muted">
            {profile.publicLayoutCount} public layout{profile.publicLayoutCount === 1 ? '' : 's'}
          </p>
        </div>
      </header>
      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6 p-0">
        {layouts.map((layout) => <li key={layout.slug}><LayoutCard layout={layout} /></li>)}
      </ul>
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-6 border-2 border-border px-4 py-2 text-sm text-ink disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
