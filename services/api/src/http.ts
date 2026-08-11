/**
 * Route types derived from the JSON Schemas the routes already carry.
 *
 * Every handler used to restate its schema as an interface and cast to it —
 * `request.query as ListQuery` next to a `listQuerySchema` saying the same
 * thing. Two descriptions of one contract, kept in sync by hand, and nothing
 * anywhere would notice them drifting apart.
 *
 * `RequestSchemas` is the request half of `@fastify/type-provider-json-schema-to-ts`.
 * Its stock provider also infers the *response* type, which is wrong here:
 * this API's response schemas `$ref` into components registered on the
 * serializer at boot (`LayoutSummary#`, `PublicAuthor#`), and `FromSchema`
 * cannot follow a reference it was not handed — it reads
 * `items: { $ref: 'LayoutSummary#' }` as the empty tuple, so a handler
 * returning any layouts at all fails to typecheck.
 *
 * Declaring `serializer: unknown` says that plainly. Handlers state their
 * response type themselves, as an exported body type the response tests import
 * (see `layouts/responses.ts`), which is what keeps that half honest.
 */

import type { FastifyTypeProvider } from 'fastify';
import type { FromSchema, JSONSchema } from 'json-schema-to-ts';

export interface RequestSchemas extends FastifyTypeProvider {
  validator: this['schema'] extends JSONSchema ? FromSchema<this['schema']> : unknown;
  serializer: unknown;
}
