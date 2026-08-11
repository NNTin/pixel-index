import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { type FetchInput, formBody, requestHeader, requestUrl } from '../test-support/bodies.js';
import {
  buildAuthorizeUrl,
  DiscordApiError,
  discordAvatarUrl,
  exchangeCodeForToken,
  fetchDiscordGuildMember,
  fetchDiscordUser,
  generatePkcePair,
} from './discord.js';

const CREDENTIALS = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.pixel-index.example/callback',
};

describe('generatePkcePair', () => {
  it('the challenge is the S256 hash of the verifier, per RFC 7636', () => {
    const { verifier, challenge } = generatePkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('is not predictable across calls', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('buildAuthorizeUrl', () => {
  it('carries every parameter Discord requires, and nothing that leaks state elsewhere', () => {
    const url = new URL(
      buildAuthorizeUrl(CREDENTIALS, 'the-state-value', 'the-challenge-value'),
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(CREDENTIALS.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('the-state-value');
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('always asks for fresh consent, never a silently reused prior grant', () => {
    const url = new URL(buildAuthorizeUrl(CREDENTIALS, 's', 'c'));
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('requests the user-scoped guild-member grant only when community integration is enabled', () => {
    const plain = new URL(buildAuthorizeUrl(CREDENTIALS, 's', 'c'));
    const community = new URL(buildAuthorizeUrl(CREDENTIALS, 's', 'c', true));
    expect(plain.searchParams.get('scope')).toBe('identify');
    expect(community.searchParams.get('scope')).toBe('identify guilds.members.read');
  });
});

describe('exchangeCodeForToken', () => {
  it('authenticates with HTTP Basic using the client id and secret', async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const auth = requestHeader(init, 'authorization') ?? '';
      const [id, secret] = Buffer.from(auth.replace('Basic ', ''), 'base64')
        .toString()
        .split(':');
      expect(id).toBe('client-id');
      expect(secret).toBe('client-secret');
      return new Response(
        JSON.stringify({
          access_token: 'discord-access',
          token_type: 'Bearer',
          expires_in: 604800,
          refresh_token: 'discord-refresh',
          scope: 'identify',
        }),
        { status: 200 },
      );
    });

    const token = await exchangeCodeForToken(
      CREDENTIALS,
      'the-code',
      'the-verifier',
      fetchImpl,
    );
    expect(token.access_token).toBe('discord-access');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends the code_verifier and redirect_uri Discord will check against the authorize request', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      capturedBody = formBody(init).toString();
      return new Response('{}', { status: 200 });
    });
    await exchangeCodeForToken(
      CREDENTIALS,
      'the-code',
      'the-verifier',
      fetchImpl,
    );
    const params = new URLSearchParams(capturedBody);
    expect(params.get('code')).toBe('the-code');
    expect(params.get('code_verifier')).toBe('the-verifier');
    expect(params.get('redirect_uri')).toBe(CREDENTIALS.redirectUri);
    expect(params.get('grant_type')).toBe('authorization_code');
  });

  it('throws DiscordApiError with the status on a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    await expect(
      exchangeCodeForToken(CREDENTIALS, 'bad-code', 'v', fetchImpl),
    ).rejects.toThrow(DiscordApiError);
  });
});

describe('fetchDiscordUser', () => {
  it('sends the Discord access token as a Bearer header', async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      expect(requestHeader(init, 'authorization')).toBe('Bearer discord-access');
      return new Response(
        JSON.stringify({ id: '123456789012345678', username: 'someone', avatar: null }),
        { status: 200 },
      );
    });
    const user = await fetchDiscordUser('discord-access', fetchImpl);
    expect(user).toEqual({ id: '123456789012345678', username: 'someone', avatar: null });
  });

  it('throws DiscordApiError on failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      fetchDiscordUser('bad-token', fetchImpl),
    ).rejects.toThrow(DiscordApiError);
  });
});

describe('fetchDiscordGuildMember', () => {
  it('reads role ids, guild nickname and pending state from the current-user member endpoint', async () => {
    const fetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      expect(requestUrl(input)).toBe('https://discord.com/api/v10/users/@me/guilds/1478428628709802166/member');
      expect(requestHeader(init, 'authorization')).toBe('Bearer discord-access');
      return Response.json({
        nick: 'Guild Name',
        roles: ['1528065925264445622'],
        pending: true,
        user: {
          id: '999999999999999999',
          username: 'handle',
          global_name: 'Global Name',
          avatar: null,
        },
      });
    });
    await expect(
      fetchDiscordGuildMember('discord-access', '1478428628709802166', fetchImpl),
    ).resolves.toEqual({
      nick: 'Guild Name',
      roles: ['1528065925264445622'],
      pending: true,
      user: {
        id: '999999999999999999',
        username: 'handle',
        globalName: 'Global Name',
        avatar: null,
      },
    });
  });

  it('keeps a not-a-member 404 distinguishable for capability resolution', async () => {
    const fetchImpl = vi.fn(async () => new Response('Unknown Member', { status: 404 }));
    await expect(
      fetchDiscordGuildMember('discord-access', '1478428628709802166', fetchImpl),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('discordAvatarUrl', () => {
  it('builds a PNG CDN url for a static avatar', () => {
    const url = discordAvatarUrl({ id: '1', username: 'x', avatar: 'abc123' });
    expect(url).toBe('https://cdn.discordapp.com/avatars/1/abc123.png');
  });

  it('builds a GIF url for an animated avatar (the a_ prefix)', () => {
    const url = discordAvatarUrl({ id: '1', username: 'x', avatar: 'a_abc123' });
    expect(url).toBe('https://cdn.discordapp.com/avatars/1/a_abc123.gif');
  });

  it('falls back to a default avatar, indexed by (id >> 22) % 6, when there is none', () => {
    const id = 1499130237043081328n;
    const expectedIndex = (id >> 22n) % 6n;
    const url = discordAvatarUrl({ id: id.toString(), username: 'x', avatar: null });
    expect(url).toBe(`https://cdn.discordapp.com/embed/avatars/${expectedIndex}.png`);
  });
});
