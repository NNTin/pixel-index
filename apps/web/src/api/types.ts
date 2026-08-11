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
  displayName: string;
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
  seats: number;
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
  minSize?: number;
  maxSize?: number;
  minFurniture?: number;
  maxFurniture?: number;
  minPets?: number;
  maxPets?: number;
  minSeats?: number;
  maxSeats?: number;
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
  discordInviteUrl: string | null;
}

export interface TagUsage {
  name: string;
  count: number;
}

export interface ListTagsResponse {
  schemaVersion: number;
  tags: TagUsage[];
}

// ─── Auth (#7, #15) ──────────────────────────────────────────────────────

export type Role = 'user' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  capabilityCheckedAt: string | null;
  capabilityCacheTtlMs: number;
  submission: {
    allowed: boolean;
    reason: 'discord_membership_required' | 'discord_reauthorization_required' | null;
    inviteUrl: string | null;
  };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInMs: number;
}

export interface TokenExchangeResponse extends TokenPair {
  user: AuthUser;
}

// ─── Owner self-service (#9, #15) ───────────────────────────────────────

export interface OwnerLayoutView extends LayoutDetail {
  visibility: 'public' | 'hidden' | 'removed' | 'deleted';
  visibilityReason: string | null;
  visibilityChangedAt: string | null;
}

export interface ListOwnerLayoutsResponse {
  schemaVersion: number;
  total: number;
  layouts: OwnerLayoutView[];
  nextCursor: string | null;
}

export interface SubmitLayoutParams {
  title: string;
  description?: string;
  tags?: string;
}

export interface PatchLayoutBody {
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: 'public' | 'hidden' | 'removed';
  reason?: string;
}

// ─── Moderation & admin (#10, #15) ──────────────────────────────────────

export interface ListModerationLayoutsParams {
  limit?: number;
  cursor?: string;
  sort?: 'newest' | 'furniture' | 'largest' | 'title';
  visibility?: 'public' | 'hidden' | 'removed' | 'deleted';
  author?: string;
  q?: string;
}

export interface AdminUserView {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  capability: Role;
  capabilityCheckedAt: string | null;
  layoutCount: number;
}

export interface ListAdminUsersResponse {
  users: AdminUserView[];
  nextCursor: string | null;
}

export interface PublicAuthorResponse {
  schemaVersion: number;
  author: PublicAuthor;
  publicLayoutCount: number;
}
