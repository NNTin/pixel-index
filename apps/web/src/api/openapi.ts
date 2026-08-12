/**
 * A deliberately loose read of `GET /openapi.json` (#32) — just enough of
 * OpenAPI 3.1 to render a human-readable reference from whatever the API's
 * routes actually declared, not a full spec implementation. `services/api`
 * generates this from live route schemas (see its `layouts/schemas.ts`), so
 * this stays honest to what is really there rather than a hand-maintained
 * guess that can drift from it.
 */

export interface OpenApiSchema {
  type?: string | string[];
  $ref?: string;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  allOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<string, OpenApiResponse>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

/** One `{ method, operation }` row per HTTP method a path actually declares, in a stable order. */
export function operationsOf(pathItem: OpenApiPathItem): { method: HttpMethod; operation: OpenApiOperation }[] {
  const rows: { method: HttpMethod; operation: OpenApiOperation }[] = [];
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (operation !== undefined) rows.push({ method, operation });
  }
  return rows;
}

/** `#/components/schemas/LayoutSummary` -> `LayoutSummary`. */
function refName($ref: string): string {
  return $ref.slice($ref.lastIndexOf('/') + 1);
}

/**
 * A short, one-line type label for a schema — `LayoutSummary[]`, `object`,
 * `"newest" | "furniture" | …`, `integer` — good enough for a reference table
 * cell. Not a renderer for the full shape; a $ref'd schema's own properties
 * are one click away in the linked interactive docs.
 */
export function describeSchema(schema: OpenApiSchema | undefined): string {
  if (!schema) return '—';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.allOf) return schema.allOf.map(describeSchema).join(' & ');
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.type === 'array') return `${describeSchema(schema.items)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type ?? 'object';
}

/** Every top-level property of a request/response body schema, as `name: type` pairs. */
export function bodyFields(schema: OpenApiSchema | undefined): { name: string; type: string }[] {
  const properties = schema?.properties ?? (schema?.allOf ?? []).find((part) => part.properties)?.properties;
  if (!properties) return [];
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    type: describeSchema(propertySchema),
  }));
}
