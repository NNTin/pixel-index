import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from './auth/context.js';
import type { AnyDatabase } from './db/client.js';
import type { ApiConfig } from './config.js';
import { ApiError } from './errors.js';
import { buildServer } from './server.js';
import { testConfig } from './test-support/config.js';

/** A pool stub. Nothing here touches a real Postgres. */
function fakePool(behaviour: 'up' | 'down' | 'slow' = 'up') {
  return {
    query: vi.fn(async () => {
      if (behaviour === 'down') throw new Error('connection refused');
      if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 10_000));
      return { rows: [{ '?column?': 1 }] };
    }),
  };
}

/**
 * None of the tests in this file exercise an auth route, so `db` is never
 * actually queried — a typed stand-in keeps `buildServer`'s signature honest
 * without pulling PGlite into a file that is otherwise DB-free. Auth routes
 * are covered against a real (in-memory) database in auth/routes.test.ts.
 */
const unusedDb = {} as AnyDatabase;

let apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.map((app) => app.close()));
  apps = [];
});

async function build(config: ApiConfig = testConfig(), pool = fakePool(), db = unusedDb) {
  const app = await buildServer({ config, pool, db });
  apps.push(app);
  return app;
}

describe('health and readiness', () => {
  it('/health is always ok — liveness only', async () => {
    const app = await build();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/ready is ok when Postgres answers', async () => {
    const app = await build(testConfig(), fakePool('up'));
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
  });

  it('/ready fails when Postgres is unreachable', async () => {
    // The acceptance criterion this exists to satisfy: a health check that
    // always returns 200 is how a broken container stays in a load balancer.
    const app = await build(testConfig(), fakePool('down'));
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'unavailable' });
  });

  it('/ready fails fast rather than hanging on a stuck query', async () => {
    const app = await build(testConfig(), fakePool('slow'));
    const start = Date.now();
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('CORS', () => {
  it('reflects an allowlisted origin and allows credentials', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://pixel-index.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://pixel-index.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('reflects a second allowlisted origin too — not just the first', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://preview.pixel-index.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://preview.pixel-index.example',
    );
  });

  it('does not grant an unlisted origin CORS access', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    // The request itself still completes (Fastify doesn't refuse it), but
    // without the header a real browser enforces same-origin and blocks the
    // response from ever reaching the page's JS.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reflects a preview origin matched by pattern — a Vercel deploy hostname is never listable (#28)', async () => {
    const app = await build(
      testConfig({
        webOriginPatterns: [
          { source: 'https://pixel-index-*-acme.vercel.app', matcher: /^https:\/\/pixel-index-[a-z0-9-]+-acme\.vercel\.app$/ },
        ],
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://pixel-index-699uclg0a-acme.vercel.app' },
    });
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://pixel-index-699uclg0a-acme.vercel.app',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers a preflight for an allowlisted origin', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://pixel-index.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe('https://pixel-index.example');
  });

  it('a request with no Origin header (server-to-server, curl) is unaffected', async () => {
    const app = await build();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  // Found live (#15): without an explicit `methods` list, @fastify/cors
  // derived a preflight's Allow-Methods header from whatever it introspected
  // off the request path rather than a fixed set — PATCH/PUT/DELETE came
  // back missing even though the actual routes existed, so a real browser
  // silently blocked every edit/moderate/delete/role/block call before it
  // ever reached the server. `/health` has no PATCH route of its own, so
  // this proves the allowlist is a fixed, path-independent set, not derived
  // per-route — the exact thing that broke.
  it.each(['PUT', 'PATCH', 'DELETE'] as const)(
    'a preflight allows %s, not just GET/HEAD/POST',
    async (method) => {
      const app = await build();
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://pixel-index.example',
          'access-control-request-method': method,
        },
      });
      expect(response.headers['access-control-allow-methods']).toContain(method);
    },
  );
});

