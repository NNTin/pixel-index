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

import { randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { allowsWebOrigin, type ApiConfig, webHomeUrl } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import { ApiError } from '../errors.js';
import type { RequestSchemas } from '../http.js';
import { writeRateLimitConfig } from '../rateLimit.js';
import { resolveCapability, type ResolvedCapability } from './capability.js';
import { requireAuth } from './context.js';
import {
  buildAuthorizeUrl,
  DiscordApiError,
  exchangeCodeForToken,
  fetchDiscordUser,
  generatePkcePair,
} from './discord.js';
import { saveDiscordGrant } from './discordGrant.js';
import {
  consumeLoginCode,
  createLoginCode,
  createSession,
  revokeSession,
  rotateRefreshToken,
  type TokenPair,
} from './sessions.js';
import { constantTimeEqual } from './tokens.js';
import { getUserById, upsertDiscordUser } from './users.js';

const OAUTH_COOKIE = 'pixelindex_oauth';
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

const loginQuerySchema = {
  type: 'object',
  properties: { returnTo: { type: 'string' } },
} as const;

const callbackQuerySchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    state: { type: 'string' },
    error: { type: 'string' },
  },
} as const;

/** The optional bodies of the three token endpoints. See the note in registerAuthRoutes. */
interface LoginCodeBody {
  code?: string;
}
interface RefreshTokenBody {
  refreshToken?: string;
}

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
  const fallback = webHomeUrl(config);
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

  // Query types come from the schemas below rather than from a cast. Bodies
  // deliberately do not: these three POST routes accept an empty body — Fastify
  // delivers `undefined` for one — and a `schema.body` makes Fastify reject the
  // request before the handler runs. Measured: adding one to /auth/logout turns
  // its 204 into a 400. So the body shape is declared as a route generic, which
  // states the contract without changing what the route accepts, and the
  // hand-written checks below stay the thing that answers.
  const typed = app.withTypeProvider<RequestSchemas>();


  typed.get(
    '/api/v1/auth/discord/login',
    { ...writeRateLimitConfig(config), schema: { querystring: loginQuerySchema } },
    async (request, reply) => {
      const query = request.query;
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

  typed.get('/callback', { schema: { querystring: callbackQuerySchema } }, async (request, reply) => {
    const query = request.query;
    const cookieValue = request.cookies[OAUTH_COOKIE];
    // Clear it either way — this cookie is single-use regardless of outcome.
    reply.clearCookie(OAUTH_COOKIE, { path: '/callback' });

    const parsedCookie = cookieValue ? unpackCookie(cookieValue) : null;
    const returnTo = parsedCookie?.returnTo ?? webHomeUrl(config);
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

  app.post<{ Body: LoginCodeBody | undefined }>('/api/v1/auth/token', writeRateLimitConfig(config), async (request, reply) => {
    // `| undefined`, not just the object: an empty POST body really does arrive
    // as undefined, which is why the optional chain below is not decoration.
    const body = request.body;
    if (!body?.code) throw ApiError.badRequest('code is required.');

    const user = await consumeLoginCode(db, body.code);
    if (!user) throw ApiError.unauthorized('This login code is invalid, used or expired.');

    const resolved = await resolveCapability(db, config, user);
    const tokens = await createSession(db, resolved.user, sessionConfig);
    return reply.send({ ...tokens, user: publicUser(resolved, config) });
  });

  app.post<{ Body: RefreshTokenBody | undefined }>('/api/v1/auth/refresh', writeRateLimitConfig(config), async (request, reply) => {
    const body = request.body;
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

  app.post<{ Body: RefreshTokenBody | undefined }>('/api/v1/auth/logout', async (request, reply) => {
    const body = request.body;
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

/**
 * `GET /api/v1/auth/me`, and the `user` half of a login response. Derived from
 * publicUser rather than written out twice, so it cannot drift from it.
 */
export type PublicUserBody = ReturnType<typeof publicUser>;

/** `POST /api/v1/auth/token` — a token pair plus who it belongs to. */
export interface SessionBody extends TokenPair {
  user: PublicUserBody;
}

function publicUser(resolved: ResolvedCapability, config: ApiConfig) {
  const { user, submission } = resolved;
  return {
    id: user.id,
    /**
     * The Discord snowflake, alongside — never instead of — the internal `id`.
     * #62 moved the *public* author surface onto this identifier and left
     * authenticated surfaces alone; `id` still means the internal UUID here and
     * everywhere sessions, ownership and moderation use it. This is additive,
     * for the one thing that UUID cannot do: address the caller's own public
     * profile at `/authors/:discordId` (#66). Null only for system users, who
     * have no Discord account and so have no public profile to link to.
     */
    discordId: user.discordId,
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
