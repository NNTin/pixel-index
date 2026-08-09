/**
 * The OAuth2 authorization-code flow and the session lifecycle it feeds.
 *
 * Two very different kinds of request live in this file, and it matters
 * which is which:
 *
 * - `GET /api/v1/auth/discord/login` and `GET /callback` are **top-level
 *   browser navigations** — the user's whole tab moves through them. The
 *   transient `state`/PKCE cookie set here is scoped to the API's own
 *   origin and is never touched by the SPA; it has nothing to do with the
 *   cross-origin cookie problem the ADR rejects cookies over, because at
 *   every point it is read the API's own origin IS the top-level site.
 * - `POST /api/v1/auth/token`, `/refresh` and `/logout` are **ordinary CORS
 *   fetches from the SPA**, protected by the origin allowlist in server.ts.
 *   This is the only place bearer tokens ever appear in a response body.
 *
 * See ADR 0001, decision 10, for why the handoff between the two is a
 * single-use code in a URL fragment rather than tokens in the /callback
 * redirect itself.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { AnyDatabase } from '../db/client.js';
import { allowsWebOrigin, type ApiConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { requireAuth } from './context.js';
import { resolveCapability, type ResolvedCapability } from './capability.js';
import {
  buildAuthorizeUrl,
  DiscordApiError,
  exchangeCodeForToken,
  fetchDiscordUser,
  generatePkcePair,
} from './discord.js';
import { saveDiscordGrant } from './discordGrant.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import {
  consumeLoginCode,
  createLoginCode,
  createSession,
  revokeSession,
  rotateRefreshToken,
} from './sessions.js';
import { getUserById, upsertDiscordUser } from './users.js';

const OAUTH_COOKIE = 'pixelindex_oauth';
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

export interface AuthRoutesDeps {
  config: ApiConfig;
  db: AnyDatabase;
}

/**
 * Only an allowlisted origin, so this can't become an open redirect.
 *
 * Shares `allowsWebOrigin` with the CORS check (server.ts) rather than
 * testing `webOrigins` directly: a preview-deploy origin matched by pattern
 * has to clear *both*, or login from a Vercel preview redirects back
 * successfully and then fails on the first credentialed API call.
 */
function resolveReturnTo(candidate: string | undefined, config: ApiConfig): string {
  const fallback = `${config.webOrigins[0]}/`;
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && allowsWebOrigin(config, url.origin)) {
      return url.toString();
    }
  } catch {
    /* falls through to fallback */
  }
  return fallback;
}

interface OAuthCookiePayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

function packCookie(payload: OAuthCookiePayload): string {
  return [
    payload.state,
    payload.codeVerifier,
    Buffer.from(payload.returnTo, 'utf-8').toString('base64url'),
  ].join('.');
}

