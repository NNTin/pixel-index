import { afterEach, describe, expect, it } from 'vitest';

import { allowsWebOrigin, ConfigError, loadConfig } from './config.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/pixel_index',
  RENDERER_URL: 'http://renderer.internal:3000',
  PUBLIC_WEB_ORIGIN: 'https://pixel-index.example',
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  PUBLIC_API_ORIGIN: 'https://api.pixel-index.example',
  SESSION_SECRET: 'a'.repeat(32),
} as const;

const ENV_KEYS = [
  ...Object.keys(REQUIRED),
  'API_HOST',
  'API_PORT',
  'LOG_LEVEL',
  'API_BODY_LIMIT_BYTES',
  'API_TRUST_PROXY',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_WRITE_MAX',
  'RATE_LIMIT_WRITE_WINDOW_MS',
  'RATE_LIMIT_EXPORT_MAX',
  'RATE_LIMIT_EXPORT_WINDOW_MS',
  'INITIAL_ADMIN_DISCORD_ID',
  'ACCESS_TOKEN_TTL_MS',
  'REFRESH_TOKEN_TTL_MS',
  'LOGIN_CODE_TTL_MS',
  'PIXEL_AGENTS_DIR',
  'MAX_LAYOUT_BYTES',
  'MAX_SUBMISSIONS_PER_USER_PER_DAY',
  'PUBLIC_WEB_ORIGIN_PATTERNS',
] as const;

