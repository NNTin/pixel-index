/**
 * The caching policy every public read path shares.
 *
 * It lives here rather than being spelled out per route because the two halves
 * have to agree: an `ETag` is only useful if the response is revalidated, and a
 * `max-age` is only safe if the `ETag` is honoured. Four routes in `routes.ts`
 * and the bulk export all want the same pairing, and a fifth caller copying
 * one line and not the other is how a route quietly starts serving stale
 * layouts from a browser cache.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Short-lived and revalidated — never `immutable`.
 *
 * These URLs are slug-addressed (or index-wide) and their content can change
 * underneath them: a layout can be edited (#9), moderated, or replaced. Only
 * the renderer's own content-addressed cache key earns `immutable`; anything
 * addressed by name has to be re-asked about.
 */
export const PUBLIC_REVALIDATED = 'public, max-age=60, must-revalidate';

/** `true` means "a 304 has been sent, stop" — the caller should return immediately. */
export function respondNotModifiedIfMatching(
  request: FastifyRequest,
  reply: FastifyReply,
  etag: string,
): boolean {
  reply.header('etag', etag);
  if (request.headers['if-none-match'] === etag) {
    reply.code(304).send();
    return true;
  }
  return false;
}
