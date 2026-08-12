/**
 * The JSON Schemas Fastify validates requests against and serializes
 * responses with — and, via @fastify/swagger, exactly what the OpenAPI
 * document describes. One definition, so "the doc matches actual responses"
 * (#6's own acceptance criterion) holds by construction rather than by
 * someone remembering to update two places.
 */

export const publicAuthorSchema = {
  $id: 'PublicAuthor',
  type: 'object',
  properties: {
    id: { type: ['string', 'null'], format: 'uuid' },
    username: { type: 'string' },
    displayName: { type: 'string' },
    avatarUrl: { type: ['string', 'null'] },
  },
  required: ['id', 'username', 'displayName', 'avatarUrl'],
} as const;

const filesSchema = {
  type: 'object',
  properties: {
    layout: { type: 'string' },
    preview: { type: 'string' },
    thumbnail: { type: 'string' },
  },
  required: ['layout', 'preview', 'thumbnail'],
} as const;

export const layoutSummarySchema = {
  $id: 'LayoutSummary',
  type: 'object',
  properties: {
    slug: { type: 'string' },
    title: { type: 'string' },
    author: { $ref: 'PublicAuthor#' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    cols: { type: 'integer' },
    rows: { type: 'integer' },
    visibleCols: { type: 'integer' },
    visibleRows: { type: 'integer' },
    furniture: { type: 'integer' },
    areas: { type: 'integer' },
    pets: { type: 'integer' },
    carpets: { type: 'integer' },
    seats: { type: 'integer' },
    layoutRevision: { type: 'integer' },
    pixelAgentsVersion: { type: ['string', 'null'] },
    bytes: { type: 'integer' },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    files: filesSchema,
  },
  required: [
    'slug', 'title', 'author', 'description', 'tags', 'cols', 'rows', 'visibleCols',
    'visibleRows', 'furniture', 'areas', 'pets', 'carpets', 'seats', 'layoutRevision',
    'pixelAgentsVersion', 'bytes', 'sha256', 'createdAt', 'updatedAt', 'files',
  ],
} as const;

export const layoutDetailSchema = {
  $id: 'LayoutDetail',
  type: 'object',
  allOf: [
    { $ref: 'LayoutSummary#' },
    {
      type: 'object',
      properties: {
        // The layout's shape is defined by Pixel Agents, not by us.
        layout: { type: 'object', additionalProperties: true },
      },
      required: ['layout'],
    },
  ],
} as const;

export const sharedSchemas = [publicAuthorSchema, layoutSummarySchema, layoutDetailSchema] as const;

export const listLayoutsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
    cursor: { type: 'string' },
    sort: { type: 'string', enum: ['newest', 'furniture', 'largest', 'title'], default: 'newest' },
    author: { type: 'string', format: 'uuid' },
    tags: { type: 'string', description: 'Comma-separated tag names; a layout must have all of them.' },
    q: { type: 'string', maxLength: 200 },
    // The declared canvas allocation, not the occupied footprint — see
    // minSize/maxSize below for the latter. Kept as its own filter because
    // furniture placement is absolute against the full canvas.
    minCols: { type: 'integer', minimum: 0 },
    maxCols: { type: 'integer', minimum: 0 },
    minRows: { type: 'integer', minimum: 0 },
    maxRows: { type: 'integer', minimum: 0 },
    minSize: {
      type: 'integer',
      minimum: 0,
      description: 'Occupied-footprint tile count (visibleCols × visibleRows), inclusive.',
    },
    maxSize: {
      type: 'integer',
      minimum: 0,
      description: 'Occupied-footprint tile count (visibleCols × visibleRows), inclusive.',
    },
    minFurniture: { type: 'integer', minimum: 0 },
    maxFurniture: { type: 'integer', minimum: 0 },
    minAreas: { type: 'integer', minimum: 0 },
    maxAreas: { type: 'integer', minimum: 0 },
    minPets: { type: 'integer', minimum: 0 },
    maxPets: { type: 'integer', minimum: 0 },
    minSeats: { type: 'integer', minimum: 0 },
    maxSeats: { type: 'integer', minimum: 0 },
  },
} as const;

export const listLayoutsResponseSchema = {
  200: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer' },
      total: { type: 'integer' },
      layouts: { type: 'array', items: { $ref: 'LayoutSummary#' } },
      nextCursor: { type: ['string', 'null'] },
    },
    required: ['schemaVersion', 'total', 'layouts', 'nextCursor'],
  },
} as const;

export const slugParamsSchema = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' } },
  required: ['slug'],
} as const;

export const layoutDetailResponseSchema = {
  200: { $ref: 'LayoutDetail#' },
} as const;

export const metaResponseSchema = {
  200: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer' },
      generatedAt: { type: 'string', format: 'date-time' },
      pixelAgents: {
        type: 'object',
        properties: {
          version: { type: ['string', 'null'] },
          commit: { type: ['string', 'null'] },
          layoutRevision: { type: 'integer' },
        },
        required: ['version', 'commit', 'layoutRevision'],
      },
      count: { type: 'integer' },
      discordInviteUrl: { type: ['string', 'null'] },
    },
    required: ['schemaVersion', 'generatedAt', 'pixelAgents', 'count', 'discordInviteUrl'],
  },
} as const;

export const listTagsResponseSchema = {
  200: {
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer' },
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, count: { type: 'integer' } },
          required: ['name', 'count'],
        },
      },
    },
    required: ['schemaVersion', 'tags'],
  },
} as const;
