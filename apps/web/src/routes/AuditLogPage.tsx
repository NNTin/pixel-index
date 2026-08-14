import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { getAuditLog } from '../api/moderationClient';
import type { AuditAction, AuditLogEntry } from '../api/types';
import { useAuth } from '../auth/authState';
import { ErrorNotice } from '../components/ErrorNotice';

/** One place that knows what an audit action is called — same reasoning as
 *  AdminPage.tsx's `CAPABILITY_LABELS`. */
const ACTION_LABELS: Record<AuditAction, string> = {
  'layout.create': 'Created',
  'layout.update': 'Edited (owner)',
  'layout.replace': 'Content replaced',
  // Owner or moderator (#72) — unlike update/moderate_edit above, deletion
  // shares one action label for both actors; `by {actorLabel}` below (not
  // this label) is what says who.
  'layout.delete': 'Deleted',
  'layout.hide': 'Hidden',
  'layout.unhide': 'Unhidden',
  // Retired (#72): no longer written — 'removed' was folded into 'deleted'.
  // Kept so history from before #72 still renders with a real label.
  'layout.remove': 'Removed (retired)',
  'layout.restore': 'Restored (retired)',
  'layout.moderate_edit': 'Edited (moderator)',
  'layout.rename_slug': 'Slug renamed',
  'report.create': 'Report filed',
  'report.resolve': 'Report resolved',
  'report.dismiss': 'Report dismissed',
};

const ACTIONS = Object.keys(ACTION_LABELS) as AuditAction[];

export function AuditLogPage() {
  const { accessToken } = useAuth();
  // Only `slug` is URL-driven — it is what a "View history" link elsewhere
  // (ModerationPage.tsx) deep-links with. `q`/`action` are plain local state,
  // same as AdminPage.tsx's own filters.
  const [searchParams, setSearchParams] = useSearchParams();
  const slugFilter = searchParams.get('slug') ?? '';

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [action, setAction] = useState<'' | AuditAction>('');
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The current filters' request. loadMore() rides on it — see the effect. */
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    requestRef.current = controller;
    getAuditLog(
      {
        limit: 50,
        ...(slugFilter ? { slug: slugFilter } : submittedQuery ? { q: submittedQuery } : {}),
        ...(action ? { action } : {}),
      },
      accessToken,
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setEntries(response.actions);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      controller.abort();
    };
  }, [accessToken, slugFilter, submittedQuery, action]);

  function loadMore() {
    if (!accessToken || !cursor) return;
    // Shares the effect's controller: a new filter aborts this too, which is
    // what stops a page fetched for the old filters being appended to the
    // new list.
    const signal = requestRef.current?.signal;
    setLoadingMore(true);
    getAuditLog(
      {
        limit: 50,
        cursor,
        ...(slugFilter ? { slug: slugFilter } : submittedQuery ? { q: submittedQuery } : {}),
        ...(action ? { action } : {}),
      },
      accessToken,
      signal,
    )
      .then((response) => {
        if (signal?.aborted) return;
        setEntries((current) => [...(current ?? []), ...response.actions]);
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

  function clearSlugFilter() {
    setSearchParams((params) => {
      params.delete('slug');
      return params;
    });
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-ink">Moderation history</h1>
      <p className="mt-1 text-sm text-muted">
        Every owner and moderator action on every layout — created, edited, hidden, deleted, renamed — with its
        reason, its actor, and a before/after snapshot.
      </p>

      {slugFilter ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          Showing history for <strong className="text-ink">{slugFilter}</strong>
          <button
            type="button"
            onClick={clearSlugFilter}
            className="border border-border px-2 py-0.5 text-xs text-ink hover:border-accent"
          >
            Clear
          </button>
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(query.trim());
          }}
          className="mt-4 flex flex-wrap gap-2"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by layout slug or title"
            className="min-w-0 flex-1 border border-border bg-canvas px-3 py-1.5 text-sm text-ink"
          />
          <button type="submit" className="border-2 border-border px-4 py-1.5 text-sm text-ink hover:border-accent">
            Search
          </button>
        </form>
      )}

      <label className="mt-3 flex items-center gap-2 text-sm text-muted">
        Action
        <select
          value={action}
          onChange={(event) => setAction(event.target.value as '' | AuditAction)}
          className="border border-border bg-canvas px-2 py-1.5 text-ink"
        >
          <option value="">Any action</option>
          {ACTIONS.map((value) => (
            <option key={value} value={value}>
              {ACTION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="mt-4">
          <ErrorNotice error={error} />
        </div>
      )}
      {entries === null && !error && <p className="mt-4 text-muted">Loading…</p>}
      {entries && (
        <>
          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
            {entries.length === 0 && <li className="text-muted">No matching history.</li>}
            {entries.map((entry) => (
              <li key={entry.id} className="border-2 border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">{ACTION_LABELS[entry.action]}</p>
                    <p className="text-xs text-subtle">{new Date(entry.createdAt).toLocaleString()}</p>
                    <p className="mt-1 text-sm text-muted">by {entry.actorLabel ?? 'unknown'}</p>
                  </div>
                  <div className="text-right text-sm">
                    {entry.layoutSlug ? (
                      <Link to={`/layouts/${entry.layoutSlug}`} className="text-accent hover:underline">
                        {entry.layoutTitle ?? entry.layoutSlug}
                      </Link>
                    ) : (
                      <p className="text-subtle">{entry.targetType}</p>
                    )}
                  </div>
                </div>
                {entry.reason && <p className="mt-2 text-sm text-ink">{entry.reason}</p>}
                <details className="mt-2 text-xs text-subtle">
                  <summary className="cursor-pointer">Details</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 border-2 border-border px-4 py-2 text-sm text-ink disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
