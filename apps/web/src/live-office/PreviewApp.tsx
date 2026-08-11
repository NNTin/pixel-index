import { useEffect, useMemo, useRef, useState } from 'react';

import { OfficeCanvas } from '../../../../vendor/pixel-agents/webview-ui/src/office/components/OfficeCanvas.js';
import { ToolOverlay } from '../../../../vendor/pixel-agents/webview-ui/src/office/components/ToolOverlay.js';
import { EditorState } from '../../../../vendor/pixel-agents/webview-ui/src/office/editor/editorState.js';
import { OfficeState } from '../../../../vendor/pixel-agents/webview-ui/src/office/engine/officeState.js';
import type {
  OfficeLayout,
  ToolActivity,
} from '../../../../vendor/pixel-agents/webview-ui/src/office/types.js';
import {
  TILE_SIZE,
  TileType,
} from '../../../../vendor/pixel-agents/webview-ui/src/office/types.js';
import { loadLiveOfficeAssets } from './assets';
import { parseInboundLayout } from './inboundLayout';
import {
  isRenderOfficeMessage,
  LIVE_OFFICE_CHANNEL,
  type MockAgent,
  type ViewerMessage,
} from './protocol';

/**
 * Every editing callback upstream's canvas requires. The preview is read-only,
 * so all of them have to exist and all of them have to do nothing.
 */
const noop = () => {
  // Intentionally inert: see above.
};

function sendToParent(message: ViewerMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

function applyAgents(office: OfficeState, agents: MockAgent[]): void {
  const desired = new Set(agents.map((agent) => agent.id));
  for (const [id, character] of office.characters) {
    if (!character.isSubagent && !desired.has(id)) office.removeAgent(id);
  }

  for (const agent of agents) {
    office.addAgent(agent.id);
    office.setAgentActive(agent.id, true);
    office.setAgentTool(agent.id, agent.tool);
  }
}

function toolRows(agents: MockAgent[]): Record<number, ToolActivity[]> {
  return Object.fromEntries(
    agents.map((agent) => [
      agent.id,
      [
        {
          toolId: `pixel-index-mock-${agent.id}`,
          status: agent.activity,
          done: false,
          permissionWait: false,
        },
      ],
    ]),
  );
}

function visibleTileBounds(layout: OfficeLayout): {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
} {
  let minCol = layout.cols;
  let maxCol = -1;
  let minRow = layout.rows;
  let maxRow = -1;

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      // No `tile === undefined` check: parseInboundLayout has already pinned
      // tiles.length to cols * rows, so every index this loop visits exists.
      const tile = layout.tiles[row * layout.cols + col];
      if (tile === TileType.VOID) continue;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }

  return maxCol >= 0
    ? { minCol, maxCol, minRow, maxRow }
    : { minCol: 0, maxCol: layout.cols - 1, minRow: 0, maxRow: layout.rows - 1 };
}

export function PreviewApp() {
  const office = useMemo(() => new OfficeState(), []);
  const editor = useMemo(() => new EditorState(), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(() => Math.max(1, Math.round(2 * window.devicePixelRatio)));
  const [assetsReady, setAssetsReady] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A controller for the honest `boolean`, not for cancellation: this page
    // mounts once, outside StrictMode (live-office/main.tsx), and never
    // unmounts, so threading a signal into loadLiveOfficeAssets' seven fetches
    // would buy nothing real.
    const controller = new AbortController();
    loadLiveOfficeAssets()
      .then(() => {
        if (controller.signal.aborted) return;
        setAssetsReady(true);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const message = reason instanceof Error ? reason.message : 'Could not load the live office.';
        setError(message);
        sendToParent({ channel: LIVE_OFFICE_CHANNEL, type: 'error', message });
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!assetsReady) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if (!isRenderOfficeMessage(event.data)) return;
      try {
        // Checked rather than asserted — see inboundLayout.ts. A layout that
        // fails throws, and the catch below reports it to the parent frame on
        // the path that already exists for a render failure.
        const layout = parseInboundLayout(event.data.layout);
        office.rebuildFromLayout(layout);
        const bounds = containerRef.current?.getBoundingClientRect();
        if (bounds) {
          const dpr = window.devicePixelRatio || 1;
          const visible = visibleTileBounds(layout);
          const visibleCols = visible.maxCol - visible.minCol + 1;
          const visibleRows = visible.maxRow - visible.minRow + 1;
          const fit = Math.floor(
            Math.min(
              (bounds.width * dpr) / ((visibleCols + 2) * TILE_SIZE),
              (bounds.height * dpr) / ((visibleRows + 2) * TILE_SIZE),
            ),
          );
          const nextZoom = Math.max(1, Math.min(Math.round(2 * dpr), fit));
          const visibleCenterCol = (visible.minCol + visible.maxCol + 1) / 2;
          const visibleCenterRow = (visible.minRow + visible.maxRow + 1) / 2;
          panRef.current = {
            x: (layout.cols / 2 - visibleCenterCol) * TILE_SIZE * nextZoom,
            y: (layout.rows / 2 - visibleCenterRow) * TILE_SIZE * nextZoom,
          };
          setZoom(nextZoom);
        }
        applyAgents(office, event.data.agents);
        setAgents(event.data.agents);
        setError(null);
        setLayoutReady(true);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Could not render this layout.';
        setError(message);
        sendToParent({ channel: LIVE_OFFICE_CHANNEL, type: 'error', message });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [assetsReady, office]);

  // Announce readiness only after the message listener above is attached. This
  // prevents the parent from posting the first layout into a listener gap.
  useEffect(() => {
    if (assetsReady) sendToParent({ channel: LIVE_OFFICE_CHANNEL, type: 'ready' });
  }, [assetsReady]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {error ? (
        <p className="viewer-message">{error}</p>
      ) : layoutReady ? (
        <>
          <OfficeCanvas
            officeState={office}
            onClick={noop}
            isEditMode={false}
            editorState={editor}
            onEditorTileAction={noop}
            onEditorEraseAction={noop}
            onEditorSelectionChange={noop}
            onDeleteSelected={noop}
            onRotateSelected={noop}
            onDragMove={noop}
            editorTick={0}
            zoom={zoom}
            onZoomChange={setZoom}
            panRef={panRef}
            showAreas={false}
            activeAreaLabel={null}
          />
          <ToolOverlay
            officeState={office}
            agents={agents.map((agent) => agent.id)}
            agentTools={toolRows(agents)}
            subagentTools={{}}
            subagentCharacters={[]}
            containerRef={containerRef}
            zoom={zoom}
            panRef={panRef}
            onCloseAgent={(id) =>
              sendToParent({ channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id })
            }
            alwaysShowOverlay
          />
        </>
      ) : (
        <p className="viewer-message">Loading live office…</p>
      )}
    </div>
  );
}
