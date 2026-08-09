import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { verifyAccessToken } from './tokens.js';

const DISCORD_USER = { id: '999888777666555444', username: 'pixel-fan', avatar: null };

function fakeDiscordFetch() {
  return vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.includes('/oauth2/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'discord-access-token',
          token_type: 'Bearer',
          expires_in: 604800,
          refresh_token: 'discord-refresh-token',
          scope: 'identify',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (href.includes('/users/@me')) {
      return new Response(JSON.stringify(DISCORD_USER), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch to ${href}`);
  });
}

const config = testConfig({
  webOrigins: ['https://frontend.example'],
  publicApiOrigin: 'https://api.pixel-index.example',
  // These tests hit /login, /token and /refresh many times against one
  // shared app (PGlite start-up cost makes a fresh app per test wasteful).
  // Rate limiting itself is server.test.ts's concern, not this file's.
  writeRateLimit: { max: 1000, windowMs: 60_000 },
});
const fakePool = { query: async () => ({ rows: [] }) };

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
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs /login, returning the parsed authorize URL and the session cookie. */
async function startLogin(returnTo = 'https://frontend.example/app') {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/discord/login?returnTo=${encodeURIComponent(returnTo)}`,
  });
  expect(response.statusCode).toBe(302);
  const authorizeUrl = new URL(response.headers.location as string);
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { authorizeUrl, cookie: cookieHeader!.split(';')[0]! };
}

/** Full login → issued access/refresh tokens, for tests that need a logged-in user. */
async function completeLogin() {
  vi.stubGlobal('fetch', fakeDiscordFetch());
  const { authorizeUrl, cookie } = await startLogin();
  const state = authorizeUrl.searchParams.get('state')!;

  const callback = await app.inject({
    method: 'GET',
    url: `/callback?code=discord-code&state=${state}`,
    headers: { cookie },
  });
  const redirect = new URL(callback.headers.location as string);
  const code = new URLSearchParams(redirect.hash.slice(1)).get('pixelIndexLoginCode')!;

  const tokenResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/token',
    payload: { code },
  });
  return tokenResponse.json() as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; username: string; role: string };
  };
}

describe('GET /api/v1/auth/discord/login', () => {
  it('redirects to Discord with state and a PKCE challenge', async () => {
    const { authorizeUrl } = await startLogin();
    expect(authorizeUrl.hostname).toBe('discord.com');
    expect(authorizeUrl.searchParams.get('client_id')).toBe(config.discordClientId);
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      `${config.publicApiOrigin}/callback`,
    );
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('sets an HttpOnly session cookie scoped to /callback only', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/discord/login',
    });
    const setCookie = (response.headers['set-cookie'] as string) ?? '';
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie).toContain('Path=/callback');
    expect(setCookie).toMatch(/^pixelindex_oauth=/);
  });

  it('falls back to the first allowlisted origin when returnTo is not in the allowlist', async () => {
    const { authorizeUrl, cookie } = await startLogin('https://evil.example/steal');
    const state = authorizeUrl.searchParams.get('state')!;
    vi.stubGlobal('fetch', fakeDiscordFetch());
    const callback = await app.inject({
      method: 'GET',
      url: `/callback?code=c&state=${state}`,
      headers: { cookie },
    });
    const location = callback.headers.location as string;
    expect(location.startsWith('https://frontend.example/')).toBe(true);
  });

  // The CORS allowlist and this redirect allowlist share `allowsWebOrigin`
  // for exactly this case: without it, login from a Vercel preview (#28)
  // would bounce the visitor back to production instead of the preview they
  // started from — or, worse, look fine and then fail on the first API call.
  it('honours a returnTo matched by a preview origin pattern, not just an exact origin', async () => {
    const previewApp = await buildServer({
      config: {
        ...config,
        webOriginPatterns: [
          { source: 'https://pixel-index-*-acme.vercel.app', matcher: /^https:\/\/pixel-index-[a-z0-9-]+-acme\.vercel\.app$/ },
        ],
      },
      pool: fakePool,
      db: harness.db,
    });
    try {
      const preview = 'https://pixel-index-699uclg0a-acme.vercel.app';
      const response = await previewApp.inject({
        method: 'GET',
        url: `/api/v1/auth/discord/login?returnTo=${encodeURIComponent(`${preview}/app`)}`,
      });
      const setCookie = response.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const authorizeUrl = new URL(response.headers.location as string);
      const state = authorizeUrl.searchParams.get('state')!;

      vi.stubGlobal('fetch', fakeDiscordFetch());
      const callback = await previewApp.inject({
        method: 'GET',
        url: `/callback?code=c&state=${state}`,
        headers: { cookie: cookieHeader!.split(';')[0]! },
      });
      expect((callback.headers.location as string).startsWith(`${preview}/app`)).toBe(true);
    } finally {
      await previewApp.close();
    }
  });
});

