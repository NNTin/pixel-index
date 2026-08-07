/**
 * Hand-written against `services/api/src/layouts/schemas.ts` — the single
 * source of truth Fastify validates requests/responses against and
 * `@fastify/swagger` derives `/openapi.json` from (#6). Checked, not
 * generated: the API is small enough right now that a generator step would
 * be more ceremony than the two shapes below are worth. If that stops being
 * true, revisit — `LayoutSummary` and `LayoutDetail` are named to match the
 * OpenAPI document's own schema names on purpose, so a future codegen swap
 * doesn't have to rename anything downstream.
 */

export interface PublicAuthor {
  id: string | null;
  username: string;
  avatarUrl: string | null;
}

export interface LayoutFiles {
  layout: string;
  preview: string;
  thumbnail: string;
}

export interface LayoutSummary {
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
  files: LayoutFiles;
}

export interface LayoutDetail extends LayoutSummary {
  layout: unknown;
}

export interface ListLayoutsResponse {
  schemaVersion: number;
  total: number;
  layouts: LayoutSummary[];
  nextCursor: string | null;
}

export interface ListLayoutsParams {
  limit?: number;
  cursor?: string;
  sort?: 'newest' | 'furniture' | 'largest' | 'title';
  author?: string;
  tags?: string;
  q?: string;
  minCols?: number;
  maxCols?: number;
  minRows?: number;
  maxRows?: number;
  minFurniture?: number;
  maxFurniture?: number;
  minPets?: number;
  maxPets?: number;
}

export interface MetaResponse {
  schemaVersion: number;
  generatedAt: string;
  pixelAgents: {
    version: string | null;
    commit: string | null;
    layoutRevision: number;
  };
  count: number;
}

export interface TagUsage {
  name: string;
  count: number;
}

export interface ListTagsResponse {
  schemaVersion: number;
  tags: TagUsage[];
}
