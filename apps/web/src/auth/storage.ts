/**
 * ADR 0001 decision 10 is explicit about which token goes where: the access
 * token is short-lived and held in memory ONLY, never written to
 * localStorage ("a closed tab already discards it"). The refresh token is
 * the one this file persists — without that, a page reload would demand a
 * full Discord round-trip every time, defeating the point of having a
 * refresh token at all. It is opaque, DB-backed, and rotated on every use
 * (theft of an already-used one revokes the whole session family
 * server-side), which is what makes persisting it an acceptable trade
 * where persisting the access token would not be.
 */
const REFRESH_TOKEN_KEY = 'pixelindex_refresh_token';

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null; // Storage disabled/unavailable (private browsing, etc.) — just means no persisted session.
  }
}

export function setStoredRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    /* no-op — see getStoredRefreshToken */
  }
}

export function clearStoredRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* no-op */
  }
}
