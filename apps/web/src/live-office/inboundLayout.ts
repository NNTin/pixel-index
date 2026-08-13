/**
 * The one place a layout arriving over postMessage becomes an `OfficeLayout`.
 *
 * The upstream's `OfficeLayout` describes a layout the upstream itself has just
 * serialised: `version` is the literal `1` and `tiles` is a dense `TileType[]`
 * exactly `cols * rows` long. What arrives here is third-party JSON a visitor
 * submitted to the index, forwarded by the parent frame — so neither claim
 * holds until something checks it.
 *
 * Asserting it with `as OfficeLayout` did not make those claims true, it only
 * made TypeScript stop asking. Downstream that showed up as two conditions the
 * types called impossible (`tile === undefined`, `version === 1`) which were in
 * fact the only things standing between a malformed layout and a crash inside
 * vendor rendering code. Checking once here is what lets everything after this
 * point use the upstream type honestly. See #44.
 *
 * The invariant is not invented here: `@pixel-index/layout-core` already
 * enforces `tiles.length === cols * rows` and rejects a submission that breaks
 * it (`layout.grid.tiles_mismatch`), so this is the preview verifying a
 * guarantee the index already makes rather than a new rule.
 *
 * Lives in `src/live-office/` and not in `protocol.ts`, deliberately: it imports
 * vendor types, and `protocol.ts` is imported by `components/LiveOfficePreview.tsx`
 * in the strict app project. Vendor sources reaching that project would
 * reintroduce the 135 `noUncheckedIndexedAccess` errors `tsconfig.live-office.json`
 * exists to contain.
 */

import { migrateLayoutColors } from '../../../../vendor/pixel-agents/webview-ui/src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../../../../vendor/pixel-agents/webview-ui/src/office/types.js';

/** Raised for a layout this preview cannot safely render. Reported to the parent frame. */
export class InvalidLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLayoutError';
  }
}

/** A layout as it actually arrives: every field still in question. */
interface InboundLayout {
  version?: unknown;
  cols?: unknown;
  rows?: unknown;
  tiles?: unknown;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidLayoutError(`Layout ${field} must be a positive whole number.`);
  }
  return value;
}

/**
 * Narrow an inbound payload to the upstream's `OfficeLayout`, or throw.
 *
 * Applies `migrateLayoutColors` for a version 1 document, which is what the
 * upstream's own colour migration expects to be handed.
 */
export function parseInboundLayout(value: unknown): OfficeLayout {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidLayoutError('This layout is not an object.');
  }

  const inbound = value as InboundLayout;
  const cols = positiveInteger(inbound.cols, 'cols');
  const rows = positiveInteger(inbound.rows, 'rows');

  if (!Array.isArray(inbound.tiles)) {
    throw new InvalidLayoutError('This layout has no tiles.');
  }
  // The check that retires the `tile === undefined` guard downstream: with the
  // length pinned to cols * rows, every index the bounds loop visits exists.
  if (inbound.tiles.length !== cols * rows) {
    throw new InvalidLayoutError(
      `This layout declares ${cols}×${rows} but carries ${inbound.tiles.length} tiles.`,
    );
  }

  // Checked above; the upstream type is now earned rather than asserted.
  const layout = value as OfficeLayout;
  return inbound.version === 1 ? migrateLayoutColors(layout) : layout;
}
