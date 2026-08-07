import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { previewCheck, submitLayout } from '../api/manageClient';
import { useAuth } from '../auth/AuthContext';

/**
 * "Submitting shows a rendered preview before publishing" (#15). The
 * preview is a real round trip through layout-core validation and the
 * renderer (`POST /layouts/preview-check`) — the same check the real
 * publish uses, so a validation error caught here is the exact error
 * publishing would have produced, not a client-side approximation of it.
 */
export function SubmitPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const previewObjectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    },
    [],
  );

  function onFileChosen(file: File) {
    file.text().then(setRaw).catch(() => setError(new ApiError(0, 'Could not read that file.')));
  }

  async function checkPreview() {
    if (!accessToken || !raw) return;
    setChecking(true);
    setError(null);
    try {
      const blob = await previewCheck(raw, accessToken);
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
      const url = URL.createObjectURL(blob);
      previewObjectUrl.current = url;
      setPreviewUrl(url);
    } catch (caught) {
      setPreviewUrl(null);
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setChecking(false);
    }
  }

  async function publish() {
    if (!accessToken || !raw || !title) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await submitLayout(raw, { title, description, tags }, accessToken);
      navigate(`/layouts/${result.slug}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Submit a layout</h1>
      <p className="mt-1 text-sm text-slate-400">
        Export from Pixel Agents with <strong>Layout → Export</strong>, then paste or upload the
        resulting <code>layout.json</code> below.
      </p>
      <p className="mt-2 text-sm text-slate-400">
        This index is <strong>public on publish</strong>, not reviewed first — read the{' '}
        <a
          href="https://github.com/NNTin/pixel-index/blob/main/CONTENT_POLICY.md"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          content policy
        </a>{' '}
        before you publish.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          layout.json
          <textarea
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setPreviewUrl(null);
            }}
            rows={8}
            className="border border-slate-700 bg-slate-950 p-2 font-mono text-xs"
            placeholder='{"version": 1, "layoutRevision": ...}'
          />
          <input
            type="file"
            accept="application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFileChosen(file);
            }}
            className="text-xs text-slate-400"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={60}
            required
            className="border border-slate-700 bg-slate-950 px-2 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={300}
            rows={2}
            className="border border-slate-700 bg-slate-950 px-2 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Tags (comma-separated)
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="cosy,small"
            className="border border-slate-700 bg-slate-950 px-2 py-1.5"
          />
        </label>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={checkPreview}
            disabled={!raw || checking}
            className="border-2 border-slate-700 px-4 py-2 text-sm hover:border-slate-500 disabled:opacity-50"
          >
            {checking ? 'Rendering…' : 'Check preview'}
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={!raw || !title || publishing}
            className="border-2 border-sky-500 px-4 py-2 text-sm text-sky-400 hover:bg-sky-500 hover:text-slate-950 disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-red-200">
            <p className="font-medium">{error.message}</p>
            {error.issues && (
              <ul className="mt-2 list-disc pl-5 text-sm text-red-300">
                {error.issues.map((issue, i) => (
                  <li key={i}>
                    <code className="text-xs">{issue.path}</code>: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {previewUrl && (
          <div
            className="inline-block p-3"
            style={{
              background: 'repeating-conic-gradient(#191926 0% 25%, #15151f 0% 50%) 50% / 16px 16px',
            }}
          >
            <img src={previewUrl} alt="Preview of your layout" className="max-w-full [image-rendering:pixelated]" />
          </div>
        )}
      </div>
    </div>
  );
}
