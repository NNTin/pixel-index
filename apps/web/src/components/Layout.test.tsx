import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { Layout } from './Layout';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubFetch(discordInviteUrl: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/meta')) {
        return Response.json({
          schemaVersion: 1,
          generatedAt: '2026-01-01T00:00:00.000Z',
          pixelAgents: { version: null, commit: null, layoutRevision: 0 },
          count: 0,
          discordInviteUrl,
        });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<p>page content</p>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Layout header nav', () => {
  it('shows the Discord invite to a logged-out visitor — joining is not gated behind authentication', async () => {
    stubFetch('https://discord.gg/pixel-index');
    renderLayout();
    const invite = await screen.findByRole('link', { name: 'Discord' });
    expect(invite).toHaveAttribute('href', 'https://discord.gg/pixel-index');
  });

  it('renders no Discord link when no guild invite is configured', async () => {
    stubFetch(null);
    renderLayout();
    await screen.findByText('page content');
    expect(screen.queryByRole('link', { name: 'Discord' })).not.toBeInTheDocument();
  });
});