describe('GET /callback', () => {
  it('completes the flow and hands off a one-time code in the URL fragment, not a query param', async () => {
    vi.stubGlobal('fetch', fakeDiscordFetch());
    const { authorizeUrl, cookie } = await startLogin();
    const state = authorizeUrl.searchParams.get('state')!;

    const callback = await app.inject({
      method: 'GET',
      url: `/callback?code=discord-code&state=${state}`,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(302);
    const redirect = new URL(callback.headers.location as string);
    expect(redirect.origin).toBe('https://frontend.example');
    expect(redirect.search).toBe(''); // nothing sensitive in the query string
    expect(redirect.hash).toMatch(/^#pixelIndexLoginCode=/);
  });

  it('rejects a state that does not match the cookie', async () => {
    const { cookie } = await startLogin();
    const callback = await app.inject({
      method: 'GET',
      url: '/callback?code=discord-code&state=not-the-real-state',
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(302);
    const location = new URL(callback.headers.location as string);
    expect(location.searchParams.get('authError')).toBe('state_mismatch');
  });

  it('rejects a callback with no session cookie at all (replay, or a direct hit)', async () => {
    const callback = await app.inject({
      method: 'GET',
      url: '/callback?code=x&state=y',
    });
    const location = new URL(callback.headers.location as string);
    expect(location.searchParams.get('authError')).toBe('missing_session');
  });

  it('surfaces a Discord-side denial without ever reaching the token exchange', async () => {
    const { cookie } = await startLogin();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const callback = await app.inject({
      method: 'GET',
      url: '/callback?error=access_denied',
      headers: { cookie },
    });
    const location = new URL(callback.headers.location as string);
    expect(location.searchParams.get('authError')).toBe('access_denied');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the same state cannot be replayed once the cookie is gone', async () => {
    // The server clears the cookie unconditionally on the first hit
    // (Set-Cookie: …; Max-Age=0), and a real browser honours that and stops
    // sending it. app.inject has no cookie jar to model that automatically,
    // so the second request here deliberately omits the cookie header —
    // that omission IS the replay attempt: whoever captured the first
    // callback URL and reloads it no longer has a live session cookie either.
    vi.stubGlobal('fetch', fakeDiscordFetch());
    const { authorizeUrl, cookie } = await startLogin();
    const state = authorizeUrl.searchParams.get('state')!;

    const first = await app.inject({
      method: 'GET',
      url: `/callback?code=c&state=${state}`,
      headers: { cookie },
    });
    expect(new URL(first.headers.location as string).hash).toMatch(/^#pixelIndexLoginCode=/);

    const replay = await app.inject({ method: 'GET', url: `/callback?code=c&state=${state}` });
    const location = new URL(replay.headers.location as string);
    expect(location.searchParams.get('authError')).toBe('missing_session');
  });
});

describe('POST /api/v1/auth/token', () => {
  it('exchanges a valid login code for a working session', async () => {
    const session = await completeLogin();
    expect(session.user.username).toBe('pixel-fan');
    const claims = await verifyAccessToken(session.accessToken, config.sessionSecret);
    expect(claims).toEqual({ sub: session.user.id });
  });

  it('the same code cannot be exchanged twice', async () => {
    vi.stubGlobal('fetch', fakeDiscordFetch());
    const { authorizeUrl, cookie } = await startLogin();
    const state = authorizeUrl.searchParams.get('state')!;
    const callback = await app.inject({
      method: 'GET',
      url: `/callback?code=discord-code&state=${state}`,
      headers: { cookie },
    });
    const redirect = new URL(callback.headers.location as string);
    const code = new URLSearchParams(redirect.hash.slice(1)).get('pixelIndexLoginCode')!;

    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { code } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { code } });
    expect(second.statusCode).toBe(401);
  });

  it('rejects a made-up code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { code: 'not-a-real-code' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a missing code with 400, not 500', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/me', () => {
  it('returns the logged-in user', async () => {
    const session = await completeLogin();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: 'pixel-fan', role: 'user' });
  });

  it('is 401 with no token — viewing never requires login, but this route does', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
  });

  it('is 401 with a garbage token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates to a new pair', async () => {
    const session = await completeLogin();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(session.refreshToken);
  });

  it('a spent refresh token cannot be used again', async () => {
    const session = await completeLogin();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('actually invalidates — the refresh token stops working', async () => {
    const session = await completeLogin();
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('is idempotent and never reveals whether a token was valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: 'never-issued' },
    });
    expect(response.statusCode).toBe(204);
  });
});
