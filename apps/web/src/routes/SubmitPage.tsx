import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, getMeta } from '../api/client';
import { previewCheck, submitLayout } from '../api/manageClient';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';

/**
 * "Submitting shows a rendered preview before publishing" (#15). The
 * preview is a real round trip through layout-core validation and the
 * renderer (`POST /layouts/preview-check`) — the same check the real
 * publish uses, so a validation error caught here is the exact error
 * publishing would have produced, not a client-side approximation of it.
 */
export function SubmitPage() {
  const { status, accessToken, user, login } = useAuth();
  const navigate = useNavigate();
  const metaState = useApi(() => getMeta(), []);
  // Public, not gated behind login — someone deciding whether to join the
  // community must not need to sign in first just to see the invite.
  const inviteUrl = metaState.status === 'ready' ? metaState.data.discordInviteUrl : null;

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

  if (status === 'loading') {
    return <p className="text-muted">Loading…</p>;
  }

  if (!user || !user.submission.allowed) {
    const loggedOut = !user;
    const reconnect = !loggedOut && user.submission.reason === 'discord_reauthorization_required';
    return (
      <div className="max-w-2xl">
        <h1 className="font-display text-2xl text-ink">Submit a layout</h1>
        <p className="mt-3 text-muted">
          {reconnect
            ? 'Reconnect Discord so Pixel Index can verify your community membership.'
            : loggedOut
              ? 'Layout submission is available to members of the official Discord community. Log in with Discord to check your membership.'
              : 'Layout submission is available to members of the official Discord community.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {reconnect ? (
            <button type="button" onClick={login} className="border-2 border-accent px-4 py-2 text-accent">
              Reconnect Discord
            </button>
          ) : loggedOut ? (
            <button type="button" onClick={login} className="border-2 border-accent px-4 py-2 text-accent">
              Log in with Discord
            </button>
          ) : null}
          {inviteUrl && (
            <a
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block border-2 border-accent px-4 py-2 text-accent"
            >
              Join the Discord server
            </a>
          )}
        </div>
      </div>
    );
  }

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

  const fieldClass = 'border border-border bg-canvas px-2 py-1.5 text-ink';

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-ink">Submit a layout</h1>
      <p className="mt-1 text-sm text-muted">
        Export from Pixel Agents with <strong>Layout → Export</strong>, then paste or upload the
        resulting <code>layout.json</code> below.
      </p>
      <p className="mt-2 text-sm text-muted">
        This index is <strong>public on publish</strong>, not reviewed first — read the{' '}
        <a
          href="https://github.com/NNTin/pixel-index/blob/main/CONTENT_POLICY.md"
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
            onClick={checkPreview}
            disabled={!raw || checking}
            className="border-2 border-border px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50"
          >
            {checking ? 'Rendering…' : 'Check preview'}
          </button>
          <button
            type="button"
            onClick={publish}
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
    </div>
  );
}
