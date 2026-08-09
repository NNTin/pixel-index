/**
 * The Discord side of the OAuth2 authorization-code flow.
 *
 * Nothing here touches Fastify, Postgres or cookies — it is a thin, directly
 * testable wrapper over Discord's HTTP API, with `fetch` as an injectable
 * dependency so the routes that use it can be tested without a network call.
 */

import { createHash, randomBytes } from 'node:crypto';

const DISCORD_API = 'https://discord.com/api/v10';
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

export interface DiscordCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 S256: a random verifier, and the challenge derived from it. */
export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(
  credentials: Pick<DiscordCredentials, 'clientId' | 'redirectUri'>,
  state: string,
  codeChallenge: string,
  readGuildMember = false,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', credentials.clientId);
  url.searchParams.set('redirect_uri', credentials.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', readGuildMember ? 'identify guilds.members.read' : 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Never silently re-use a stale Discord session's consent — a user who
  // switched accounts should be asked, not signed in as whoever last said yes.
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export async function exchangeCodeForToken(
  credentials: DiscordCredentials,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordTokenResponse> {
  const response = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: credentials.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(`Discord token exchange failed: ${body || response.statusText}`, response.status);
  }
  return (await response.json()) as DiscordTokenResponse;
}

/** Refresh a retained user OAuth grant; Discord may rotate the refresh token. */
export async function refreshDiscordToken(
  credentials: Pick<DiscordCredentials, 'clientId' | 'clientSecret'>,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordTokenResponse> {
  const response = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(`Discord token refresh failed: ${body || response.statusText}`, response.status);
  }
  return (await response.json()) as DiscordTokenResponse;
}

export interface DiscordUser {
  id: string;
  username: string;
  globalName?: string | null;
  /** The raw avatar hash. `null` means Discord's default avatar. */
  avatar: string | null;
}

export async function fetchDiscordUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUser> {
  const response = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(`Discord profile fetch failed: ${body || response.statusText}`, response.status);
  }
  const user = (await response.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
  };
}

export interface DiscordGuildMember {
  nick: string | null;
  roles: string[];
  pending: boolean;
  user: DiscordUser | null;
}

/** The current OAuth user's membership in one configured guild. */
export async function fetchDiscordGuildMember(
  accessToken: string,
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordGuildMember> {
  const response = await fetchImpl(
    `${DISCORD_API}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(
      `Discord guild member fetch failed: ${body || response.statusText}`,
      response.status,
    );
  }
  const member = (await response.json()) as {
    nick?: string | null;
    roles: string[];
    pending?: boolean;
    user?: {
      id: string;
      username: string;
      global_name: string | null;
      avatar: string | null;
    };
  };
  return {
    nick: member.nick ?? null,
    roles: member.roles,
    // Product decision: pending members count as members, but retaining the
    // flag in this boundary keeps Discord's response explicit/testable.
    pending: member.pending ?? false,
    user: member.user
      ? {
          id: member.user.id,
          username: member.user.username,
          globalName: member.user.global_name,
          avatar: member.user.avatar,
        }
      : null,
  };
}

/** The CDN URL for a user's avatar, or Discord's default for that user if they have none. */
export function discordAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
  }
  // Discord's newer default-avatar index is derived from the id alone.
  const index = (BigInt(user.id) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
