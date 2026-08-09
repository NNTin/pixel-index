import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { AdminPage } from './AdminPage';

beforeEach(() => {
  location.hash = '#pixelIndexLoginCode=test-code';
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  location.hash = '';
});

const AUTH_RESPONSE = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresInMs: 900_000,
  user: { id: 'admin-1', username: 'admin-person', displayName: 'Admin Person', avatarUrl: null, role: 'admin', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
};

const TARGET = {
  id: 'user-2',
  username: 'discord-handle',
  displayName: 'Guild Nickname',
  avatarUrl: null,
  capability: 'moderator',
  capabilityCheckedAt: '2026-08-09T12:00:00.000Z',
  layoutCount: 3,
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/token')) return Response.json(AUTH_RESPONSE);
      return Response.json({ users: [TARGET], nextCursor: null });
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider><AdminPage /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('AdminPage', () => {
  it('shows the read-only capability directory and layout count', async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText('Guild Nickname')).toBeInTheDocument();
    expect(screen.getByText('@discord-handle')).toBeInTheDocument();
    expect(screen.getAllByText('Moderator')).toHaveLength(2);
    expect(screen.getByText('3 layouts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /block/i })).not.toBeInTheDocument();
  });

  it('sends username and capability filters to the new admin endpoint', async () => {
    stubFetch();
    renderPage();
    await screen.findByText('Guild Nickname');
    fireEvent.change(screen.getByPlaceholderText('Search by Discord username'), { target: { value: 'handle' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'moderator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
      expect(calls.some((url) =>
        url.includes('/api/v1/admin/users') && url.includes('q=handle') && url.includes('capability=moderator'),
      )).toBe(true);
    });
  });
});