function setRequired(overrides: Partial<Record<string, string>> = {}) {
  for (const [key, value] of Object.entries(REQUIRED)) process.env[key] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('loadConfig — required variables', () => {
  it('boots with every required variable set', () => {
    setRequired();
    const config = loadConfig();
    expect(config.databaseUrl).toBe(REQUIRED.DATABASE_URL);
    expect(config.rendererUrl).toBe(REQUIRED.RENDERER_URL);
    expect(config.webOrigins).toEqual(['https://pixel-index.example']);
    expect(config.discordClientId).toBe('client-id');
    expect(config.discordClientSecret).toBe('client-secret');
  });

  it.each(Object.keys(REQUIRED))('fails loudly when %s is missing', (missing) => {
    setRequired({ [missing]: undefined });
    expect(() => loadConfig()).toThrow(ConfigError);
    try {
      loadConfig();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain(missing);
    }
  });

  it('reports every missing variable in one error, not one restart per variable', () => {
    // Nothing set at all.
    try {
      loadConfig();
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      for (const key of Object.keys(REQUIRED)) expect(message).toContain(key);
    }
  });

  it('rejects an empty string the same as unset', () => {
    setRequired({ DISCORD_CLIENT_ID: '   ' });
    expect(() => loadConfig()).toThrow(/DISCORD_CLIENT_ID is required/);
  });
});

describe('loadConfig — RENDERER_URL and DATABASE_URL', () => {
  it('rejects a non-URL', () => {
    setRequired({ RENDERER_URL: 'not a url' });
    expect(() => loadConfig()).toThrow(/RENDERER_URL must be a valid URL/);
  });

  it('rejects a non-http(s) scheme for RENDERER_URL', () => {
    setRequired({ RENDERER_URL: 'ftp://renderer.internal' });
    expect(() => loadConfig()).toThrow(/RENDERER_URL must use one of \[http, https\]/);
  });

  it('accepts a postgres:// DATABASE_URL — which an http(s)-only check would wrongly reject', () => {
    setRequired({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/pixel_index' });
    expect(loadConfig().databaseUrl).toBe('postgresql://user:pass@localhost:5432/pixel_index');
  });

  it('rejects a non-postgres scheme for DATABASE_URL', () => {
    setRequired({ DATABASE_URL: 'http://not-a-database' });
    expect(() => loadConfig()).toThrow(/DATABASE_URL must use one of \[postgres, postgresql\]/);
  });
});

describe('loadConfig — PUBLIC_WEB_ORIGIN', () => {
  it('accepts multiple comma-separated origins', () => {
    setRequired({ PUBLIC_WEB_ORIGIN: 'https://a.example, https://b.example' });
    expect(loadConfig().webOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects an origin with a path — it would silently never match a real Origin header', () => {
    setRequired({ PUBLIC_WEB_ORIGIN: 'https://a.example/some/path' });
    expect(() => loadConfig()).toThrow(/must be an origin only/);
  });

  it('rejects an origin with a trailing slash', () => {
    setRequired({ PUBLIC_WEB_ORIGIN: 'https://a.example/' });
    expect(() => loadConfig()).toThrow(/must be an origin only/);
  });

  it('rejects garbage', () => {
    setRequired({ PUBLIC_WEB_ORIGIN: 'not an origin' });
    expect(() => loadConfig()).toThrow(/is not a valid origin/);
  });
});

describe('loadConfig — PUBLIC_WEB_ORIGIN_PATTERNS (#28: Vercel preview deploys)', () => {
  const VERCEL_PREVIEW = 'https://pixel-index-*-acme-team.vercel.app';

  it('is absent by default — matching stays exact unless you opt in', () => {
    setRequired();
    const config = loadConfig();
    expect(config.webOriginPatterns).toEqual([]);
    expect(allowsWebOrigin(config, 'https://pixel-index-abc123-acme-team.vercel.app')).toBe(false);
  });

  it('matches a per-deploy preview hostname the exact list cannot enumerate', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: VERCEL_PREVIEW });
    const config = loadConfig();
    expect(allowsWebOrigin(config, 'https://pixel-index-abc123-acme-team.vercel.app')).toBe(true);
    expect(allowsWebOrigin(config, 'https://pixel-index-699uclg0a-acme-team.vercel.app')).toBe(true);
  });

  it('still allows the exact PUBLIC_WEB_ORIGIN entries alongside the patterns', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: VERCEL_PREVIEW });
    expect(allowsWebOrigin(loadConfig(), 'https://pixel-index.example')).toBe(true);
  });

  it('accepts several comma-separated patterns', () => {
    setRequired({
      PUBLIC_WEB_ORIGIN_PATTERNS: `${VERCEL_PREVIEW}, https://deploy-preview-*--acme.netlify.app`,
    });
    const config = loadConfig();
    expect(config.webOriginPatterns).toHaveLength(2);
    expect(allowsWebOrigin(config, 'https://deploy-preview-42--acme.netlify.app')).toBe(true);
  });

  it('never lets the wildcard cross a dot — the whole point of the label restriction', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://pixel-index-*.example.com' });
    const config = loadConfig();
    expect(allowsWebOrigin(config, 'https://pixel-index-preview.example.com')).toBe(true);
    expect(allowsWebOrigin(config, 'https://pixel-index-.evil.example.com')).toBe(false);
    expect(allowsWebOrigin(config, 'https://pixel-index-x.evil.example.com')).toBe(false);
  });

  it('anchors both ends, so a prefix or suffix cannot be tacked on', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: VERCEL_PREVIEW });
    const config = loadConfig();
    expect(allowsWebOrigin(config, 'https://evil-pixel-index-abc-acme-team.vercel.app')).toBe(false);
    expect(allowsWebOrigin(config, 'https://pixel-index-abc-acme-team.vercel.app.evil.test')).toBe(false);
  });

  it('requires the wildcard to expand to something — an empty label is not a match', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: VERCEL_PREVIEW });
    expect(allowsWebOrigin(loadConfig(), 'https://pixel-index--acme-team.vercel.app')).toBe(false);
  });

  it('rejects a whole-label wildcard — it would cover every project on a shared domain', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://*.vercel.app' });
    expect(() => loadConfig()).toThrow(/too broad/);
  });

  it('rejects more than one wildcard', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://a-*-b-*.example.com' });
    expect(() => loadConfig()).toThrow(/exactly one "\*"/);
  });

  it('rejects a pattern with no wildcard — that belongs in PUBLIC_WEB_ORIGIN', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://exact.example.com' });
    expect(() => loadConfig()).toThrow(/exactly one "\*"/);
  });

  it('rejects http — a credentialed wildcard over cleartext is not defensible', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'http://pixel-index-*.example.com' });
    expect(() => loadConfig()).toThrow(/must use https/);
  });

  it('rejects a pattern with a path or trailing slash', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://pixel-index-*.example.com/' });
    expect(() => loadConfig()).toThrow(/must be an origin only/);
  });

  it('rejects garbage', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'not-an-origin-*' });
    expect(() => loadConfig()).toThrow(/is not a valid origin/);
  });

  it('reports a bad pattern alongside every other problem, not one restart at a time', () => {
    setRequired({ PUBLIC_WEB_ORIGIN_PATTERNS: 'https://*.vercel.app', SESSION_SECRET: 'short' });
    try {
      loadConfig();
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PUBLIC_WEB_ORIGIN_PATTERNS');
      expect(message).toContain('SESSION_SECRET');
    }
  });
});

