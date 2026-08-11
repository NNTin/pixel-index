import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { AJV_OPTIONS } from '../server.js';
import { listLayoutsQuerySchema } from './schemas.js';

/**
 * The handlers dropped their `?? 24` / `?? 'newest'` fallbacks once the
 * schema-derived types showed them to be dead: the schema declares the defaults
 * and ajv applies them before the handler runs. That is a property of the
 * schema *and* of how the server compiles it, so this asserts both together —
 * the real exported schema, compiled with the real exported ajv options, rather
 * than a copy of either.
 *
 * Deliberately not an end-to-end pagination test: proving a default of 24
 * through the API means inserting 25 layouts and standing up a database and a
 * server, which pushed the file it lived in over vitest's per-test timeout
 * under parallel load. This tests the mechanism the handlers actually depend on.
 */
describe('listLayoutsQuerySchema, as the server compiles it', () => {
  it('applies limit and sort defaults to a request that omits them', async () => {
    const app = Fastify({ ajv: AJV_OPTIONS });
    app.get('/probe', { schema: { querystring: listLayoutsQuerySchema } }, (request) => request.query);
    try {
      const response = await app.inject({ method: 'GET', url: '/probe' });
      expect(response.json()).toEqual({ limit: 24, sort: 'newest' });
    } finally {
      await app.close();
    }
  });

  it('leaves an explicit value alone', async () => {
    const app = Fastify({ ajv: AJV_OPTIONS });
    app.get('/probe', { schema: { querystring: listLayoutsQuerySchema } }, (request) => request.query);
    try {
      const response = await app.inject({ method: 'GET', url: '/probe?limit=5&sort=title' });
      expect(response.json()).toEqual({ limit: 5, sort: 'title' });
    } finally {
      await app.close();
    }
  });
});
