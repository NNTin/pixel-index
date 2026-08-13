import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { getAdminUsers } from '../api/moderationClient';
import type { AdminUserView, Role } from '../api/types';
import { useAuth } from '../auth/authState';
import { ErrorNotice } from '../components/ErrorNotice';

/**
 * One place that knows what a capability is called.
 *
 * The filter options and the per-row label used to spell the same three names
 * out separately, and the row label derived two of them by upper-casing
 * `role[0]` — which needs a non-null assertion to say what the union already
 * guarantees. A lookup keyed by `Role` says it in the type instead, and adding
 * a capability now fails to compile until it is named here.
 */
const CAPABILITY_LABELS: Record<Role, string> = {
  user: 'Basic',
  moderator: 'Moderator',
  admin: 'Admin',
};

const ROLES = ['user', 'moderator', 'admin'] as const satisfies readonly Role[];

const CAPABILITIES: { value: '' | Role; label: string }[] = [
  { value: '', label: 'Any capability' },
  ...ROLES.map((value) => ({ value, label: CAPABILITY_LABELS[value] })),
];

const capabilityLabel = (role: Role) => CAPABILITY_LABELS[role];

export function AdminPage() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [capability, setCapability] = useState<'' | Role>('');
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The current search's request. loadMore() rides on it — see the effect. */
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    // Three dependencies the user changes (the query and the capability filter
    // among them), so without this a slow response for an abandoned search can
    // replace the results of the one on screen.
    const controller = new AbortController();
    requestRef.current = controller;
    getAdminUsers(
      {
        limit: 50,
        ...(submittedQuery ? { q: submittedQuery } : {}),
        ...(capability ? { capability } : {}),
      },
      accessToken,
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setUsers(response.users);
        setCursor(response.nextCursor);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      controller.abort();
    };
  }, [accessToken, submittedQuery, capability]);

  function loadMore() {
    if (!accessToken || !cursor) return;
    // Shares the effect's controller: a new search aborts this page too, so it
    // cannot be appended to results it does not belong to.
    const signal = requestRef.current?.signal;
    setLoadingMore(true);
    getAdminUsers(
      {
        limit: 50,
        cursor,
        ...(submittedQuery ? { q: submittedQuery } : {}),
        ...(capability ? { capability } : {}),
      },
      accessToken,
      signal,
    )
      .then((response) => {
        if (signal?.aborted) return;
        setUsers((current) => [...(current ?? []), ...response.users]);
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
      <h1 className="font-display text-2xl text-ink">Pixel Index users</h1>
      <p className="mt-1 text-sm text-muted">
        Read-only accounts which have interacted with this index. Capabilities are managed through Discord.
      </p>

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
          placeholder="Search by Discord username"
          className="min-w-0 flex-1 border border-border bg-canvas px-3 py-1.5 text-sm text-ink"
        />
        <select
          value={capability}
          onChange={(event) => setCapability(event.target.value as '' | Role)}
          className="border border-border bg-canvas px-2 py-1.5 text-sm text-ink"
        >
          {CAPABILITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <button type="submit" className="border-2 border-border px-4 py-1.5 text-sm text-ink hover:border-accent">
          Search
        </button>
      </form>

      {error && <div className="mt-4"><ErrorNotice error={error} /></div>}
      {users === null && !error && <p className="mt-4 text-muted">Loading users…</p>}
      {users && (
        <>
          <ul className="mt-4 flex list-none flex-col gap-3 p-0">
            {users.length === 0 && <li className="text-muted">No matching users.</li>}
            {users.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 border-2 border-border p-4">
                <div>
                  <p className="font-medium text-ink">{entry.displayName}</p>
                  {entry.displayName !== entry.username && <p className="text-xs text-subtle">@{entry.username}</p>}
                  <p className="mt-1 text-xs text-subtle">
                    Last verified: {entry.capabilityCheckedAt
                      ? new Date(entry.capabilityCheckedAt).toLocaleString()
                      : 'not yet verified'}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium text-accent">{capabilityLabel(entry.capability)}</p>
                  <p className="text-muted">{entry.layoutCount} layout{entry.layoutCount === 1 ? '' : 's'}</p>
                </div>
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