describe('loadConfig — PUBLIC_API_ORIGIN', () => {
  it('accepts exactly one origin', () => {
    setRequired({ PUBLIC_API_ORIGIN: 'https://api.example' });
    expect(loadConfig().publicApiOrigin).toBe('https://api.example');
  });

  it('rejects a path — this is what redirect_uri is built from, and it must be exact', () => {
    setRequired({ PUBLIC_API_ORIGIN: 'https://api.example/v1' });
    expect(() => loadConfig()).toThrow(/PUBLIC_API_ORIGIN must be an origin only/);
  });

  it('rejects garbage', () => {
    setRequired({ PUBLIC_API_ORIGIN: 'not a url' });
    expect(() => loadConfig()).toThrow(/PUBLIC_API_ORIGIN is not a valid origin/);
  });
});

describe('loadConfig — SESSION_SECRET', () => {
  it('accepts a secret at the minimum length', () => {
    setRequired({ SESSION_SECRET: 'x'.repeat(32) });
    expect(loadConfig().sessionSecret).toHaveLength(32);
  });

  it('rejects a short secret — short signing keys are brute-forceable', () => {
    setRequired({ SESSION_SECRET: 'too-short' });
    expect(() => loadConfig()).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });
});

describe('loadConfig — auth extras', () => {
  it('INITIAL_ADMIN_DISCORD_ID is optional and absent by default', () => {
    setRequired();
    expect('initialAdminDiscordId' in loadConfig()).toBe(false);
  });

  it('reads INITIAL_ADMIN_DISCORD_ID when set', () => {
    setRequired({ INITIAL_ADMIN_DISCORD_ID: '123456789012345678' });
    expect(loadConfig().initialAdminDiscordId).toBe('123456789012345678');
  });

  it('has sane token TTL defaults: access shorter than refresh', () => {
    setRequired();
    const config = loadConfig();
    expect(config.accessTokenTtlMs).toBeLessThan(config.refreshTokenTtlMs);
    expect(config.loginCodeTtlMs).toBeLessThan(config.accessTokenTtlMs);
  });

  it('reads TTL overrides', () => {
    setRequired({
      ACCESS_TOKEN_TTL_MS: '1000',
      REFRESH_TOKEN_TTL_MS: '2000',
      LOGIN_CODE_TTL_MS: '3000',
    });
    const config = loadConfig();
    expect(config.accessTokenTtlMs).toBe(1000);
    expect(config.refreshTokenTtlMs).toBe(2000);
    expect(config.loginCodeTtlMs).toBe(3000);
  });
});

