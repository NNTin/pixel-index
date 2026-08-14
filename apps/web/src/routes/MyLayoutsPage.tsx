import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import { deleteLayout, getMyLayouts, patchLayout, replaceLayoutContent } from '../api/manageClient';
import type { OwnerLayoutView } from '../api/types';
import { useAuth } from '../auth/authState';
import { ErrorNotice } from '../components/ErrorNotice';

function VisibilityBadge({ layout }: { layout: OwnerLayoutView }) {
  if (layout.visibility === 'public') return null;
  return (
    <p className="mt-1 text-sm text-warning">
      {layout.visibility}
      {layout.visibilityReason && <> — {layout.visibilityReason}</>}
    </p>
  );
}

function EditRow({ layout, accessToken, canEdit, onSaved }: { layout: OwnerLayoutView; accessToken: string; canEdit: boolean; onSaved: (updated: OwnerLayoutView) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(layout.title);
  const [description, setDescription] = useState(layout.description);
  const [tags, setTags] = useState(layout.tags.join(','));
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchLayout(
        layout.slug,
        {
          title,
          description,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
        accessToken,
      );
      onSaved(updated);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setSaving(false);
    }
  }

  async function replaceContent(file: File) {
    setReplacing(true);
    setError(null);
    try {
      const raw = await file.text();
      const updated = await replaceLayoutContent(layout.slug, raw, accessToken);
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setReplacing(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${layout.title}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteLayout(layout.slug, accessToken);
      onSaved({ ...layout, visibility: 'deleted' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    }
  }

  if (layout.visibility === 'deleted') {
    return <p className="text-sm text-subtle">Deleted.</p>;
  }

  if (!canEdit) {
    return (
      <div className="mt-2 text-sm">
        <p className="text-subtle">Reconnect or rejoin Discord to edit this layout.</p>
        <button
          type="button"
          onClick={() => void remove()}
          className="mt-1 text-danger hover:underline"
        >
          Delete
        </button>
        {error && <span className="ml-3 text-danger">{error.message}</span>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="mt-2 flex gap-3 text-sm">
        <button type="button" onClick={() => setEditing(true)} className="text-accent hover:underline">
          Edit
        </button>
        <Link to={`/layouts/${layout.slug}/edit`} className="text-accent hover:underline">
          Edit layout
        </Link>
        {/*
          Kept beside the editor (#65), not replaced by it: uploading a
          layout.json exported from Pixel Agents itself is still the shortest
          path for someone who drew it there, and it is the only one that
          preserves their own bytes exactly.
        */}
        <label className="cursor-pointer text-accent hover:underline">
          {replacing ? 'Replacing…' : 'Replace content'}
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void replaceContent(file);
            }}
          />
        </label>
        <button type="button" onClick={() => void remove()} className="text-danger hover:underline">
          Delete
        </button>
        {error && <span className="text-danger">{error.message}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border border-border p-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="border border-border bg-canvas px-2 py-1 text-sm text-ink"
        placeholder="Title"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className="border border-border bg-canvas px-2 py-1 text-sm text-ink"
        placeholder="Description"
        rows={2}
      />
      <input
        value={tags}
        onChange={(event) => setTags(event.target.value)}
        className="border border-border bg-canvas px-2 py-1 text-sm text-ink"
        placeholder="tags,comma,separated"
      />
      {error && <ErrorNotice error={error} />}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="border border-accent px-3 py-1 text-sm text-accent disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="border border-border px-3 py-1 text-sm text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MyLayoutsPage() {
  const { accessToken, user } = useAuth();
  const [layouts, setLayouts] = useState<OwnerLayoutView[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    getMyLayouts({ limit: 100 }, accessToken, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLayouts(response.layouts);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
      });
    return () => {
      controller.abort();
    };
  }, [accessToken]);

  function updateLayout(updated: OwnerLayoutView) {
    setLayouts((existing) => existing?.map((l) => (l.slug === updated.slug ? updated : l)) ?? null);
  }

  if (error) return <ErrorNotice error={error} />;
  if (layouts === null) return <p className="text-muted">Loading…</p>;
  if (layouts.length === 0) {
    return (
      <p className="text-muted">
        You haven't submitted any layouts yet —{' '}
        <Link to="/editor" className="text-accent underline">
          draw one
        </Link>
        .
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">My layouts</h1>
        <Link to="/editor" className="border-2 border-accent px-3 py-1.5 text-sm text-accent">
          New layout
        </Link>
      </div>
      <ul className="mt-6 flex list-none flex-col gap-4 p-0">
        {layouts.map((layout) => (
          <li key={layout.slug} className="border-2 border-border p-4">
            <Link to={`/layouts/${layout.slug}`} className="font-medium text-ink hover:underline">
              {layout.title}
            </Link>
            <VisibilityBadge layout={layout} />
            {accessToken && <EditRow layout={layout} accessToken={accessToken} canEdit={user?.submission.allowed ?? false} onSaved={updateLayout} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
