import { useEffect, useRef, useState } from 'react';

import type { PreviewImageProps } from '../api/previewSourceState';
import type { LayoutDetail } from '../api/types';
import {
  isViewerMessage,
  LIVE_OFFICE_CHANNEL,
  type MockAgent,
  type RenderOfficeMessage,
} from '../live-office/protocol';
import { PreviewImage } from './PreviewImage';

const STORAGE_KEY = 'pixelindex_layout_render_mode';
/** How many mock agents to seed a fresh preview with, before clamping to the layout's seat count. */
const DEFAULT_AGENTS = 3;

const ACTIVITIES = [
  { activity: 'Exploring the codebase', tool: 'Read' },
  { activity: 'Writing implementation', tool: 'Edit' },
  { activity: 'Running the test suite', tool: 'Bash' },
  { activity: 'Reviewing the changes', tool: 'Read' },
  { activity: 'Searching for references', tool: 'Grep' },
  { activity: 'Formatting layout.json', tool: 'Edit' },
  { activity: 'Rendering pixel art', tool: 'Task' },
  { activity: 'Preparing the final answer', tool: 'Write' },
] as const;

type RenderMode = 'live' | 'thumbnail';

function storedRenderMode(): RenderMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'thumbnail' ? 'thumbnail' : 'live';
  } catch {
    return 'live';
  }
}

function mockAgent(id: number): MockAgent {
  // `%` keeps the sign of its left operand in JavaScript, so an id below 1
  // would index off the front of the table and leave the agent with no
  // activity or tool at all. Wrapping it into range first is what makes the
  // lookup total — the ids are 1-based today, but nothing in the type said so.
  const index = (((id - 1) % ACTIVITIES.length) + ACTIVITIES.length) % ACTIVITIES.length;
  // `?? ACTIVITIES[0]` cannot be reached with the index wrapped above, but a
  // computed index into a tuple is `T | undefined` under
  // noUncheckedIndexedAccess and this is what makes the lookup total without a
  // non-null assertion. ACTIVITIES[0] is a literal tuple index, so it is not.
  return { id, ...(ACTIVITIES[index] ?? ACTIVITIES[0]) };
}

