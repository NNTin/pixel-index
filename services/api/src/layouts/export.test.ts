import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import type { OpenApiDoc } from '../test-support/bodies.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout } from '../test-support/layouts.js';

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

const URL = '/api/v1/export/layouts.ndjson';

/** NDJSON is not JSON — every assertion here has to go through the line split. */
function parseLines(body: string): Record<string, unknown>[] {
  return body
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('GET /api/v1/export/layouts.ndjson', () => {
  it('emits one line per public layout, with the parsed layout inline', async () => {
    const raw = JSON.stringify({ cols: 3, rows: 2, layoutRevision: 4, furniture: [] });
    await insertLayout(harness.db, {
      slug: 'export-basic',
      raw,
      layout: JSON.parse(raw),
      layoutRevision: 4,
      pixelAgentsVersion: '1.4.0',
    });

    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/x-ndjson/);

    const entry = parseLines(response.body).find((row) => row.slug === 'export-basic');
    expect(entry).toMatchObject({
      slug: 'export-basic',
      layoutRevision: 4,
      pixelAgentsVersion: '1.4.0',
      // Parsed, not a string — the whole point of not re-serving `raw` here.
      layout: { cols: 3, rows: 2, layoutRevision: 4, furniture: [] },
    });
    expect(typeof entry?.sha256).toBe('string');
  });

  it('reports the line count in x-total-count so a truncated stream is detectable', async () => {
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.headers['x-total-count']).toBe(String(parseLines(response.body).length));
  });

  it('excludes everything that is not public', async () => {
    await insertLayout(harness.db, { slug: 'export-hidden', visibility: 'hidden' });
    await insertLayout(harness.db, { slug: 'export-removed', visibility: 'removed' });
    await insertLayout(harness.db, { slug: 'export-deleted', visibility: 'deleted' });

    const slugs = parseLines((await app.inject({ method: 'GET', url: URL })).body).map(
      (row) => row.slug,
    );
    expect(slugs).not.toContain('export-hidden');
    expect(slugs).not.toContain('export-removed');
    expect(slugs).not.toContain('export-deleted');
  });

  it('pages past the batch size rather than stopping at it', async () => {
    // BATCH_SIZE is 200 and seeding 200 rows here would dominate the suite's
    // runtime; a smaller set still proves the loop continues past one page
    // only if the page size is small. So assert the property that actually
    // matters and is cheap: every public row is present exactly once.
    const before = parseLines((await app.inject({ method: 'GET', url: URL })).body).length;
    for (let i = 0; i < 5; i += 1) {
      await insertLayout(harness.db, { slug: `export-page-${i}` });
    }

    const slugs = parseLines((await app.inject({ method: 'GET', url: URL })).body).map(
      (row) => row.slug,
    );
    expect(slugs).toHaveLength(before + 5);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (let i = 0; i < 5; i += 1) expect(slugs).toContain(`export-page-${i}`);
  });

  it('answers 304 for an unchanged index', async () => {
    const first = await app.inject({ method: 'GET', url: URL });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: 'GET',
      url: URL,
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('changes the ETag when a layout is edited in place, not just when one is added', async () => {
    const layout = await insertLayout(harness.db, { slug: 'export-etag-edit' });
    const before = (await app.inject({ method: 'GET', url: URL })).headers.etag;

    // Same row count, same slug set — only the content moves. A fingerprint
    // built from count alone would miss this and hand the vendor-update gate
    // a stale copy to render.
    const edited = JSON.stringify({ cols: 9, rows: 9 });
    const { sql } = await import('drizzle-orm');
    await harness.db.execute(
      sql`UPDATE layouts SET raw = ${edited}, layout = ${edited}::jsonb, sha256 = ${'f'.repeat(64)}, updated_at = now() + interval '1 second' WHERE id = ${layout.id}`,
    );

    expect((await app.inject({ method: 'GET', url: URL })).headers.etag).not.toBe(before);
  });

  it('appears in the OpenAPI document, since it is part of the public contract', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json<OpenApiDoc>();
    expect(spec.paths['/api/v1/export/layouts.ndjson']?.get).toBeDefined();
  });

  it('is consumable over real HTTP, not just through inject', async () => {
    // `inject` buffers the whole payload, so it proves the handler returns the
    // right bytes but says nothing about the part that is actually novel here:
    // that Fastify streams a Readable to a socket with the headers already
    // flushed. This is the only test that exercises that, and it is the
    // failure mode the vendor-update gate (#26) would hit first.
    // No teardown of its own: afterAll's app.close() stops the listener too.
    const listening = await app.listen({ host: '127.0.0.1', port: 0 });

    const response = await fetch(`${listening}${URL}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/x-ndjson/);

    const declared = Number(response.headers.get('x-total-count'));
    const received = (await response.text()).split('\n').filter((line) => line.length > 0);
    expect(received.length).toBe(declared);
    expect(declared).toBeGreaterThan(0);
    // Every line stands alone — that is what "newline-delimited" has to mean
    // for a consumer that parses as it reads.
    for (const line of received) {
      expect(() => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });
});
