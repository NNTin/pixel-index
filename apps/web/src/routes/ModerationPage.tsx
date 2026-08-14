import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, getApiInfo, repoFileUrl } from '../api/client';
import { deleteLayout, patchLayout } from '../api/manageClient';
import { getModerationLayouts } from '../api/moderationClient';
import type { OwnerLayoutView } from '../api/types';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/authState';
import { ErrorNotice } from '../components/ErrorNotice';

const VISIBILITY_OPTIONS = ['public', 'hidden', 'deleted'] as const;
// What a moderator can PATCH `visibility` to (#72) — `deleted` is a filter
// value above, never a PATCH target; that state is reached only through the
// Delete button, same endpoint an owner has always used for their own.
const PATCHABLE_VISIBILITY_OPTIONS = ['public', 'hidden'] as const;

/** '' means "any visibility" — the filter's default. */
type VisibilityFilter = OwnerLayoutView['visibility'] | '';

function asVisibilityFilter(value: string): VisibilityFilter {
  return VISIBILITY_OPTIONS.some((option) => option === value)
    ? (value as OwnerLayoutView['visibility'])
    : '';
}

function ModerationRow({
  layout,
  accessToken,
  onSaved,
}: {
  layout: OwnerLayoutView;
  accessToken: string;
  /** Keyed by the layout's slug BEFORE this save — the only stable way to find
   *  its row again once a slug rename means `updated.slug` no longer matches
   *  anything currently in the list. */
  onSaved: (previousSlug: string, updated: OwnerLayoutView) => void;
}) {
  const { user } = useAuth();
  const [visibility, setVisibility] = useState<'public' | 'hidden'>(
    layout.visibility === 'deleted' ? 'public' : layout.visibility,
  );
  const [slug, setSlug] = useState(layout.slug);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const visibilityChanged = visibility !== layout.visibility;
  const slugChanged = slug !== layout.slug;

  async function apply() {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchLayout(
        layout.slug,
        {
          reason,
          ...(visibilityChanged ? { visibility } : {}),
          ...(slugChanged ? { slug } : {}),
        },
        accessToken,
      );
      onSaved(layout.slug, updated);
      setReason('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setSaving(false);
    }
  }

  // Permanent, unlike hide/unhide above — same DELETE an owner has always
  // used for their own layout, now also reachable by a moderator on
  // someone else's (#72), with the same `reason` field this row already
  // has for the visibility/slug apply.
  async function remove() {
    if (!confirm(`Delete "${layout.title}"? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteLayout(layout.slug, accessToken, reason);
      onSaved(layout.slug, { ...layout, visibility: 'deleted', visibilityReason: reason || null });
      setReason('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border-2 border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/layouts/${layout.slug}`} className="font-medium text-ink hover:underline">
          {layout.title}
        </Link>
        {/* Admin-only, not moderator: the history page itself is admin-gated
         *  (RequireAuth role="admin"), so a moderator following this link
         *  would only hit "this page is for admins only". */}
        {user?.role === 'admin' && (
          <Link
            to={`/admin/history?slug=${encodeURIComponent(layout.slug)}`}
            className="text-xs text-muted hover:text-accent"
          >
            View history
          </Link>
        )}
      </div>
      <p className="text-sm text-muted">
        by {layout.author.username} · currently <strong>{layout.visibility}</strong>
        {layout.visibilityReason && <> — {layout.visibilityReason}</>}
      </p>

      {layout.visibility === 'deleted' ? (
        <p className="mt-2 text-sm text-subtle">Deleted. This is permanent — nothing more to do here.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            URL
            <span className="text-subtle">/layouts/</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="vanity-slug"
              aria-label="Slug"
              className="min-w-0 flex-1 border border-border bg-canvas px-2 py-1 font-mono text-sm text-ink"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as typeof visibility)}
              className="border border-border bg-canvas px-2 py-1 text-sm text-ink"
            >
              {PATCHABLE_VISIBILITY_OPTIONS.map((v) => (
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
              disabled={saving || (!visibilityChanged && !slugChanged)}
              className="border border-accent px-3 py-1 text-sm text-accent disabled:opacity-50"
            >
              {saving ? 'Applying…' : 'Apply'}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving || !reason}
              className="border border-danger px-3 py-1 text-sm text-danger disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-sm text-danger">{error.message}</p>}
    </li>
  );
}

export function ModerationPage() {
  const { accessToken } = useAuth();
  const infoState = useApi((signal) => getApiInfo(signal), []);
  const moderatorsUrl =
    infoState.status === 'ready' ? repoFileUrl(infoState.data, 'docs/MODERATORS.md') : undefined;
  // Typed as the union the API actually accepts, plus '' for "any". Declaring
  // it `string` meant the request had to assert the value back into the union
  // on the way out.
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('');
  const [layouts, setLayouts] = useState<OwnerLayoutView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    // Two dependencies and a setState that replaces rather than appends: flip
    // the filter twice quickly and, without this, the slower of the two
    // responses wins — leaving a moderator acting on rows that belong to a
    // filter the page is no longer showing.
    const controller = new AbortController();
    // As in Home.tsx: clear before refetching so the moderator does not act on
    // the previous visibility filter's rows. See useApi.ts for the note.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayouts(null);
    getModerationLayouts(
      { limit: 50, ...(visibilityFilter ? { visibility: visibilityFilter } : {}) },
      accessToken,
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setLayouts(response.layouts);
      })
      .catch((caught: unknown) => {
        // A superseded request's failure is not this page's failure.
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      controller.abort();
    };
  }, [accessToken, visibilityFilter]);

  function updateLayout(previousSlug: string, updated: OwnerLayoutView) {
    setLayouts((existing) => existing?.map((l) => (l.slug === previousSlug ? updated : l)) ?? null);
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-ink">Moderation</h1>
      <p className="mt-1 text-sm text-muted">
        Every layout, any author, any visibility. See{' '}
        <a
          href={moderatorsUrl}
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
          onChange={(event) => setVisibilityFilter(asVisibilityFilter(event.target.value))}
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