describe('error envelope', () => {
  it('renders a thrown ApiError in the shared shape', async () => {
    const app = await build();
    app.get('/__test/api-error', () => {
      throw ApiError.forbidden('nope');
    });
    const response = await app.inject({ method: 'GET', url: '/__test/api-error' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden', message: 'nope' });
  });

  it('carries layout-core validation issues on a 422', async () => {
    const app = await build();
    app.get('/__test/validation', () => {
      throw ApiError.validation([
        { code: 'layout.revision.below_bundled', path: '/layoutRevision', message: 'too old' },
      ]);
    });
    const response = await app.inject({ method: 'GET', url: '/__test/validation' });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('validation_error');
    expect(body.issues).toEqual([
      { code: 'layout.revision.below_bundled', path: '/layoutRevision', message: 'too old' },
    ]);
  });

  it('never leaks an unexpected error message to the client', async () => {
    const app = await build();
    app.get('/__test/boom', () => {
      throw new Error('leaked internal detail: connection string is postgres://...');
    });
    const response = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({ error: 'internal_error', message: 'Something went wrong.' });
    expect(JSON.stringify(body)).not.toContain('connection string');
  });

  it('renders an unknown route with the same envelope shape', async () => {
    const app = await build();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('renders an oversized body as the shared envelope, not Fastify defaults', async () => {
    const app = await build(testConfig({ bodyLimitBytes: 10 }));
    app.post('/__test/echo', (request) => request.body);
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { this: 'is well over ten bytes' },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: 'payload_too_large',
      message: 'Request body is too large.',
    });
  });
});

describe('rate limiting', () => {
  it('returns 429 with a documented shape once the bucket is exhausted', async () => {
    const app = await build(testConfig({ rateLimit: { max: 1, windowMs: 60_000 } }));

    const first = await app.inject({ method: 'GET', url: '/health' });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/health' });
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
    const body = second.json();
    expect(body.error).toBe('rate_limited');
    expect(typeof body.message).toBe('string');
  });

  it('gives a route its own tighter bucket via writeRateLimitConfig', async () => {
    const { writeRateLimitConfig } = await import('./rateLimit.js');
    const config = testConfig({
      rateLimit: { max: 100, windowMs: 60_000 },
      writeRateLimit: { max: 1, windowMs: 60_000 },
    });
    const app = await build(config);
    app.post('/__test/write', writeRateLimitConfig(config), () => ({ ok: true }));

    const first = await app.inject({ method: 'POST', url: '/__test/write' });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/__test/write' });
    expect(second.statusCode).toBe(429);

    // The general bucket (max 100) is untouched by the write route's own limit.
    const stillFine = await app.inject({ method: 'GET', url: '/health' });
    expect(stillFine.statusCode).toBe(200);
  });
});

describe('the auth seam', () => {
  it('request.user is null for an anonymous request — nothing authenticates yet', async () => {
    const app = await build();
    let seen: unknown;
    app.get('/__test/whoami', (request) => {
      seen = request.user;
      return { user: request.user };
    });
    const response = await app.inject({ method: 'GET', url: '/__test/whoami' });
    expect(response.statusCode).toBe(200);
    expect(seen).toBeNull();
  });

  it('requireAuth rejects an anonymous request as 401', async () => {
    const app = await build();
    app.get('/__test/protected', (request) => {
      const user = requireAuth(request);
      return { user };
    });
    const response = await app.inject({ method: 'GET', url: '/__test/protected' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized', message: 'Authentication required.' });
  });
});

describe('config isolation', () => {
  it('two servers built from different configs do not share rate-limit state', async () => {
    const strict = await build(testConfig({ rateLimit: { max: 1, windowMs: 60_000 } }));
    const relaxed = await build(testConfig({ rateLimit: { max: 100, windowMs: 60_000 } }));

    await strict.inject({ method: 'GET', url: '/health' });
    const strictSecond = await strict.inject({ method: 'GET', url: '/health' });
    expect(strictSecond.statusCode).toBe(429);

    const relaxedFirst = await relaxed.inject({ method: 'GET', url: '/health' });
    expect(relaxedFirst.statusCode).toBe(200);
  });
});
