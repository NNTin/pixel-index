/**
 * The API service skeleton: CORS, error envelope, rate limiting, health and
 * readiness. No business routes live here — see #6, #7, #8, #10.
 *
 * The frontend is on GitHub Pages and this service is on another origin, so
 * every browser call is cross-origin. CORS is therefore a product surface,
 * not a detail: the allowlist comes from config, so the official index and a
 * self-hoster's Pages domain are both just values, and nothing but an
 * allowlisted origin can carry credentials.
 */

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthContext } from './auth/context.js';
import type { ApiConfig } from './config.js';
import { registerErrorHandling } from './errors.js';
import type { Queryable } from './db/pool.js';

export interface BuildServerDeps {
  config: ApiConfig;
  /**
   * Only `query` is required, so tests can inject a stub without a real
   * Postgres. The real pool is created in index.ts and outlives the app —
   * see the note on `onClose` there.
   */
  pool: Queryable;
}

export async function buildServer({ config, pool }: BuildServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: config.bodyLimitBytes,
    // The reverse proxy (Traefik, Cloudflare Tunnel) sets X-Forwarded-For.
    // Without this, every client shares the proxy's IP and one bucket.
    trustProxy: config.trustProxy,
    logger: { level: config.logLevel },
  });

  registerErrorHandling(app);
  registerAuthContext(app);

  await app.register(cors, {
    // No `origin` header (curl, server-to-server, same-origin) is not a CORS
    // request at all — nothing to check. A browser always sends one.
    origin: (origin, callback) => {
      callback(null, origin === undefined || config.webOrigins.includes(origin));
    },
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // Keyed on the real client via trustProxy above, not the reverse proxy.
    //
    // @fastify/rate-limit *throws* whatever this returns into Fastify's normal
    // error pipeline (it does not reply.send() directly) — so the returned
    // value has to be an Error with `.statusCode` set, exactly like its own
    // default builder, or the central error handler in errors.ts has no
    // status to key on and falls back to 500. registerErrorHandling() renders
    // the actual envelope; this only has to get the shape right.
    errorResponseBuilder: (_request, context) => {
      const error = new Error(
        `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.`,
      ) as Error & { statusCode: number };
      error.statusCode = context.statusCode;
      return error;
    },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  /**
   * Readiness is not liveness. A health check that always returns 200 is how
   * a container stays in a load balancer while broken — this one actually
   * reaches Postgres. Bound to a short timeout so a hanging database makes
   * this fail fast rather than pile up requests.
   */
  app.get('/ready', async (request, reply) => {
    try {
      await withTimeout(pool.query('SELECT 1'), 2000);
    } catch (error) {
      request.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable', reason: 'database unreachable' });
    }
    return { status: 'ok' };
  });

  return app;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref();
    }),
  ]);
}
