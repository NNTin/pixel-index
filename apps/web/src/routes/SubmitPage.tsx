import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError, getApiInfo, repoFileUrl } from '../api/client';
import { previewCheck, submitLayout } from '../api/manageClient';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/authState';
import { SubmissionGate } from '../components/SubmissionGate';

/**
 * What the editor (#65) hands this page on its way out: the layout it just
 * produced, as router state rather than a query parameter — a layout.json is
 * kilobytes, well past what a URL can carry.
 */
export interface SubmitPageState {
  raw?: string;
}

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
  const infoState = useApi((signal) => getApiInfo(signal), []);
  const contentPolicyUrl =
    infoState.status === 'ready' ? repoFileUrl(infoState.data, 'docs/CONTENT_POLICY.md') : undefined;

  // Read once, as the initial value: after that the textarea owns it, so
  // navigating back here and editing does not get reset by the state that
  // brought the visitor in.
  const handedOver = (useLocation().state as SubmitPageState | null)?.raw;
  const [raw, setRaw] = useState(handedOver ?? '');
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
      // `void`: navigate() returns a promise in react-router 7, and there is
      // nothing to do after it resolves — but it must not be left floating.
      void navigate(`/layouts/${result.slug}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'Something unexpected went wrong.'));
    } finally {
      setPublishing(false);
    }
  }

  const fieldClass = 'border border-border bg-canvas px-2 py-1.5 text-ink';

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-ink">Submit a layout</h1>
      <SubmissionGate what="Layout submission">
        <p className="mt-1 text-sm text-muted">
          Export from Pixel Agents with <strong>Layout → Export</strong>, then paste or upload the
          resulting <code>layout.json</code> below — or{' '}
          <Link to="/editor" className="text-accent underline">
            draw one here
          </Link>
          .
        </p>
        <p className="mt-2 text-sm text-muted">
          This index is <strong>public on publish</strong>, not reviewed first — read the{' '}
          <a
            href={contentPolicyUrl}
            className="text-accent underline"
            target="_blank"
            rel="noreferrer"
          >
            content policy
          </a>{' '}
          before you publish.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-muted">
            layout.json
            <textarea
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setPreviewUrl(null);
              }}
              rows={8}
              className={`${fieldClass} font-mono text-xs`}
              placeholder='{"version": 1, "layoutRevision": ...}'
            />
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileChosen(file);
              }}
              className="text-xs text-muted"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-muted">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={60}
              required
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-muted">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              rows={2}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-muted">
            Tags (comma-separated)
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="cosy,small"
              className={fieldClass}
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void checkPreview()}
              disabled={!raw || checking}
              className="border-2 border-border px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50"
            >
              {checking ? 'Rendering…' : 'Check preview'}
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!raw || !title || publishing}
              className="border-2 border-accent px-4 py-2 text-sm text-accent hover:bg-accent hover:text-accent-solid-ink disabled:opacity-50"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-danger">
              <p className="font-medium">{error.message}</p>
              {error.issues && (
                <ul className="mt-2 list-disc pl-5 text-sm text-danger">
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
            <div className="inline-block bg-canvas p-3">
              <img src={previewUrl} alt="Preview of your layout" className="max-w-full [image-rendering:pixelated]" />
            </div>
          )}
        </div>
      </SubmissionGate>
    </div>
  );
}
