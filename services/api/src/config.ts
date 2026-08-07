/**
 * Configuration, from the environment only.
 *
 * No hostname, domain or deployment-specific string is compiled in — a
 * self-hoster sets `DATABASE_URL`, `RENDERER_URL`, `PUBLIC_WEB_ORIGIN` and the
 * Discord credentials, and nothing else. See ADR 0001, decision 8.
 *
 * Every required variable is validated at boot and reported together, so a
 * misconfigured deployment fails once with a full list rather than one
 * frustrating restart per missing value.
 */

export interface RateLimitBucket {
  max: number;
  windowMs: number;
}

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Refuse an oversized body at the socket, before it is parsed. */
  bodyLimitBytes: number;
  /**
   * Trust `X-Forwarded-For` from the reverse proxy. Required for rate limiting
   * to key on the real client, not the proxy — every deployment in the
   * architecture sits behind one (Traefik, Cloudflare Tunnel), so this defaults
   * to true. A self-hoster exposing the API directly, with no proxy in front,
   * must set it to false or every client shares one rate-limit bucket.
   */
  trustProxy: boolean;

  databaseUrl: string;
  /** The renderer service (#4), proxied by GET /layouts/:slug/{preview,thumbnail}.png (#6). */
  rendererUrl: string;
  /** Exact origins allowed to call the API with credentials. No wildcards. */
  webOrigins: string[];

  /**
   * Where the pinned upstream lives, for `GET /api/v1/meta`'s `pixelAgents`
   * field (layout-core's `upstreamPin()`). Optional: auto-discovered by
   * walking up from this package in a normal checkout; a container needs it
   * explicit because the copied `vendor/pixel-agents` sits at a fixed path
   * with no ancestor relationship to worry about.
   */
  upstreamDir?: string;
  /**
   * A container's copy of `vendor/pixel-agents` has no `.git`, so
   * `upstreamPin()` cannot read the commit itself — same trap as the
   * renderer's `PIXEL_AGENTS_COMMIT` (services/renderer/src/config.ts), same fix.
   */
  upstreamCommit?: string;

  discordClientId: string;
  discordClientSecret: string;
  /**
   * This API's own externally-reachable origin. The OAuth `redirect_uri` sent
   * to Discord is always `${publicApiOrigin}/callback` — never derived from
   * request input — which is what "the redirect URI is allowlisted" means in
   * practice for a value Discord itself also strictly matches against what is
   * registered in the Developer Portal. Both sides have to agree on this
   * value; see auth/discord.ts and the ADR.
   */
  publicApiOrigin: string;
  /** Signs access tokens (HS256) and the transient OAuth state cookie. */
  sessionSecret: string;
  /**
   * A Discord user id to promote to `admin` on login, so a self-hoster can
   * bootstrap their first admin from `.env` with no SQL and no UI. Optional:
   * once at least one admin exists, most deployments never need it again.
   */
  initialAdminDiscordId?: string;
  /** How long a minted access token is valid without a fresh DB lookup. */
  accessTokenTtlMs: number;
  /** How long an unused refresh token stays valid. */
  refreshTokenTtlMs: number;
  /** How long the post-login handoff code to the SPA stays valid. */
  loginCodeTtlMs: number;

  rateLimit: RateLimitBucket;
  /** Tighter bucket for #8's submission and #4's render-triggering paths. */
  writeRateLimit: RateLimitBucket;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function intFromEnv(name: string, fallback: number, problems: string[]): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    problems.push(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return Math.floor(value);
}

function boolFromEnv(name: string, fallback: boolean, problems: string[]): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  problems.push(`${name} must be "true" or "false", got ${JSON.stringify(raw)}`);
  return fallback;
}

function requireEnv(name: string, problems: string[]): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    problems.push(`${name} is required`);
    return '';
  }
  return raw;
}

