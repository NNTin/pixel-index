import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { discordLoginUrl, exchangeLoginCode, getMe, logoutSession, refreshTokens } from '../api/authClient';
import type { AuthUser } from '../api/types';
import { clearStoredRefreshToken, getStoredRefreshToken, setStoredRefreshToken } from './storage';

const LOGIN_CODE_HASH_KEY = 'pixelIndexLoginCode';
// Refresh a bit before actual expiry, and never schedule less than a few
// seconds out — a clock skew or a slow request must not cause a refresh
// loop.
const REFRESH_SAFETY_MARGIN_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 5_000;

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** In-memory only (ADR 0001 decision 10; see auth/storage.ts) — null until a session is established. */
  accessToken: string | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    (expiresInMs: number) => {
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
          scheduleRefresh(pair.expiresInMs);
        } catch {
          // Rotation reuse, expiry, or a block (rotateRefreshToken re-checks
          // blockedAt on every call, ADR 0001 decision 10) — any failure
          // here means the session is over, not retriable.
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

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
