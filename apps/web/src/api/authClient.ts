/**
 * The cross-origin bearer-token flow ADR 0001 decision 10 designs: a
 * top-level browser redirect through Discord and back, a single-use code
 * handed off via a URL fragment, then ordinary CORS `fetch` calls for
 * everything after. See `auth/AuthProvider.tsx` for the state machine that
 * drives these.
 */
import { API_BASE_URL, apiRequest } from './client';
import type { AuthUser, TokenExchangeResponse, TokenPair } from './types';

/**
 * A real top-level navigation, not a fetch — the browser's whole tab moves
 * through Discord and back to `/callback` on the API's own origin. `returnTo`
 * must be one of the API's allowlisted web origins (`resolveReturnTo`,
 * `services/api/src/auth/routes.ts`) or it silently falls back to the first
 * configured origin; passing the SPA's own current origin always satisfies
 * that on a correctly configured deployment.
 */
export function discordLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({ returnTo });
  return `${API_BASE_URL}/api/v1/auth/discord/login?${params.toString()}`;
}

export function exchangeLoginCode(code: string): Promise<TokenExchangeResponse> {
  return apiRequest('/api/v1/auth/token', { method: 'POST', body: { code } });
}

export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return apiRequest('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken } });
}

export function logoutSession(refreshToken: string): Promise<void> {
  return apiRequest('/api/v1/auth/logout', { method: 'POST', body: { refreshToken }, parseAs: 'none' });
}

export function getMe(accessToken: string): Promise<AuthUser> {
  return apiRequest('/api/v1/me', { accessToken });
}
