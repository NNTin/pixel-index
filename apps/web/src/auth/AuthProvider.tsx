import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { discordLoginUrl, exchangeLoginCode, getMe, logoutSession, refreshTokens } from '../api/authClient';
import type { AuthUser } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthStatus } from './authState';
import { clearStoredRefreshToken, getStoredRefreshToken, setStoredRefreshToken } from './storage';

const LOGIN_CODE_HASH_KEY = 'pixelIndexLoginCode';
// Refresh a bit before actual expiry, and never schedule less than a few
// seconds out — a clock skew or a slow request must not cause a refresh
// loop.
const REFRESH_SAFETY_MARGIN_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 5_000;

function consumeLoginCodeFromHash(): string | null {
  if (!location.hash.includes(LOGIN_CODE_HASH_KEY)) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get(LOGIN_CODE_HASH_KEY);
  // Cleared immediately regardless of outcome — a single-use code has no
  // business sitting in the address bar (browser history, screen shares).
  history.replaceState(null, '', location.pathname + location.search);
  return code;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // A ref, not state: the refresh timer's closure always needs the LATEST
  // refresh token (it rotates on every use), and re-registering the effect
  // on every rotation would be its own source of bugs.
  const refreshTokenRef = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTokenRef.current = null;
    clearStoredRefreshToken();
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const scheduleRefresh = useCallback(
    function schedule(expiresInMs: number) {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const delay = Math.max(expiresInMs - REFRESH_SAFETY_MARGIN_MS, MIN_REFRESH_DELAY_MS);
      refreshTimer.current = setTimeout(async () => {
        const stored = refreshTokenRef.current;
        if (!stored) return;
        try {
          const pair = await refreshTokens(stored);
          refreshTokenRef.current = pair.refreshToken;
          setStoredRefreshToken(pair.refreshToken);
          setAccessToken(pair.accessToken);
          getMe(pair.accessToken).then(setUser).catch(() => {});
          schedule(pair.expiresInMs);
        } catch {
          // Rotation reuse or expiry means the session is over rather than
          // retriable. Discord capability is refreshed separately via /me.
          clearSession();
        }
      }, delay);
    },
    [clearSession],
  );

  useEffect(() => {
    let cancelled = false;

    async function establishSession() {
      const code = consumeLoginCodeFromHash();
      try {
        if (code) {
          const result = await exchangeLoginCode(code);
          if (cancelled) return;
          refreshTokenRef.current = result.refreshToken;
          setStoredRefreshToken(result.refreshToken);
          setAccessToken(result.accessToken);
          setUser(result.user);
          setStatus('authenticated');
          scheduleRefresh(result.expiresInMs);
          return;
        }

        const stored = getStoredRefreshToken();
        if (!stored) {
          if (!cancelled) setStatus('anonymous');
          return;
        }
        const pair = await refreshTokens(stored);
        if (cancelled) return;
        refreshTokenRef.current = pair.refreshToken;
        setStoredRefreshToken(pair.refreshToken);
        const me = await getMe(pair.accessToken);
        if (cancelled) return;
        setAccessToken(pair.accessToken);
        setUser(me);
        setStatus('authenticated');
        scheduleRefresh(pair.expiresInMs);
      } catch {
        if (!cancelled) clearSession();
      }
    }

    void establishSession();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — re-establishing on every render would spam
    // the refresh/token endpoints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capability is deliberately not embedded in the JWT. Refresh `/me` on
  // the server-advertised Discord cache cadence while this page is active,
  // and immediately when the user returns to it after changing a role.
  useEffect(() => {
    if (status !== 'authenticated' || !accessToken || !user) return;
    let cancelled = false;
    const refreshUser = () => {
      if (document.visibilityState === 'hidden') return;
      getMe(accessToken)
        .then((next) => { if (!cancelled) setUser(next); })
        .catch(() => {}); // Temporary Discord/API failure must not destroy the session.
    };
    const interval = window.setInterval(refreshUser, Math.max(user.capabilityCacheTtlMs, 5_000));
    window.addEventListener('focus', refreshUser);
    document.addEventListener('visibilitychange', refreshUser);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshUser);
      document.removeEventListener('visibilitychange', refreshUser);
    };
  }, [status, accessToken, user]);

  const login = useCallback(() => {
    const returnTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    window.location.href = discordLoginUrl(returnTo);
  }, []);

  const logout = useCallback(() => {
    const stored = refreshTokenRef.current;
    clearSession();
    if (stored) void logoutSession(stored).catch(() => {}); // best-effort — the client-side session is already gone either way
  }, [clearSession]);

  const value: AuthContextValue = { status, user, accessToken, login, logout };

  return <AuthContext value={value}>{children}</AuthContext>;
}