describe('loadConfig — submission limits (#8)', () => {
  it('has sane defaults matching the renderer\'s own default cap', () => {
    setRequired();
    const config = loadConfig();
    expect(config.maxLayoutBytes).toBe(2_000_000);
    expect(config.maxSubmissionsPerUserPerDay).toBe(20);
  });

  it('reads overrides', () => {
    setRequired({ MAX_LAYOUT_BYTES: '500000', MAX_SUBMISSIONS_PER_USER_PER_DAY: '5' });
    const config = loadConfig();
    expect(config.maxLayoutBytes).toBe(500_000);
    expect(config.maxSubmissionsPerUserPerDay).toBe(5);
  });
});

describe('loadConfig — upstream pin override (#6 /meta)', () => {
  it('is absent by default — auto-discovery is the normal path', () => {
    setRequired();
    expect('upstreamDir' in loadConfig()).toBe(false);
  });

  it('reads the directory when set', () => {
    setRequired({ PIXEL_AGENTS_DIR: '/opt/pixel-agents' });
    expect(loadConfig().upstreamDir).toBe('/opt/pixel-agents');
  });

  it('has no commit knob — the pin is read from the checkout, never configured', () => {
    // A container cannot read the submodule's git, so this used to be a
    // PIXEL_AGENTS_COMMIT build argument. Nobody passed it and every image
    // reported commit: null; it is a committed file now (upstream.ts).
    setRequired();
    expect('upstreamCommit' in loadConfig()).toBe(false);
  });
});

describe('loadConfig — defaults', () => {
  it('binds both IP stacks by default', () => {
    // Probing localhost resolves to ::1 first inside a container; binding
    // dual-stack is what makes an IPv4-only healthcheck (or vice versa) not a
    // trap here the way it was for the v1 static site.
    setRequired();
    expect(loadConfig().host).toBe('::');
  });

  it('trusts the reverse proxy by default', () => {
    setRequired();
    expect(loadConfig().trustProxy).toBe(true);
  });

  it('has sane rate-limit defaults, with the write bucket tighter than the general one', () => {
    setRequired();
    const config = loadConfig();
    expect(config.writeRateLimit.max).toBeLessThan(config.rateLimit.max);
  });

  it('gives the bulk export a tighter bucket still', () => {
    // It is the one read path whose cost scales with the size of the index, so
    // it must not share the general budget that lets a caller make 300 cheap
    // requests a minute (#26).
    setRequired();
    const config = loadConfig();
    expect(config.exportRateLimit.max).toBeLessThan(config.rateLimit.max);
  });
});

describe('loadConfig — overrides', () => {
  it('reads every numeric and boolean knob from the environment', () => {
    setRequired({
      API_PORT: '8080',
      API_BODY_LIMIT_BYTES: '1024',
      API_TRUST_PROXY: 'false',
      RATE_LIMIT_MAX: '10',
      RATE_LIMIT_WINDOW_MS: '5000',
      RATE_LIMIT_WRITE_MAX: '2',
      RATE_LIMIT_WRITE_WINDOW_MS: '1000',
      RATE_LIMIT_EXPORT_MAX: '3',
      RATE_LIMIT_EXPORT_WINDOW_MS: '2000',
    });
    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.bodyLimitBytes).toBe(1024);
    expect(config.trustProxy).toBe(false);
    expect(config.rateLimit).toEqual({ max: 10, windowMs: 5000 });
    expect(config.writeRateLimit).toEqual({ max: 2, windowMs: 1000 });
    expect(config.exportRateLimit).toEqual({ max: 3, windowMs: 2000 });
  });

  it('rejects a non-boolean for API_TRUST_PROXY', () => {
    setRequired({ API_TRUST_PROXY: 'yes' });
    expect(() => loadConfig()).toThrow(/API_TRUST_PROXY must be "true" or "false"/);
  });

  it('rejects a negative number', () => {
    setRequired({ RATE_LIMIT_MAX: '-1' });
    expect(() => loadConfig()).toThrow(/RATE_LIMIT_MAX must be a non-negative number/);
  });

  it('rejects a non-numeric value', () => {
    setRequired({ API_PORT: 'eighty' });
    expect(() => loadConfig()).toThrow(/API_PORT must be a non-negative number/);
  });
});
