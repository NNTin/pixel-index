import { useState } from 'react';

import { ApiError } from '../api/client';
import { patchUserBlock, patchUserRole, searchUsers } from '../api/moderationClient';
import type { PublicUserView, Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice } from '../components/ErrorNotice';

const ROLES: Role[] = ['user', 'moderator', 'admin'];

function UserRow({
  target,
  accessToken,
  onUpdated,
}: {
  target: PublicUserView;
  accessToken: string;
  onUpdated: (updated: PublicUserView) => void;
}) {
  const [role, setRole] = useState<Role>(target.role);
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function saveRole() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await patchUserRole(target.id, role, accessToken));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    setBusy(true);
    setError(null);
    try {
      const updated = target.blocked
        ? await patchUserBlock(target.id, { blocked: false }, accessToken)
        : await patchUserBlock(target.id, { blocked: true, reason: blockReason }, accessToken);
      onUpdated(updated);
      setBlockReason('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-2 border-border p-4">
      <p className="font-medium text-ink">
        {target.username}{' '}
        {target.blocked && <span className="text-danger">(blocked{target.blockedReason ? `: ${target.blockedReason}` : ''})</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className="border border-border bg-canvas px-2 py-1 text-ink"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={saveRole}
          disabled={busy || role === target.role}
          className="border border-accent px-3 py-1 text-accent disabled:opacity-50"
        >
          Save role
        </button>

        {target.blocked ? (
          <button type="button" onClick={toggleBlock} disabled={busy} className="border border-border px-3 py-1 text-ink disabled:opacity-50">
            Unblock
          </button>
        ) : (
          <>
            <input
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              placeholder="Reason to block"
              className="min-w-0 flex-1 border border-border bg-canvas px-2 py-1 text-ink"
            />
            <button
              type="button"
              onClick={toggleBlock}
              disabled={busy || !blockReason}
              className="border border-danger px-3 py-1 text-danger disabled:opacity-50"
            >
              Block
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error.message}</p>}
    </li>
  );
}

export function AdminPage() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUserView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!accessToken || !query) return;
    setSearching(true);
    setError(null);
    try {
      const response = await searchUsers(query, accessToken);
      setResults(response.users);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setSearching(false);
    }
  }

  function updateResult(updated: PublicUserView) {
    setResults((existing) => existing?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-ink">Admin</h1>
      <p className="mt-1 text-sm text-muted">Grant or revoke moderator/admin, or block an account.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by username"
          className="min-w-0 flex-1 border border-border bg-canvas px-3 py-1.5 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={!query || searching}
          className="border-2 border-border px-4 py-1.5 text-sm text-ink hover:border-accent disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="mt-4">
          <ErrorNotice error={error} />
        </div>
      )}

      {results && (
        <ul className="mt-4 flex list-none flex-col gap-4 p-0">
          {results.length === 0 && <p className="text-muted">No matching users.</p>}
          {accessToken &&
            results.map((target) => (
              <UserRow key={target.id} target={target} accessToken={accessToken} onUpdated={updateResult} />
            ))}
        </ul>
      )}
    </div>
  );
}
