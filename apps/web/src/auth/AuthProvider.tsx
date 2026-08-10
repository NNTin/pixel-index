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
    // Guard only. Nothing below is handed the signal, and that is the point of
    // this comment.
    //
    // establishSession() interleaves awaits with side effects that cannot be
    // taken back: consumeLoginCodeFromHash() has already destroyed a
    // single-use code via history.replaceState before the first await runs;
    // refreshTokens() ROTATES the refresh token server-side, so a request
    // aborted in flight may still have retired the token this browser holds;
    // and setStoredRefreshToken() writes localStorage. An abort would not undo
    // a login, it would leave the browser holding a dead token — and the catch
    // below reads any throw as "the session is over" and calls clearSession().
    // Under StrictMode that would be a logout on every development page load,
    // and on a slow connection a real one.
    //
    // What the flag is for is narrower and still necessary: stopping a
    // resolved response writing state into an unmounted tree.
    const controller = new AbortController();
    const { signal } = controller;
    // A call, not a property read — see the note in PreviewSourceProvider.tsx:
    // lib.dom declares `aborted` readonly, so TypeScript keeps a narrowing from
    // one guard across the await before the next one.
    const superseded = () => signal.aborted;

    async function establishSession() {
      const code = consumeLoginCodeFromHash();
      try {
        if (code) {
          const result = await exchangeLoginCode(code);
          if (superseded()) return;
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
          if (!superseded()) setStatus('anonymous');
          return;
        }
        const pair = await refreshTokens(stored);
        if (superseded()) return;
        refreshTokenRef.current = pair.refreshToken;
        setStoredRefreshToken(pair.refreshToken);
        // No signal, per the note above: a half-abandoned bootstrap is worse
        // than a completed one.
        const me = await getMe(pair.accessToken);
        if (superseded()) return;
        setAccessToken(pair.accessToken);
        setUser(me);
        setStatus('authenticated');
        scheduleRefresh(pair.expiresInMs);
      } catch {
        // The guard matters more here than anywhere else in this file:
        // reaching clearSession() on an unmount would destroy a working
        // session.
        if (!superseded()) clearSession();
      }
    }

    void establishSession();
    return () => {
      controller.abort();
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
    // Unlike the bootstrap above, this one is safe to abort: /me is a plain
    // read with no side effects, and a refresh nobody is waiting for is waste.
    const controller = new AbortController();
    const { signal } = controller;
    const refreshUser = () => {
      if (document.visibilityState === 'hidden') return;
      getMe(accessToken, signal)
        .then((next) => {
          if (!signal.aborted) setUser(next);
        })
        .catch(() => {}); // Temporary Discord/API failure must not destroy the session.
    };
    const interval = window.setInterval(refreshUser, Math.max(user.capabilityCacheTtlMs, 5_000));
    window.addEventListener('focus', refreshUser);
    document.addEventListener('visibilitychange', refreshUser);
    return () => {
      controller.abort();
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