function unpackCookie(raw: string): OAuthCookiePayload | null {
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [state, codeVerifier, returnToEncoded] = parts;
  if (!state || !codeVerifier || returnToEncoded === undefined) return null;
  try {
    return { state, codeVerifier, returnTo: Buffer.from(returnToEncoded, 'base64url').toString('utf-8') };
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // an attacker learning "wrong length" from a thrown error is not the leak
  // this guards against (state is unguessable regardless), but returning
  // false explicitly is one fewer edge case in the caller.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function registerAuthRoutes(app: FastifyInstance, { config, db }: AuthRoutesDeps): void {
  const discordCredentials = {
    clientId: config.discordClientId,
    clientSecret: config.discordClientSecret,
    redirectUri: `${config.publicApiOrigin}/callback`,
  };
  const sessionConfig = {
    sessionSecret: config.sessionSecret,
    accessTokenTtlMs: config.accessTokenTtlMs,
    refreshTokenTtlMs: config.refreshTokenTtlMs,
    loginCodeTtlMs: config.loginCodeTtlMs,
  };
  const secureCookies = config.publicApiOrigin.startsWith('https:');

  app.get(
    '/api/v1/auth/discord/login',
    writeRateLimitConfig(config),
    async (request, reply) => {
      const query = request.query as { returnTo?: string };
      const returnTo = resolveReturnTo(query.returnTo, config);
      const state = randomBytes(24).toString('base64url');
      const { verifier, challenge } = generatePkcePair();

      reply.setCookie(OAUTH_COOKIE, packCookie({ state, codeVerifier: verifier, returnTo }), {
        path: '/callback',
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
      });

      return reply.redirect(
        buildAuthorizeUrl(discordCredentials, state, challenge, config.discordGuild !== undefined),
      );
    },
  );

  app.get('/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const cookieValue = request.cookies[OAUTH_COOKIE];
    // Clear it either way — this cookie is single-use regardless of outcome.
    reply.clearCookie(OAUTH_COOKIE, { path: '/callback' });

    const parsedCookie = cookieValue ? unpackCookie(cookieValue) : null;
    const returnTo = parsedCookie?.returnTo ?? `${config.webOrigins[0]}/`;
    const fail = (reason: string) => reply.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}authError=${reason}`);

    if (query.error) return fail(query.error);
    if (!parsedCookie) return fail('missing_session');
    if (!query.state || !constantTimeEqual(query.state, parsedCookie.state)) {
      return fail('state_mismatch');
    }
    if (!query.code) return fail('missing_code');

    let discordUser;
    let token;
    try {
      token = await exchangeCodeForToken(
        discordCredentials,
        query.code,
        parsedCookie.codeVerifier,
      );
      discordUser = await fetchDiscordUser(token.access_token);
    } catch (error) {
      request.log.warn({ err: error }, 'Discord OAuth exchange failed');
      const reason = error instanceof DiscordApiError ? 'discord_rejected' : 'discord_unreachable';
      return fail(reason);
    }

    let user = await upsertDiscordUser(db, discordUser);
    if (config.discordGuild) {
      await saveDiscordGrant(
        db,
        user.id,
        token,
        config.discordGuild.oauthTokenEncryptionKey,
      );
    }
    try {
      user = (await resolveCapability(db, config, user, { force: true })).user;
    } catch (error) {
      request.log.warn({ err: error }, 'Discord membership verification failed');
      return fail('discord_unreachable');
    }

    const code = await createLoginCode(db, user.id, sessionConfig);
    const target = new URL(returnTo);
    target.hash = `pixelIndexLoginCode=${code}`;
    return reply.redirect(target.toString());
  });

  app.post('/api/v1/auth/token', writeRateLimitConfig(config), async (request, reply) => {
    const body = request.body as { code?: string };
    if (!body?.code) throw ApiError.badRequest('code is required.');

    const user = await consumeLoginCode(db, body.code);
    if (!user) throw ApiError.unauthorized('This login code is invalid, used or expired.');

    const resolved = await resolveCapability(db, config, user);
    const tokens = await createSession(db, resolved.user, sessionConfig);
    return reply.send({ ...tokens, user: publicUser(resolved, config) });
  });

  app.post('/api/v1/auth/refresh', writeRateLimitConfig(config), async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (!body?.refreshToken) throw ApiError.badRequest('refreshToken is required.');

    const outcome = await rotateRefreshToken(db, body.refreshToken, sessionConfig);
    if (outcome.status === 'reused') {
      request.log.warn('Refresh token reuse detected; session family revoked.');
    }
    if (outcome.status !== 'ok') {
      throw ApiError.unauthorized('Session expired or revoked. Please log in again.');
    }
    return reply.send(outcome.tokens);
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (body?.refreshToken) await revokeSession(db, body.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request, reply) => {
    const auth = requireAuth(request);
    const user = await getUserById(db, auth.id);
    if (!user) throw ApiError.unauthorized();
    const resolved = await resolveCapability(db, config, user);
    return reply.send(publicUser(resolved, config));
  });
}

function publicUser(resolved: ResolvedCapability, config: ApiConfig) {
  const { user, submission } = resolved;
  return {
    id: user.id,
    username: user.username,
    displayName: user.guildNickname ?? user.globalName ?? user.username,
    avatarUrl: user.avatarUrl,
    role: user.role,
    capabilityCheckedAt: user.discordMembershipCheckedAt?.toISOString() ?? null,
    capabilityCacheTtlMs: config.discordMembershipCacheTtlMs,
    submission: {
      allowed: submission.allowed,
      reason: submission.reason,
      inviteUrl:
        !submission.allowed && submission.reason === 'discord_membership_required'
          ? (config.discordGuild?.inviteUrl ?? null)
          : null,
    },
  };
}
