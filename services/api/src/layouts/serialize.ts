/**
 * DB rows → the public JSON shape. One place, so the list and detail routes
 * (and their OpenAPI response schemas) can never quietly drift apart.
 */

import type * as schema from '../db/schema.js';

export interface PublicAuthor {
  /**
   * `null` for a credited-but-not-a-registered-account author — the seed
   * layouts, whose real owner is the synthetic system user (#3). Returning
   * that internal id would leak an implementation detail with no meaning to
   * a client; `null` says plainly "there is no account behind this credit".
   */
  id: string | null;
  username: string;
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
  furniture: number;
  areas: number;
  pets: number;
  carpets: number;
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

function publicAuthor(layout: schema.Layout, author: schema.User | null): PublicAuthor {
  if (layout.authorDisplay) return { id: null, username: layout.authorDisplay, avatarUrl: null };
  return {
    id: author?.id ?? null,
    username: author?.username ?? 'unknown',
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
    furniture: layout.furnitureCount,
    areas: layout.areaCount,
    pets: layout.petCount,
    carpets: layout.carpetCount,
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
