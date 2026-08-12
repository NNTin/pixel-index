/** Shapes shared by everything that touches a layout. */

/**
 * An exported Pixel Agents layout.
 *
 * Upstream treats this as an opaque object owned by its rendering layer, so this
 * type covers the fields the index depends on and tolerates the rest. Never
 * reserialise a layout from this type: the stored bytes must stay exactly what
 * Pixel Agents exported.
 */
export interface Layout {
  version: number;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: FurnitureItem[];
  layoutRevision?: number;
  tileColors?: (string | null)[];
  carpets?: unknown[];
  areas?: Area[];
  areaTiles?: unknown[];
  pets?: unknown[];
  [key: string]: unknown;
}

export interface FurnitureItem {
  type: string;
  col: number;
  row: number;
  uid?: string;
  [key: string]: unknown;
}

export interface Area {
  label: string;
  color?: string;
  [key: string]: unknown;
}

/** Index-side metadata. Deliberately not stored inside layout.json. */
export interface LayoutMeta {
  title: string;
  author: string;
  description: string;
  tags?: string[];
  source?: string;
}

/** Placement properties resolved for one furniture id in the pinned upstream. */
export interface FurnitureEntry {
  category?: string;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: unknown;
  footprintW?: number;
  footprintH?: number;
  orientation?: string;
  mirrorSide?: boolean;
}

export type FurnitureCatalog = Map<string, FurnitureEntry>;

export interface UpstreamPin {
  version: string | null;
  commit: string | null;
  layoutRevision: number;
}

export interface LayoutStats {
  cols: number;
  rows: number;
  /**
   * The width/height of the smallest rectangle enclosing every non-VOID tile —
   * what a viewer actually perceives as this layout's size, as opposed to
   * `cols`/`rows`, which is the declared canvas allocation and can be
   * (and, for several bundled seeds, is) identical across layouts of wildly
   * different visual size (#55). Same definition and same bounding-box
   * algorithm as the live-office preview's own camera-fit logic
   * (apps/web/src/live-office/PreviewApp.tsx's `visibleTileBounds`) — see
   * `occupiedBounds()` in stats.ts for why that one is a hand-kept copy
   * rather than an import of this package's.
   */
  visibleCols: number;
  visibleRows: number;
  furniture: number;
  areas: number;
  pets: number;
  carpets: number;
  layoutRevision: number;
  /**
   * How many agents this layout can seat — the max a live-preview slider
   * should allow. Not one per chair-category item: a multi-tile item (e.g. a
   * SOFA) seats one agent per footprint tile that isn't a background row,
   * matching upstream's own `layoutToSeats()`
   * (webview-ui/src/office/layout/layoutSerializer.ts), which is what
   * actually assigns agents to seats.
   */
  seats: number;
}

/**
 * One validation failure, as data.
 *
 * Returned rather than printed so the API can turn a list of these into a 422
 * body and the CLI can format them for a terminal. `path` is a JSON Pointer into
 * the document that failed.
 */
export interface ValidationIssue {
  code: IssueCode;
  path: string;
  message: string;
}

export type IssueCode =
  | 'slug.invalid'
  | 'layout.invalid_json'
  | 'layout.schema'
  | 'layout.grid.tiles_mismatch'
  | 'layout.grid.tile_colors_mismatch'
  | 'layout.revision.below_bundled'
  | 'layout.furniture.unknown'
  | 'layout.furniture.out_of_bounds'
  | 'meta.invalid_json'
  | 'meta.schema';

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
