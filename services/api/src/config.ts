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
  /** The renderer service (#4). Not yet called by any route in #5. */
  rendererUrl: string;
  /** Exact origins allowed to call the API with credentials. No wildcards. */
  webOrigins: string[];

  /** Read now so #7 only has to add logic, not config. */
  discordClientId: string;
  discordClientSecret: string;

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

    discordClientId: requireEnv('DISCORD_CLIENT_ID', problems),
    discordClientSecret: requireEnv('DISCORD_CLIENT_SECRET', problems),

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
