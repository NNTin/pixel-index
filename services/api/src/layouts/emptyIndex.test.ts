/**
 * What the public read endpoints do with nothing published yet.
 *
 * Its own file, and its own database, because that is the cheap way to have
 * one: every other suite in this workspace inserts fixtures into a shared
 * harness, so an "empty index" assertion living inside one of them had to stand
 * up a *second* database. Three of those existed — two in `routes.test.ts`, one
 * in `export.test.ts` — and they were the tests that flaked, because a real
 * Postgres takes about a second to boot and that came out of the same budget as
 * the assertion itself.
 *
 * Gathering them here costs one database instead of three, and the grouping is
 * the honest one: this is a first-run/quiet-index contract, not a detail of
 * listing or of export.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import type { ListLayoutsBody, ListTagsBody } from './responses.js';

const config = testConfig();
const fakePool = { query: async () => ({ rows: [] }) };

let harness: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({ config, pool: fakePool, db: harness.db });
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

describe('an index with nothing in it', () => {
  it('lists no layouts cleanly, not an error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/layouts' });
    expect(response.statusCode).toBe(200);
    expect(response.json<ListLayoutsBody>()).toEqual({
      schemaVersion: 1,
      total: 0,
      layouts: [],
      nextCursor: null,
    });
  });

  it('lists no tags cleanly', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(response.statusCode).toBe(200);
    expect(response.json<ListTagsBody>().tags).toEqual([]);
  });

  it('streams an empty export as an empty body, not an error and not "[]"', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/export/layouts.ndjson' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['x-total-count']).toBe('0');
    // An empty set still needs a matchable ETag, or every poll of a quiet
    // index re-scans instead of getting a 304.
    expect(response.headers.etag).toBeDefined();
  });
});
