/**
 * The pinned upstream's validator, built once and shared by every write route
 * that needs it (`submit.ts`'s `POST`, `manage.ts`'s `PUT .../layout`).
 *
 * Built once per process, not per request: `furnitureCatalog()` walks the
 * whole asset tree, and the pin cannot change for the lifetime of one
 * process. Building it twice — once per route file — would do that walk
 * twice for no reason.
 *
 * Never throws. A missing upstream (`PIXEL_AGENTS_DIR` misconfigured, the
 * submodule never checked out) makes every write that needs validation
 * impossible, but this process also serves reads that have nothing to do
 * with it — the same tension `/meta` (meta.ts) already resolved, resolved
 * the same way here: log loudly at boot, return `null`, and let each route
 * answer with a clear `503` instead of the whole server refusing to start,
 * or every request failing with an unrelated-looking stack trace.
 */

import { createValidator, upstreamPin, type Validator } from '@pixel-index/layout-core';
import type { FastifyBaseLogger } from 'fastify';

import type { ApiConfig } from '../config.js';

export interface UpstreamValidator {
  pin: ReturnType<typeof upstreamPin>;
  validator: Validator;
}

export function buildUpstreamValidator(
  config: ApiConfig,
  log: FastifyBaseLogger,
  context: string,
): UpstreamValidator | null {
  try {
    const pin = upstreamPin(config.upstreamDir);
    const validator = createValidator({
      ...(config.upstreamDir ? { upstreamDir: config.upstreamDir } : {}),
      upstreamVersion: pin.version,
    });
    return { pin, validator };
  } catch (error) {
    log.error(
      { err: error },
      `Pinned Pixel Agents not found — ${context} will refuse every request until this is fixed.`,
    );
    return null;
  }
}
