import { bundledLayoutRevision, sha256 } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';

const config = testConfig({
  // Isolated from every other test file's write-bucket assumptions.
  writeRateLimit: { max: 1000, windowMs: 60_000 },
});
const fakePool = { query: async () => ({ rows: [] }) };
const BUNDLED_REVISION = bundledLayoutRevision();

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
afterEach(() => vi.unstubAllGlobals());

// Unique per call by default, via an extra top-level field the (deliberately
// permissive) layout schema tolerates — otherwise every test using the
// default layout would produce byte-identical content and collide with the
// dedupe check this same route enforces. Tests that specifically exercise
// dedupe construct their own explicit, intentionally-shared `raw` string
// instead of calling this.
let marker = 0;
function validLayoutJson(overrides: Record<string, unknown> = {}): string {
  marker += 1;
  return JSON.stringify({
    version: 1,
    layoutRevision: BUNDLED_REVISION,
    cols: 4,
    rows: 4,
    tiles: Array(16).fill(0),
    furniture: [],
    testMarker: marker,
    ...overrides,
  });
}

async function tokenFor(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(harness.db, overrides);
  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
  return { user, accessToken };
}

function submit(
  query: string,
  body: string,
  headers: Record<string, string> = {},
  fetchStub: 'ok' | 'down' = 'ok',
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fetchStub === 'ok'
        ? new Response(Buffer.from([137, 80, 78, 71]), {
            status: 200,
            headers: { 'content-type': 'image/png', etag: '"fake"' },
          })
        : Promise.reject(new Error('renderer unreachable')),
    ),
  );
  return app.inject({
    method: 'POST',
    url: `/api/v1/layouts?${query}`,
    payload: body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('POST /api/v1/layouts — authentication', () => {
  it('is impossible anonymously', async () => {
    const response = await submit('title=Anon+Attempt', validLayoutJson());
    expect(response.statusCode).toBe(401);
  });

  it('rejects a blocked user', async () => {
    const { accessToken } = await tokenFor({ blockedAt: new Date(), blockedReason: 'testing' });
    const response = await submit('title=Blocked+User', validLayoutJson(), {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/v1/layouts — the happy path', () => {
  it('is publicly listed immediately', async () => {
    const { accessToken, user } = await tokenFor({ username: 'happy-path' });
    const response = await submit(
      'title=My+New+Office&description=cosy&tags=cosy,small',
      validLayoutJson(),
      { authorization: `Bearer ${accessToken}` },
    );
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.slug).toBeTruthy();
    expect(body.title).toBe('My New Office');
    expect(body.author).toEqual({ id: user.id, username: 'happy-path', avatarUrl: null });
    expect(body.tags.sort()).toEqual(['cosy', 'small']);
    expect(response.headers.location).toBe(`/api/v1/layouts/${body.slug}`);

    const listed = await app.inject({ method: 'GET', url: `/api/v1/layouts/${body.slug}` });
    expect(listed.statusCode).toBe(200);
  });

  it('stores the layout byte-for-byte, including unusual whitespace', async () => {
    const { accessToken } = await tokenFor();
    const raw = `{"version": 1,\n  "layoutRevision":  ${BUNDLED_REVISION},\n"cols":2,"rows":2,"tiles":[0,0,0,0],"furniture":[]}`;
    const response = await submit('title=Byte+Exact', raw, { authorization: `Bearer ${accessToken}` });
    expect(response.statusCode).toBe(201);
    const slug = response.json().slug;

    const download = await app.inject({ method: 'GET', url: `/api/v1/layouts/${slug}/download` });
    expect(download.body).toBe(raw);
  });

  it('records the pixel_agents_version it validated against', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit('title=Version+Recorded', validLayoutJson(), {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.json().pixelAgentsVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marks previewReady true when the renderer succeeds, and warms it without blocking success when it fails', async () => {
    const { accessToken: tokenA } = await tokenFor();
    const ok = await submit('title=Preview+Ok', validLayoutJson(), {
      authorization: `Bearer ${tokenA}`,
    });
    expect(ok.json().previewReady).toBe(true);

    const { accessToken: tokenB } = await tokenFor();
    const down = await submit(
      'title=Preview+Down',
      validLayoutJson(),
      { authorization: `Bearer ${tokenB}` },
      'down',
    );
    // Publication succeeds regardless — a secondary feature (preview) being
    // down must never take down the core one (submission).
    expect(down.statusCode).toBe(201);
    expect(down.json().previewReady).toBe(false);
  });
});

describe('POST /api/v1/layouts — layout-core validation', () => {
  it('maps a schema failure to 422 with a field-level message', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit(
      'title=Bad+Tiles',
      validLayoutJson({ tiles: [0, 0] }), // 4 declared by cols*rows, 2 provided
      { authorization: `Bearer ${accessToken}` },
    );
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('validation_error');
    expect(body.issues.some((i: { code: string }) => i.code === 'layout.grid.tiles_mismatch')).toBe(
      true,
    );
  });

  it('rejects unknown furniture with a message naming the id', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit(
      'title=Bad+Furniture',
      validLayoutJson({ furniture: [{ type: 'NOT_A_REAL_THING', col: 0, row: 0 }] }),
      { authorization: `Bearer ${accessToken}` },
    );
    expect(response.statusCode).toBe(422);
    const issue = response.json().issues.find((i: { code: string }) => i.code === 'layout.furniture.unknown');
    expect(issue.message).toContain('NOT_A_REAL_THING');
  });

  it('rejects a layoutRevision below the bundled default, explaining why it would break', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit(
      'title=Stale+Revision',
      validLayoutJson({ layoutRevision: Math.max(0, BUNDLED_REVISION - 1) }),
      { authorization: `Bearer ${accessToken}` },
    );
    expect(response.statusCode).toBe(422);
    const issue = response
      .json()
      .issues.find((i: { code: string }) => i.code === 'layout.revision.below_bundled');
    expect(issue.message).toMatch(/discarded on the next start/);
    expect(issue.message).toMatch(/Re-export it/);
  });

  it('rejects invalid JSON with 400, not 422', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit('title=Not+JSON', '{not valid json', {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/v1/layouts — dedupe', () => {
  it('rejects resubmitting the exact same bytes as a public layout, naming its slug', async () => {
    const raw = validLayoutJson({ cols: 5, rows: 5, tiles: Array(25).fill(0) });
    const { accessToken: first } = await tokenFor();
    const original = await submit('title=Original+Office', raw, { authorization: `Bearer ${first}` });
    expect(original.statusCode).toBe(201);

    const { accessToken: second } = await tokenFor();
    const dupe = await submit('title=Copycat+Office', raw, { authorization: `Bearer ${second}` });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().message).toContain(original.json().slug);
  });

  it('rejects resubmitting content matching a non-public (e.g. removed) layout, without laundering it back', async () => {
    // The exact property #3's schema comment names: re-uploading
    // moderator-removed content must not launder it back onto the front page.
    const raw = JSON.stringify({
      version: 1,
      layoutRevision: BUNDLED_REVISION,
      cols: 3,
      rows: 3,
      tiles: Array(9).fill(0),
      furniture: [],
    });
    await insertLayout(harness.db, {
      slug: 'previously-removed',
      raw,
      layout: JSON.parse(raw),
      sha256: sha256(raw),
      visibility: 'removed',
    });

    const { accessToken } = await tokenFor();
    const response = await submit('title=Resubmit+Attempt', raw, {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).not.toContain('previously-removed'); // does not confirm the slug
  });
});

describe('POST /api/v1/layouts — slugs', () => {
  it('is stable and collision-safe: same title twice gets two different slugs', async () => {
    const { accessToken: a } = await tokenFor();
    const first = await submit(
      'title=Duplicate+Title',
      validLayoutJson({ cols: 6, rows: 6, tiles: Array(36).fill(0) }),
      { authorization: `Bearer ${a}` },
    );
    const { accessToken: b } = await tokenFor();
    const second = await submit(
      'title=Duplicate+Title',
      validLayoutJson({ cols: 7, rows: 7, tiles: Array(49).fill(0) }),
      { authorization: `Bearer ${b}` },
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().slug).not.toBe(second.json().slug);
    expect(second.json().slug).toBe(`${first.json().slug}-2`);
  });
});

describe('POST /api/v1/layouts — tags', () => {
  it('rejects a malformed tag with 422', async () => {
    const { accessToken } = await tokenFor();
    const response = await submit('title=Bad+Tag&tags=Not_Kebab', validLayoutJson(), {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects more than 8 tags', async () => {
    const { accessToken } = await tokenFor();
    const tags = Array.from({ length: 9 }, (_, i) => `tag-${i}`).join(',');
    const response = await submit(`title=Too+Many+Tags&tags=${tags}`, validLayoutJson(), {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('POST /api/v1/layouts — size and rate limits', () => {
  it('rejects a layout over MAX_LAYOUT_BYTES with 413', async () => {
    const smallLimitApp = await buildServer({
      config: testConfig({ maxLayoutBytes: 100 }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const { accessToken } = await tokenFor();
      vi.stubGlobal('fetch', vi.fn());
      const response = await smallLimitApp.inject({
        method: 'POST',
        url: '/api/v1/layouts?title=Too+Big',
        payload: validLayoutJson({ furniture: Array(50).fill({ type: 'x', col: 0, row: 0 }) }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      });
      expect(response.statusCode).toBe(413);
    } finally {
      await smallLimitApp.close();
    }
  });

  it('enforces the per-user daily submission cap', async () => {
    const cappedApp = await buildServer({
      config: testConfig({ maxSubmissionsPerUserPerDay: 1, writeRateLimit: { max: 1000, windowMs: 60_000 } }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const { accessToken } = await tokenFor({ username: 'daily-cap' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(Buffer.from([137, 80, 78, 71]), { status: 200 })),
      );
      const first = await cappedApp.inject({
        method: 'POST',
        url: '/api/v1/layouts?title=First+Today',
        payload: validLayoutJson({ cols: 8, rows: 8, tiles: Array(64).fill(0) }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      });
      expect(first.statusCode).toBe(201);

      const second = await cappedApp.inject({
        method: 'POST',
        url: '/api/v1/layouts?title=Second+Today',
        payload: validLayoutJson({ cols: 9, rows: 9, tiles: Array(81).fill(0) }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      });
      expect(second.statusCode).toBe(429);
      expect(second.json().error).toBe('too_many_submissions');
    } finally {
      await cappedApp.close();
    }
  });

  it('enforces the write rate-limit bucket', async () => {
    const throttledApp = await buildServer({
      config: testConfig({ writeRateLimit: { max: 1, windowMs: 60_000 } }),
      pool: fakePool,
      db: harness.db,
    });
    try {
      const { accessToken } = await tokenFor();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(Buffer.from([137, 80, 78, 71]), { status: 200 })),
      );
      const first = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/layouts?title=Rate+Limit+A',
        payload: validLayoutJson({ cols: 10, rows: 10, tiles: Array(100).fill(0) }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      });
      expect(first.statusCode).toBe(201);

      const second = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/layouts?title=Rate+Limit+B',
        payload: validLayoutJson({ cols: 11, rows: 11, tiles: Array(121).fill(0) }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      });
      expect(second.statusCode).toBe(429);
    } finally {
      await throttledApp.close();
    }
  });
});

describe('the raw-body content-type parser stays scoped to this route', () => {
  it('does not affect other application/json routes', async () => {
    // A regression guard: this route deliberately overrides Fastify's default
    // application/json parser to preserve exact bytes. If that override ever
    // leaked out of its encapsulated plugin, every other JSON route (starting
    // with auth's) would receive a raw string instead of a parsed body.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { code: 'whatever' },
    });
    // 401 (invalid code) proves the body was parsed into an object and read
    // as JSON — a raw string would have failed differently (schema/400).
    expect(response.statusCode).toBe(401);
  });
});
