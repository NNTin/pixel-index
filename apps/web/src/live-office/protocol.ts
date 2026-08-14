/**
 * The postMessage vocabulary between the app and the `live-office.html` frame.
 *
 * Two conversations share it. The read-only one (`render` → `ready`/`error`/
 * `remove-agent`) is what `components/LiveOfficePreview.tsx` has always spoken.
 * The editing one (`edit` → `layout`) is #65: the frame is where the upstream
 * editor runs, because upstream's toolbar is styled from upstream's Tailwind
 * theme, and that theme redefines `--color-accent`, `--color-border`,
 * `--color-danger` and `--color-warning` — the same token names
 * `src/index.css` defines for the whole site. `viewer.css` can import it
 * wholesale precisely because this frame is a separate document.
 *
 * Deliberately free of vendor imports: `LiveOfficePreview.tsx` and
 * `routes/LayoutEditorPage.tsx` both import this file from the strict app
 * project, and vendor sources reaching that project reintroduce the
 * `noUncheckedIndexedAccess` errors `tsconfig.live-office.json` exists to
 * contain (see inboundLayout.ts for the same reasoning).
 */

export const LIVE_OFFICE_CHANNEL = 'pixel-index-live-office';

export interface MockAgent {
  id: number;
  activity: string;
  tool: string;
}

export interface RenderOfficeMessage {
  channel: typeof LIVE_OFFICE_CHANNEL;
  type: 'render';
  layout: unknown;
  agents: MockAgent[];
}

/**
 * Hand the frame a layout to edit. Sent once per layout the editor loads —
 * never in response to a `layout` message coming back, which would loop.
 */
export interface EditOfficeMessage {
  channel: typeof LIVE_OFFICE_CHANNEL;
  type: 'edit';
  /**
   * `null` starts from upstream's blank room (`createDefaultLayout`). The
   * parent cannot build that itself: it would have to import vendor code into
   * the app bundle, which is the thing this frame exists to avoid.
   */
  layout: unknown;
  /**
   * The `layoutRevision` to stamp on whatever this frame emits — from
   * `GET /api/v1/meta`, so it is the revision the API will actually validate
   * against rather than the one this build was compiled with (#64 lets those
   * differ per environment).
   *
   * It has to be stamped somewhere. Upstream never writes this field: a layout
   * carries whatever the bundled default it descended from had, and
   * `createDefaultLayout()` — the blank room — has none at all, which reads as
   * `0` and is below every real bundled revision. Publishing that would fail
   * `layout.revision.below_bundled` with a message telling the author to
   * re-export from Pixel Agents, which is not something the author of a layout
   * drawn *here* can do. The claim is earned rather than assumed: everything
   * this frame loads goes through `migrateLayoutColors` (inboundLayout.ts),
   * upstream's own migration to the pinned format.
   */
  layoutRevision?: number;
}

export type OfficeMessage = RenderOfficeMessage | EditOfficeMessage;

export type ViewerMessage =
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'ready' }
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'error'; message: string }
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'remove-agent'; id: number }
  /**
   * The current layout, already serialised — sent once when the frame loads
   * one and again (debounced) after every edit. A string rather than an object
   * because that is what the parent needs anyway: submission and replacement
   * both store `layout.json` byte-for-byte, so the frame that owns the layout
   * is also the honest place to decide those bytes.
   *
   * No accompanying "dirty" flag: the parent compares these bytes against the
   * first set it received, which is the same question asked in the one place
   * that can also see an imported layout replacing the original.
   */
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'layout'; layout: string };

export function isRenderOfficeMessage(value: unknown): value is RenderOfficeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RenderOfficeMessage>;
  return (
    message.channel === LIVE_OFFICE_CHANNEL &&
    message.type === 'render' &&
    Boolean(message.layout) &&
    Array.isArray(message.agents)
  );
}

export function isEditOfficeMessage(value: unknown): value is EditOfficeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<EditOfficeMessage>;
  return (
    message.channel === LIVE_OFFICE_CHANNEL &&
    message.type === 'edit' &&
    // Presence, not truthiness: `null` is the blank-layout request, and it is
    // the one payload here that a `Boolean()` check would throw away.
    'layout' in message &&
    (message.layoutRevision === undefined || typeof message.layoutRevision === 'number')
  );
}

export function isViewerMessage(value: unknown): value is ViewerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ViewerMessage>;
  if (message.channel !== LIVE_OFFICE_CHANNEL) return false;
  if (message.type === 'ready') return true;
  if (message.type === 'error') return typeof message.message === 'string';
  if (message.type === 'layout') return typeof message.layout === 'string';
  return message.type === 'remove-agent' && typeof message.id === 'number';
}
