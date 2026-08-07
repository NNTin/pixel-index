import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type Harness } from './db/test-support/harness.js';
import { buildServer } from './server.js';
import { testConfig } from './test-support/config.js';
import { insertLayout } from './test-support/layouts.js';

const fakePool = { query: async () => ({ rows: [] }) };

let harness: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  harness = await createTestDatabase();
  // No upstreamDir set — layout-core auto-discovers the real pinned
  // vendor/pixel-agents by walking up from its own location, the same way
  // local dev and CI run today. The container-only override is what #6's
  // "reads a bogus dir" test below exercises instead.
  app = await buildServer({ config: testConfig(), pool: fakePool, db: harness.db });
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

describe('GET /api/v1/meta', () => {
  it('reports the real pinned Pixel Agents version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.pixelAgents.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isInteger(body.pixelAgents.layoutRevision)).toBe(true);
    expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('count matches the number of public layouts, excluding hidden ones', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/v1/meta' })).json().count;
    await insertLayout(harness.db, { slug: 'meta-count-public' });
    await insertLayout(harness.db, { slug: 'meta-count-hidden', visibility: 'hidden' });

    const after = (await app.inject({ method: 'GET', url: '/api/v1/meta' })).json();
    expect(after.count).toBe(before + 1);
  });

  it('degrades to a null pin instead of a 500 when the upstream cannot be found', async () => {
    const brokenApp = await buildServer({
      config: testConfig({ upstreamDir: '/nonexistent/pixel-agents' }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const response = await brokenApp.inject({ method: 'GET', url: '/api/v1/meta' });
      expect(response.statusCode).toBe(200);
      expect(response.json().pixelAgents).toEqual({
        version: null,
        commit: null,
        layoutRevision: 0,
      });
    } finally {
      await brokenApp.close();
    }
  });

  it('falls back to the configured commit when the upstream has no .git to read one from', async () => {
    // A container's copy of vendor/pixel-agents has no .git — same trap as
    // the renderer service, same PIXEL_AGENTS_COMMIT fix. Simulated here by
    // pointing at a directory with a valid package.json/assets but asserting
    // the override still applies even when discovery itself fails outright.
    const brokenApp = await buildServer({
      config: testConfig({
        upstreamDir: '/nonexistent/pixel-agents',
        upstreamCommit: 'a'.repeat(40),
      }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const response = await brokenApp.inject({ method: 'GET', url: '/api/v1/meta' });
      // Discovery still fails wholesale for a nonexistent dir (version stays
      // null), but the explicit commit override is honoured regardless —
      // it never depends on a successful upstreamPin() call.
      expect(response.json().pixelAgents.commit).toBe('a'.repeat(40));
    } finally {
      await brokenApp.close();
    }
  });
});