/** @param schemes Accepted URL schemes, without the trailing colon. */
function requireUrl(name: string, problems: string[], schemes: string[]): string {
  const raw = requireEnv(name, problems);
  if (raw === '') return raw;
  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, '');
    if (!schemes.includes(scheme)) {
      problems.push(
        `${name} must use one of [${schemes.join(', ')}], got ${JSON.stringify(raw)}`,
      );
    }
  } catch {
    problems.push(`${name} must be a valid URL, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * A comma-separated list of exact origins — scheme + host + optional port,
 * nothing else. `new URL(origin).origin === origin` is what rules out a path,
 * query string or trailing slash sneaking in and silently never matching a
 * real browser Origin header.
 */
function requireOriginList(name: string, problems: string[]): string[] {
  const raw = requireEnv(name, problems);
  if (raw === '') return [];

  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (origins.length === 0) {
    problems.push(`${name} must contain at least one origin`);
    return [];
  }

  const valid: string[] = [];
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin) {
        problems.push(
          `${name} entry ${JSON.stringify(origin)} must be an origin only (no path, query or trailing slash)`,
        );
        continue;
      }
      valid.push(url.origin);
    } catch {
      problems.push(`${name} entry ${JSON.stringify(origin)} is not a valid origin`);
    }
  }
  return valid;
}

/** The single-value form of `requireOriginList` — exactly one origin, nothing else. */
function requireOrigin(name: string, problems: string[]): string {
  const raw = requireEnv(name, problems);
  if (raw === '') return raw;
  try {
    const url = new URL(raw);
    if (url.origin !== raw) {
      problems.push(
        `${name} must be an origin only (no path, query or trailing slash), got ${JSON.stringify(raw)}`,
      );
      return url.origin;
    }
    return url.origin;
  } catch {
    problems.push(`${name} is not a valid origin, got ${JSON.stringify(raw)}`);
    return raw;
  }
}

const MIN_SESSION_SECRET_LENGTH = 32;

function requireSessionSecret(problems: string[]): string {
  const raw = requireEnv('SESSION_SECRET', problems);
  if (raw !== '' && raw.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters ` +
        `(got ${raw.length}) — short signing keys are brute-forceable. ` +
        'Generate one with: openssl rand -base64 48',
    );
  }
  return raw;
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw;
}

export function loadConfig(): ApiConfig {
  const problems: string[] = [];

  const config: ApiConfig = {
    host: process.env.API_HOST ?? '::',
    port: intFromEnv('API_PORT', 3000, problems),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    bodyLimitBytes: intFromEnv('API_BODY_LIMIT_BYTES', 5_000_000, problems),
    trustProxy: boolFromEnv('API_TRUST_PROXY', true, problems),

    databaseUrl: requireUrl('DATABASE_URL', problems, ['postgres', 'postgresql']),
    rendererUrl: requireUrl('RENDERER_URL', problems, ['http', 'https']),
    webOrigins: requireOriginList('PUBLIC_WEB_ORIGIN', problems),

    ...(optionalEnv('PIXEL_AGENTS_DIR') ? { upstreamDir: optionalEnv('PIXEL_AGENTS_DIR') } : {}),
    ...(optionalEnv('PIXEL_AGENTS_COMMIT')
      ? { upstreamCommit: optionalEnv('PIXEL_AGENTS_COMMIT') }
      : {}),

    discordClientId: requireEnv('DISCORD_CLIENT_ID', problems),
    discordClientSecret: requireEnv('DISCORD_CLIENT_SECRET', problems),
    publicApiOrigin: requireOrigin('PUBLIC_API_ORIGIN', problems),
    sessionSecret: requireSessionSecret(problems),
    ...(optionalEnv('INITIAL_ADMIN_DISCORD_ID')
      ? { initialAdminDiscordId: optionalEnv('INITIAL_ADMIN_DISCORD_ID') }
      : {}),
    accessTokenTtlMs: intFromEnv('ACCESS_TOKEN_TTL_MS', 15 * 60_000, problems),
    refreshTokenTtlMs: intFromEnv('REFRESH_TOKEN_TTL_MS', 30 * 24 * 60 * 60_000, problems),
    loginCodeTtlMs: intFromEnv('LOGIN_CODE_TTL_MS', 60_000, problems),

    rateLimit: {
      max: intFromEnv('RATE_LIMIT_MAX', 300, problems),
      windowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 60_000, problems),
    },
    writeRateLimit: {
      max: intFromEnv('RATE_LIMIT_WRITE_MAX', 20, problems),
      windowMs: intFromEnv('RATE_LIMIT_WRITE_WINDOW_MS', 60_000, problems),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
