/**
 * The TypeScript view of the response bodies declared as JSON Schema in
 * schemas.ts. The schemas remain the single runtime authority — Fastify
 * serializes with them and @fastify/swagger publishes them — but a schema is
 * invisible to the compiler, so every test that read a body got `any` back from
 * `response.json()` and could assert on a field that does not exist.
 *
 * These types are what the route handlers below declare they return, so the two
 * cannot drift silently: change a handler's shape and either the annotation or
 * the schema stops matching.
 */

import type { TagUsage } from './query.js';
import type { OwnerLayoutView, PublicLayoutDetail, PublicLayoutSummary } from './serialize.js';

/** `GET /api/v1/layouts` */
export interface ListLayoutsBody {
  schemaVersion: number;
  total: number;
  layouts: PublicLayoutSummary[];
  nextCursor: string | null;
}

/** `GET /api/v1/tags` */
export interface ListTagsBody {
  schemaVersion: number;
  tags: TagUsage[];
}

/**
 * `GET /api/v1/me/layouts` and `GET /api/v1/moderation/layouts` — the same
 * envelope as the public list, but carrying the owner/moderator view of each
 * row (hidden and deleted layouts included, with their reasons).
 */
export interface ListOwnerLayoutsBody {
  schemaVersion: number;
  total: number;
  layouts: OwnerLayoutView[];
  nextCursor: string | null;
}

/**
 * `POST /api/v1/layouts` on success — the created layout, plus whether its
 * preview rendered on the way out. `previewReady: false` is not a failure: the
 * layout is stored either way and the image is retried on first request.
 */
export interface SubmitLayoutBody extends PublicLayoutDetail {
  previewReady: boolean;
}
