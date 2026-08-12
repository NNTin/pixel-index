import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthProvider';
import { requestUrl } from '../test/fetchStub';
import { AuditLogPage } from './AuditLogPage';

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
  user: {
    id: 'admin-1',
    username: 'admin-person',
    displayName: 'Admin Person',
    avatarUrl: null,
    role: 'admin',
    capabilityCheckedAt: null,
    capabilityCacheTtlMs: 60000,
    submission: { allowed: true, reason: null, inviteUrl: null },
  },
};

const ENTRY = {
  id: 'action-1',
  action: 'layout.hide',
  targetType: 'layout',
  targetId: 'layout-1',
  actorUserId: 'mod-1',
  actorLabel: 'some-moderator',
  reason: 'reported for spam',
  before: { visibility: 'public' },
  after: { visibility: 'hidden' },
  createdAt: '2026-01-01T00:00:00.000Z',
  layoutSlug: 'reported-office',
  layoutTitle: 'Reported Office',
};

function stubFetch(handleOther: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/auth/token')) return Response.json(AUTH_RESPONSE);
      return handleOther(url);
    }),
  );
}

function renderPage(initialEntry = '/admin/history') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <AuditLogPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuditLogPage', () => {
  it('lists history entries with actor, reason, and target layout', async () => {
    stubFetch(() => Response.json({ actions: [ENTRY], nextCursor: null }));
    renderPage();
    // 'Hidden' alone would also match the action-filter <select>'s static
    // option list before the fetch resolves — wait on text unique to the row.
    expect(await screen.findByText('reported for spam')).toBeInTheDocument();
    expect(screen.getByText('by some-moderator')).toBeInTheDocument();
    expect(screen.getByText('reported for spam')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reported Office' })).toHaveAttribute(
      'href',
      '/layouts/reported-office',
    );
  });

  it('pre-fills the slug filter from the URL and offers a Clear affordance', async () => {
    let lastUrl = '';
    stubFetch((url) => {
      lastUrl = url;
      return Response.json({ actions: [], nextCursor: null });
    });
    renderPage('/admin/history?slug=reported-office');
    await screen.findByText('No matching history.');
    expect(lastUrl).toContain('slug=reported-office');
    expect(screen.getByText('reported-office')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('sends the search query and action filter to the endpoint', async () => {
    stubFetch(() => Response.json({ actions: [], nextCursor: null }));
    renderPage();
    await screen.findByText('No matching history.');

    fireEvent.change(screen.getByPlaceholderText('Search by layout slug or title'), {
      target: { value: 'office' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'layout.hide' } });

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map(([input]) => requestUrl(input));
      expect(
        calls.some(
          (url) =>
            url.includes('/api/v1/admin/moderation-actions') &&
            url.includes('q=office') &&
            url.includes('action=layout.hide'),
        ),
      ).toBe(true);
    });
  });
});
