import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import { patchLayout } from '../api/manageClient';
import { getModerationLayouts } from '../api/moderationClient';
import type { OwnerLayoutView } from '../api/types';
import { useAuth } from '../auth/authState';
import { ErrorNotice } from '../components/ErrorNotice';

const VISIBILITY_OPTIONS = ['public', 'hidden', 'removed', 'deleted'] as const;

function ModerationRow({
  layout,
  accessToken,
  onSaved,
}: {
  layout: OwnerLayoutView;
  accessToken: string;
  onSaved: (updated: OwnerLayoutView) => void;
}) {
  const [visibility, setVisibility] = useState<'public' | 'hidden' | 'removed'>(
    layout.visibility === 'deleted' ? 'public' : layout.visibility,
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function apply() {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchLayout(layout.slug, { visibility, reason }, accessToken);
      onSaved(updated);
      setReason('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border-2 border-border p-4">
      <Link to={`/layouts/${layout.slug}`} className="font-medium text-ink hover:underline">
        {layout.title}
      </Link>
      <p className="text-sm text-muted">
        by {layout.author.username} · currently <strong>{layout.visibility}</strong>
        {layout.visibilityReason && <> — {layout.visibilityReason}</>}
      </p>

      {layout.visibility === 'deleted' ? (
        <p className="mt-2 text-sm text-subtle">Owner-deleted. Not reachable by a moderator action.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as typeof visibility)}
            className="border border-border bg-canvas px-2 py-1 text-sm text-ink"
          >
            {VISIBILITY_OPTIONS.filter((v) => v !== 'deleted').map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (required for a change)"
            className="min-w-0 flex-1 border border-border bg-canvas px-2 py-1 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => void apply()}
            disabled={saving || visibility === layout.visibility}
            className="border border-accent px-3 py-1 text-sm text-accent disabled:opacity-50"
          >
            {saving ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-sm text-danger">{error.message}</p>}
    </li>
  );
}

export function ModerationPage() {
  const { accessToken } = useAuth();
  const [visibilityFilter, setVisibilityFilter] = useState<string>('');
  const [layouts, setLayouts] = useState<OwnerLayoutView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    // As in Home.tsx: clear before refetching so the moderator does not act on
    // the previous visibility filter's rows. See useApi.ts for the note.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayouts(null);
    getModerationLayouts(
      { limit: 50, ...(visibilityFilter ? { visibility: visibilityFilter as OwnerLayoutView['visibility'] } : {}) },
      accessToken,
    )
      .then((response) => setLayouts(response.layouts))
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.')),
      );
  }, [accessToken, visibilityFilter]);

  function updateLayout(updated: OwnerLayoutView) {
    setLayouts((existing) => existing?.map((l) => (l.slug === updated.slug ? updated : l)) ?? null);
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-ink">Moderation</h1>
      <p className="mt-1 text-sm text-muted">
        Every layout, any author, any visibility. See{' '}
        <a
          href="https://github.com/NNTin/pixel-index/blob/main/MODERATORS.md"
          className="text-accent underline"
          target="_blank"
          rel="noreferrer"
        >
          MODERATORS.md
        </a>{' '}
        for when to hide vs. remove.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm text-muted">
        Visibility
        <select
          value={visibilityFilter}
          onChange={(event) => setVisibilityFilter(event.target.value)}
          className="border border-border bg-canvas px-2 py-1 text-ink"
        >
          <option value="">Any</option>
          {VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4">
        {error && <ErrorNotice error={error} />}
        {!error && layouts === null && <p className="text-muted">Loading…</p>}
        {!error && layouts?.length === 0 && <p className="text-muted">Nothing matches.</p>}
        {!error && layouts && layouts.length > 0 && accessToken && (
          <ul className="flex list-none flex-col gap-4 p-0">
            {layouts.map((layout) => (
              <ModerationRow key={layout.slug} layout={layout} accessToken={accessToken} onSaved={updateLayout} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
