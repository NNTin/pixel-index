/**
 * The tighter rate-limit bucket for write and render-triggering routes.
 *
 * @fastify/rate-limit is registered globally in server.ts with the general
 * `config.rateLimit` bucket. Spreading this into a route's options overrides
 * just that route with the stricter `config.writeRateLimit` bucket, without a
 * second plugin registration or a `global: false` route split. #8's
 * submission endpoint and anything that triggers a render are the intended
 * callers:
 *
 *   app.post('/api/v1/layouts', writeRateLimitConfig(config), handler);
 */

import type { RouteShorthandOptions } from 'fastify';

import type { ApiConfig } from './config.js';

export function writeRateLimitConfig(config: ApiConfig): RouteShorthandOptions {
  return {
    config: {
      rateLimit: {
        max: config.writeRateLimit.max,
        timeWindow: config.writeRateLimit.windowMs,
      },
    },
  };
}
