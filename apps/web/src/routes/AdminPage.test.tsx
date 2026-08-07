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
  user: { id: 'admin-1', username: 'admin-person', avatarUrl: null, role: 'admin' },
};

function targetUser(overrides: Record<string, unknown> = {}) {
  return { id: 'user-2', username: 'promotable', role: 'user', blocked: false, blockedReason: null, ...overrides };
}

function stubFetch(handleOther: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/token')) return Response.json(AUTH_RESPONSE);
      return handleOther(url, init);
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AdminPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function waitForAuthReady() {
  await screen.findByRole('button', { name: 'Search' });
}

describe('AdminPage', () => {
  it('searches for a user by username and lists results', async () => {
    stubFetch((url) => {
      expect(url).toContain('/api/v1/users');
      expect(url).toContain('q=promo');
      return Response.json({ users: [targetUser()] });
    });
    renderPage();
    await waitForAuthReady();

    fireEvent.change(screen.getByPlaceholderText('Search by username'), { target: { value: 'promo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('promotable')).toBeInTheDocument();
  });

  it('promotes a user to moderator', async () => {
    let sentRole = '';
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        sentRole = JSON.parse(String(init.body)).role;
        return Response.json(targetUser({ role: sentRole }));
      }
      return Response.json({ users: [targetUser()] });
    });
    renderPage();
    await waitForAuthReady();

    fireEvent.change(screen.getByPlaceholderText('Search by username'), { target: { value: 'promotable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('promotable');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'moderator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(sentRole).toBe('moderator'));
  });

  it('requires a reason to block, then shows the blocked state', async () => {
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        return Response.json(targetUser({ blocked: true, blockedReason: body.reason }));
      }
      return Response.json({ users: [targetUser()] });
    });
    renderPage();
    await waitForAuthReady();

    fireEvent.change(screen.getByPlaceholderText('Search by username'), { target: { value: 'promotable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('promotable');

    const blockButton = screen.getByRole('button', { name: 'Block' });
    expect(blockButton).toBeDisabled(); // no reason yet

    fireEvent.change(screen.getByPlaceholderText('Reason to block'), { target: { value: 'spam' } });
    expect(blockButton).toBeEnabled();
    fireEvent.click(blockButton);

    expect(await screen.findByText(/blocked: spam/)).toBeInTheDocument();
  });
});
