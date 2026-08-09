import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

  it('reports the commit from the stamp beside a checkout with no readable git', async () => {
    // What a container actually is: a copied vendor/ tree whose .git points at
    // a gitdir that was never copied. The pin travels as a sibling file, so
    // this is the path every deployed image takes — it used to be a
    // PIXEL_AGENTS_COMMIT build argument nobody remembered to pass, and every
    // image reported commit: null as a result.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-stamp-'));
    const upstreamDir = path.join(dir, 'pixel-agents');
    fs.mkdirSync(path.join(upstreamDir, 'webview-ui/public/assets'), { recursive: true });
    fs.writeFileSync(path.join(upstreamDir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    fs.writeFileSync(
      path.join(upstreamDir, 'webview-ui/public/assets/default-layout-3.json'),
      JSON.stringify({ layoutRevision: 3 }),
    );
    fs.writeFileSync(`${upstreamDir}.commit`, `${'a'.repeat(40)}\n`);

    const stampedApp = await buildServer({
      config: testConfig({ upstreamDir }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const response = await stampedApp.inject({ method: 'GET', url: '/api/v1/meta' });
      expect(response.json().pixelAgents).toEqual({
        version: '9.9.9',
        commit: 'a'.repeat(40),
        layoutRevision: 3,
      });
    } finally {
      await stampedApp.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
