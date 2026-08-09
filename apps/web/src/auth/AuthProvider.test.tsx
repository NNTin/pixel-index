import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestJson, requestUrl } from '../test/fetchStub';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './authState';
import { getStoredRefreshToken } from './storage';

function authUser(overrides: Record<string, unknown> = {}) {
  return { id: 'user-1', username: 'someone', displayName: 'someone', avatarUrl: null, role: 'user', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null }, ...overrides };
}

function Probe() {
  const { status, user, accessToken, login, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.username ?? 'none'}</p>
      <p data-testid="token">{accessToken ?? 'none'}</p>
      <button onClick={login}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AuthProvider — establishing a session on mount', () => {
  it('is anonymous when there is no stored refresh token and no login code', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('exchanges a login code found in the URL hash, then clears it from the address bar', async () => {
    location.hash = '#pixelIndexLoginCode=abc123';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        expect(url).toContain('/api/v1/auth/token');
        return Response.json({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresInMs: 900_000,
          user: authUser(),
        });
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('someone');
    expect(screen.getByTestId('token')).toHaveTextContent('access-1');
    expect(location.hash).toBe(''); // single-use code never lingers in history
    expect(getStoredRefreshToken()).toBe('refresh-1'); // only the refresh token is persisted
  });

  it('restores a session from a stored refresh token, via refresh then /me', async () => {
    localStorage.setItem('pixelindex_refresh_token', 'stored-refresh');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        calls.push(url);
        if (url.includes('/auth/refresh')) {
          return Response.json({ accessToken: 'access-2', refreshToken: 'rotated-refresh', expiresInMs: 900_000 });
        }
        if (url.includes('/api/v1/me')) {
          return Response.json(authUser({ username: 'restored-user' }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('restored-user');
    expect(getStoredRefreshToken()).toBe('rotated-refresh'); // rotated token replaces the stored one
  });

  it('clears everything if the stored refresh token is rejected', async () => {
    localStorage.setItem('pixelindex_refresh_token', 'stale-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(getStoredRefreshToken()).toBeNull();
  });
});

describe('AuthProvider — login and logout', () => {
  it('login() navigates to the API discord-login URL with the SPA origin as returnTo', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

    const original = window.location;
    let assignedHref = '';
    // jsdom's window.location cannot be reassigned directly; stub just the
    // setter path this exercises. Built field by field rather than spreading
    // `original`: Location is a class instance, and spreading it would drop its
    // prototype (assign, reload, replace) while looking like it had copied it.
    Object.defineProperty(window, 'location', {
      value: {
        origin: original.origin,
        set href(value: string) {
          assignedHref = value;
        },
        get href() {
          return assignedHref;
        },
      },
      writable: true,
    });

    act(() => screen.getByText('login').click());
    expect(assignedHref).toContain('/api/v1/auth/discord/login');
    expect(assignedHref).toContain(encodeURIComponent(original.origin));

    Object.defineProperty(window, 'location', { value: original, writable: true });
  });

  it('logout() clears local state and calls the logout endpoint with the stored refresh token', async () => {
    location.hash = '#pixelIndexLoginCode=code-1';
    const loggedOutWith: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes('/auth/token')) {
          return Response.json({
            accessToken: 'access-3',
            refreshToken: 'refresh-3',
            expiresInMs: 900_000,
            user: authUser(),
          });
        }
        if (url.includes('/auth/logout')) {
          loggedOutWith.push(requestJson<{ refreshToken: string }>(init).refreshToken);
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    act(() => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(getStoredRefreshToken()).toBeNull();
    expect(loggedOutWith).toEqual(['refresh-3']);
  });
});

describe('AuthProvider — Discord capability freshness', () => {
  it('refreshes /me when the window regains focus', async () => {
    location.hash = '#pixelIndexLoginCode=focus-code';
    let meCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/auth/token')) {
          return Response.json({
            accessToken: 'focus-access',
            refreshToken: 'focus-refresh',
            expiresInMs: 900_000,
            user: authUser({ username: 'before-focus' }),
          });
        }
        if (url.includes('/api/v1/me')) {
          meCalls += 1;
          return Response.json(authUser({ username: 'after-focus', role: 'moderator' }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(meCalls).toBe(1));
    expect(screen.getByTestId('user')).toHaveTextContent('after-focus');
  });
});
