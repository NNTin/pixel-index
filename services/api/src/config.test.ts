import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

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
  'INITIAL_ADMIN_DISCORD_ID',
  'ACCESS_TOKEN_TTL_MS',
  'REFRESH_TOKEN_TTL_MS',
  'LOGIN_CODE_TTL_MS',
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
    });
    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.bodyLimitBytes).toBe(1024);
    expect(config.trustProxy).toBe(false);
    expect(config.rateLimit).toEqual({ max: 10, windowMs: 5000 });
    expect(config.writeRateLimit).toEqual({ max: 2, windowMs: 1000 });
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
