/**
 * DB rows → the public JSON shape. One place, so the list and detail routes
 * (and their OpenAPI response schemas) can never quietly drift apart.
 */

import type * as schema from '../db/schema.js';

export interface PublicAuthor {
  /**
   * The Discord user id (snowflake) — not the internal Pixel Index UUID
   * (#61): a Discord bot inherently knows a user's Discord id and has no way
   * of knowing our unique naming convention. `null` only for legacy
   * credited-but-unlinked system-owned seed data. Bundled layouts are
   * associated with their known Discord author (#23).
   */
  discordId: string | null;
  /** Stable Discord account handle, or the legacy credit for an unlinked seed. */
  username: string;
  /** Guild nickname, then global Discord name, then username. */
  displayName: string;
  avatarUrl: string | null;
}

export interface PublicLayoutSummary {
  slug: string;
  title: string;
  author: PublicAuthor;
  description: string;
  tags: string[];
  cols: number;
  rows: number;
  /** The occupied-footprint width/height — see `LayoutStats.visibleCols`. What "size" means to a viewer (#55). */
  visibleCols: number;
  visibleRows: number;
  furniture: number;
  areas: number;
  pets: number;
  carpets: number;
  seats: number;
  layoutRevision: number;
  pixelAgentsVersion: string | null;
  bytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  files: {
    layout: string;
    preview: string;
    thumbnail: string;
  };
}

export interface PublicLayoutDetail extends PublicLayoutSummary {
  layout: unknown;
}

export function publicAuthor(layout: schema.Layout, author: schema.User | null): PublicAuthor {
  if (layout.authorDisplay && (!author || author.isSystem)) {
    return {
      discordId: null,
      username: layout.authorDisplay,
      displayName: layout.authorDisplay,
      avatarUrl: null,
    };
  }
  const username = author?.username ?? 'unknown';
  return {
    discordId: author?.discordId ?? null,
    username,
    displayName: author?.guildNickname ?? author?.globalName ?? username,
    avatarUrl: author?.avatarUrl ?? null,
  };
}

function files(slug: string): PublicLayoutSummary['files'] {
  return {
    layout: `/api/v1/layouts/${slug}/download`,
    preview: `/api/v1/layouts/${slug}/preview.png`,
    thumbnail: `/api/v1/layouts/${slug}/thumbnail.png`,
  };
}

export function toSummary(
  layout: schema.Layout,
  author: schema.User | null,
  tags: string[],
): PublicLayoutSummary {
  return {
    slug: layout.slug,
    title: layout.title,
    author: publicAuthor(layout, author),
    description: layout.description,
    tags,
    cols: layout.cols,
    rows: layout.rows,
    visibleCols: layout.visibleCols,
    visibleRows: layout.visibleRows,
    furniture: layout.furnitureCount,
    areas: layout.areaCount,
    pets: layout.petCount,
    carpets: layout.carpetCount,
    seats: layout.seatCount,
    layoutRevision: layout.layoutRevision,
    pixelAgentsVersion: layout.pixelAgentsVersion,
    bytes: Buffer.byteLength(layout.raw, 'utf-8'),
    sha256: layout.sha256,
    createdAt: layout.createdAt.toISOString(),
    updatedAt: layout.updatedAt.toISOString(),
    files: files(layout.slug),
  };
}

export function toDetail(
  layout: schema.Layout,
  author: schema.User | null,
  tags: string[],
): PublicLayoutDetail {
  return { ...toSummary(layout, author, tags), layout: layout.layout };
}

export interface OwnerLayoutView extends PublicLayoutDetail {
  /** Absent from the public shape — a hidden/deleted slug is a 404 there. */
  visibility: schema.Layout['visibility'];
  /**
   * Why it is not public, if it is not — surfaced to the owner (#9) so a
   * layout that disappeared is never a silent mystery to the person who
   * made it. `null` for a public layout, or for the owner's own `deleted`
   * (they know why; nothing to explain back to them).
   */
  visibilityReason: string | null;
  visibilityChangedAt: string | null;
}

/**
 * The owner's (or a moderator's) own view of one of their layouts —
 * `GET /me/layouts` and the response from `PATCH`/`PUT .../layout`. Same
 * shape as the public detail plus the fields the public API deliberately
 * omits.
 */
export function toOwnerView(
  layout: schema.Layout,
  author: schema.User | null,
  tags: string[],
): OwnerLayoutView {
  return {
    ...toDetail(layout, author, tags),
    visibility: layout.visibility,
    visibilityReason: layout.visibilityReason,
    visibilityChangedAt: layout.visibilityChangedAt?.toISOString() ?? null,
  };
}