export function LiveOfficePreview({
  layout,
  staticPreview,
}: {
  layout: LayoutDetail;
  /** The still image to fall back to — `previewImageProps` builds this. */
  staticPreview: PreviewImageProps;
}) {
  const maxAgents = layout.seats;
  const [mode, setMode] = useState<RenderMode>(storedRenderMode);
  const [viewerStatus, setViewerStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [viewerError, setViewerError] = useState('');
  const [agents, setAgents] = useState<MockAgent[]>(() => {
    const count = Math.min(DEFAULT_AGENTS, maxAgents);
    return Array.from({ length: count }, (_, index) => mockAgent(index + 1));
  });
  const nextAgentId = useRef(agents.length + 1);
  const iframe = useRef<HTMLIFrameElement>(null);

  function selectMode(next: RenderMode): void {
    if (next === 'live') {
      setViewerStatus('loading');
      setViewerError('');
    }
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* The preference is optional; private-storage failures must not break the page. */
    }
  }

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== window.location.origin) {
        return;
      }
      // Bound to a local first: `event.data` is `any`, and narrowing on a
      // property access is discarded again inside the setAgents callback below,
      // which is what made `event.data.id` an unchecked read.
      const message: unknown = event.data;
      if (!isViewerMessage(message)) return;
      if (message.type === 'ready') {
        setViewerStatus('ready');
      } else if (message.type === 'error') {
        setViewerError(message.message);
        setViewerStatus('error');
      } else if (message.type === 'remove-agent') {
        const removedId = message.id;
        setAgents((current) => current.filter((agent) => agent.id !== removedId));
      }
      // A `layout` message is the editor's (#65) — this preview never asks the
      // frame to edit, so it can never be the one that provoked it.
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useEffect(() => {
    if (viewerStatus !== 'ready') return;
    const message: RenderOfficeMessage = {
      channel: LIVE_OFFICE_CHANNEL,
      type: 'render',
      layout: layout.layout,
      agents,
    };
    iframe.current?.contentWindow?.postMessage(message, window.location.origin);
  }, [agents, layout.layout, viewerStatus]);

  /**
   * The single place agent count changes — the slider and the +/- buttons
   * both call this, so they can never disagree about how many agents there
   * are or about the seat cap.
   */
  function setAgentCount(count: number): void {
    const clamped = Math.max(0, Math.min(maxAgents, count));
    setAgents((current) => {
      if (clamped === current.length) return current;
      if (clamped < current.length) return current.slice(0, clamped);
      const added: MockAgent[] = [];
      let id = nextAgentId.current;
      for (let i = current.length; i < clamped; i += 1) {
        added.push(mockAgent(id));
        id += 1;
      }
      nextAgentId.current = id;
      return [...current, ...added];
    });
  }

  function addAgent(): void {
    setAgentCount(agents.length + 1);
  }

  function removeAgent(): void {
    setAgentCount(agents.length - 1);
  }

  return (
    <section className="mt-6" aria-labelledby="preview-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="preview-heading" className="font-display text-xl text-ink">
          Office preview
        </h2>
        <div className="flex border-2 border-border" role="group" aria-label="Office preview mode">
          <button
            type="button"
            aria-pressed={mode === 'live'}
            onClick={() => selectMode('live')}
            className={`px-3 py-1.5 text-sm ${mode === 'live' ? 'bg-accent text-accent-solid-ink' : 'text-muted hover:text-ink'}`}
          >
            Live
          </button>
          <button
            type="button"
            aria-pressed={mode === 'thumbnail'}
            onClick={() => selectMode('thumbnail')}
            className={`border-l-2 border-border px-3 py-1.5 text-sm ${mode === 'thumbnail' ? 'bg-accent text-accent-solid-ink' : 'text-muted hover:text-ink'}`}
          >
            Thumbnail
          </button>
        </div>
      </div>

      {mode === 'live' ? (
        <>
          <div
            className="relative overflow-hidden border-2 border-border bg-[#181828]"
            style={{
              height: `${Math.min(768, Math.max(384, (layout.rows + 2) * 32))}px`,
            }}
          >
            <iframe
              ref={iframe}
              src={`${import.meta.env.BASE_URL}live-office.html`}
              title={`${layout.title} live Pixel Agents office`}
              className="h-full w-full border-0"
            />
            {viewerStatus === 'loading' && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#181828] text-sm text-white/70">
                Loading live office…
              </p>
            )}
            {viewerStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#181828] p-6 text-center text-sm text-white/80">
                <p role="alert">{viewerError || 'The live office could not be loaded.'}</p>
                <button
                  type="button"
                  className="border-2 border-[#746fff] px-3 py-1.5 text-[#b9a9ff]"
                  onClick={() => selectMode('thumbnail')}
                >
                  Show thumbnail
                </button>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              {agents.length} mock agent{agents.length === 1 ? '' : 's'}
            </span>
            <input
              type="range"
              aria-label="Mock agent count"
              min={0}
              max={maxAgents}
              value={agents.length}
              onChange={(event) => setAgentCount(Number(event.target.value))}
              disabled={maxAgents === 0}
              className="h-2 w-32 accent-accent disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              type="button"
              aria-label="Remove mock agent"
              onClick={removeAgent}
              disabled={agents.length === 0}
              className="h-8 w-8 border-2 border-border text-lg text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label="Add mock agent"
              onClick={addAgent}
              disabled={agents.length >= maxAgents}
              className="h-8 w-8 border-2 border-border text-lg text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            {maxAgents === 0 ? (
              <span className="text-xs text-subtle">This layout has no seats for mock agents.</span>
            ) : (
              <span className="text-xs text-subtle">
                Scroll to pan, or Ctrl+scroll to zoom inside the office.
              </span>
            )}
          </div>
        </>
      ) : (
        <PreviewImage
          src={staticPreview.src}
          unavailable={staticPreview.unavailable}
          alt={`${layout.title} office layout thumbnail`}
        />
      )}
    </section>
  );
}
