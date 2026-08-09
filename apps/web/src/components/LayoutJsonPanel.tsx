import { useMemo, useState } from 'react';

import { apiUrl } from '../api/client';

export type LayoutJsonState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; source: string };

function formatJson(source: string): string {
  return `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected.');
  } finally {
    textarea.remove();
  }
}

export function LayoutJsonPanel({
  state,
  slug,
  downloadPath,
}: {
  state: LayoutJsonState;
  slug: string;
  downloadPath: string;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const formatted = useMemo(() => {
    if (state.status !== 'ready') return null;
    try {
      return formatJson(state.source);
    } catch {
      return null;
    }
  }, [state]);

  async function copy(): Promise<void> {
    if (!formatted) return;
    try {
      await copyText(formatted);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <section className="mt-8" aria-labelledby="layout-json-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="layout-json-heading" className="font-display text-xl text-ink">
          layout.json
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!formatted}
            className="border-2 border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-accent-solid-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy layout.json
          </button>
          <a
            href={apiUrl(downloadPath)}
            download={`${slug}.json`}
            className="border-2 border-border-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
          >
            Download layout.json
          </a>
        </div>
      </div>

      <p className="mt-2 min-h-5 text-sm text-subtle" role="status" aria-live="polite">
        {copyStatus === 'copied' && 'Copied formatted layout.json.'}
        {copyStatus === 'failed' && 'Could not copy. Select the JSON below instead.'}
      </p>

      <div className="mt-2 max-h-[32rem] overflow-auto border-2 border-border bg-canvas p-4">
        {state.status === 'loading' ? (
          <p className="text-sm text-muted">Loading layout.json…</p>
        ) : state.status === 'error' ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : formatted ? (
          <pre className="min-w-max whitespace-pre font-mono text-xs leading-relaxed text-ink">
            <code>{formatted}</code>
          </pre>
        ) : (
          <p className="text-sm text-danger">This layout.json could not be formatted.</p>
        )}
      </div>
    </section>
  );
}
