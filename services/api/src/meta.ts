/**
 * GET /api/v1/meta — the live equivalent of v1's `dist/index.json` header:
 * which Pixel Agents the currently-listed layouts were validated against, and
 * how many there are. A client compares its own Pixel Agents' `layoutRevision`
 * against this to tell whether it is looking at layouts newer than itself.
 */

import { upstreamPin } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from './config.js';
import type { AnyDatabase } from './db/client.js';
import { countPublicLayouts } from './layouts/query.js';
import { metaResponseSchema } from './layouts/schemas.js';

const SCHEMA_VERSION = 1;

export function registerMetaRoutes(app: FastifyInstance, config: ApiConfig, db: AnyDatabase): void {
  app.get('/api/v1/meta', { schema: { response: metaResponseSchema } }, async (request) => {
    // A containerised vendor/pixel-agents has no .git to read a commit from —
    // same trap, same fix, as the renderer (services/renderer/src/server.ts).
    let pin;
    try {
      const gitPin = upstreamPin(config.upstreamDir);
      pin = { ...gitPin, commit: gitPin.commit ?? config.upstreamCommit ?? null };
    } catch (error) {
      request.log.warn({ err: error }, 'could not read the pinned upstream for /meta');
      pin = { version: null, commit: config.upstreamCommit ?? null, layoutRevision: 0 };
    }

    const count = await countPublicLayouts(db);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      pixelAgents: pin,
      count,
    };
  });
}
