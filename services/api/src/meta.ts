/**
 * GET /api/v1/meta — the live equivalent of v1's `dist/index.json` header:
 * which Pixel Agents the currently-listed layouts were validated against, and
 * how many there are. A client compares its own Pixel Agents' `layoutRevision`
 * against this to tell whether it is looking at layouts newer than itself.
 */

import { type UpstreamPin, upstreamPin } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from './config.js';
import type { AnyDatabase } from './db/client.js';
import { countPublicLayouts } from './layouts/query.js';
import { metaResponseSchema } from './layouts/schemas.js';

const SCHEMA_VERSION = 1;

/**
 * The body of `GET /api/v1/meta`. Declared as the handler's return type so it
 * cannot drift from metaResponseSchema, and so tests reading it are checked.
 */
export interface MetaBody {
  schemaVersion: number;
  generatedAt: string;
  /** This checkout's own commit (config.commit) — not pixelAgents.commit below, which is the pinned upstream's. */
  apiCommit: string | null;
  pixelAgents: UpstreamPin;
  count: number;
  discordInviteUrl: string | null;
}

export function registerMetaRoutes(app: FastifyInstance, config: ApiConfig, db: AnyDatabase): void {
  app.get(
    '/api/v1/meta',
    { schema: { response: metaResponseSchema } },
    async (request): Promise<MetaBody> => {
      // A containerised vendor/pixel-agents has no .git to read a commit from;
      // upstreamPin() falls back to the committed stamp beside the checkout, so
      // this reports a real commit in a container too (layout-core/upstream.ts).
      let pin;
      try {
        pin = upstreamPin(config.upstreamDir);
      } catch (error) {
        request.log.warn({ err: error }, 'could not read the pinned upstream for /meta');
        pin = { version: null, commit: null, layoutRevision: 0 };
      }

      const count = await countPublicLayouts(db);

      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        apiCommit: config.commit ?? null,
        pixelAgents: pin,
        count,
        // Public by design — the invite is how someone joins the community in
        // the first place, so it must not require already being signed in.
        discordInviteUrl: config.discordGuild?.inviteUrl ?? null,
      };
    },
  );
}
