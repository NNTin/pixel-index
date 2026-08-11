import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthProvider';
import { RequireAuth } from './RequireAuth';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  location.hash = '';
});

function renderGated(role?: 'moderator' | 'admin') {
  return render(
    <AuthProvider>
      <RequireAuth role={role}>
        <p>protected content</p>
      </RequireAuth>
    </AuthProvider>,
  );
}

describe('RequireAuth', () => {
  it('prompts to log in when anonymous', async () => {
    renderGated();
    expect(await screen.findByText('Log in with Discord to use this page.')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders children once authenticated, with no role requirement', async () => {
    location.hash = '#pixelIndexLoginCode=code-1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          accessToken: 'a',
          refreshToken: 'r',
          expiresInMs: 900_000,
          user: { id: '1', username: 'plain-user', displayName: 'plain-user', avatarUrl: null, role: 'user', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
        }),
      ),
    );
    renderGated();
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('blocks a plain user from a moderator-gated page — client-side UX only, not the real enforcement', async () => {
    location.hash = '#pixelIndexLoginCode=code-2';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          accessToken: 'a',
          refreshToken: 'r',
          expiresInMs: 900_000,
          user: { id: '1', username: 'plain-user', displayName: 'plain-user', avatarUrl: null, role: 'user', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
        }),
      ),
    );
    renderGated('moderator');
    expect(await screen.findByText('This page is for moderators only.')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('lets a moderator through a moderator-gated page', async () => {
    location.hash = '#pixelIndexLoginCode=code-3';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          accessToken: 'a',
          refreshToken: 'r',
          expiresInMs: 900_000,
          user: { id: '1', username: 'mod-user', displayName: 'mod-user', avatarUrl: null, role: 'moderator', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
        }),
      ),
    );
    renderGated('moderator');
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('an admin satisfies a moderator-only gate (rank, not exact match)', async () => {
    location.hash = '#pixelIndexLoginCode=code-4';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          accessToken: 'a',
          refreshToken: 'r',
          expiresInMs: 900_000,
          user: { id: '1', username: 'admin-user', displayName: 'admin-user', avatarUrl: null, role: 'admin', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
        }),
      ),
    );
    renderGated('moderator');
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('a moderator does not satisfy an admin-only gate', async () => {
    location.hash = '#pixelIndexLoginCode=code-5';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          accessToken: 'a',
          refreshToken: 'r',
          expiresInMs: 900_000,
          user: { id: '1', username: 'mod-user', displayName: 'mod-user', avatarUrl: null, role: 'moderator', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
        }),
      ),
    );
    renderGated('admin');
    expect(await screen.findByText('This page is for admins only.')).toBeInTheDocument();
  });
});
