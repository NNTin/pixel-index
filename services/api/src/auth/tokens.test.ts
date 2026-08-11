import { assert, describe, expect, it } from 'vitest';

import { generateOpaqueToken, hashToken, signAccessToken, verifyAccessToken } from './tokens.js';

const SECRET = 'a'.repeat(32);

describe('access tokens', () => {
  it('round-trips the claims it was signed with', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET, 60_000);
    const claims = await verifyAccessToken(token, SECRET);
    expect(claims).toEqual({ sub: 'user-1' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET, 60_000);
    expect(await verifyAccessToken(token, 'b'.repeat(32))).toBeNull();
  });

  it('rejects an expired token', async () => {
    // Negative TTL puts exp in the past immediately, no need to wait.
    const token = await signAccessToken({ sub: 'user-1' }, SECRET, -1000);
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });

  it('rejects a token with a tampered payload', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET, 60_000);
    // Asserted rather than interpolated straight in: a token that stopped
    // having two dots would make `forged` the string "undefined.….undefined",
    // which verifyAccessToken also rejects — so this test would keep passing
    // while testing nothing.
    const [header, , signature] = token.split('.');
    assert(header !== undefined && signature !== undefined, 'a JWT has three dot-separated parts');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user-1', role: 'admin' })).toString(
      'base64url',
    );
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(await verifyAccessToken(forged, SECRET)).toBeNull();
  });

  it('rejects garbage rather than throwing', async () => {
    await expect(verifyAccessToken('not.a.jwt', SECRET)).resolves.toBeNull();
    await expect(verifyAccessToken('', SECRET)).resolves.toBeNull();
  });

  it('does not put a supplied legacy role claim in a newly signed token', async () => {
    const token = await signAccessToken(
      { sub: 'user-1', role: 'superadmin' as never },
      SECRET,
      60_000,
    );
    expect(await verifyAccessToken(token, SECRET)).toEqual({ sub: 'user-1' });
  });
});

describe('opaque tokens', () => {
  it('generates a value that is not the stored hash', () => {
    const { value, hash } = generateOpaqueToken();
    expect(value).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is not predictable across calls', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.value).not.toBe(b.value);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashToken is deterministic — required for the lookup-by-hash pattern', () => {
    const { value, hash } = generateOpaqueToken();
    expect(hashToken(value)).toBe(hash);
  });
});
