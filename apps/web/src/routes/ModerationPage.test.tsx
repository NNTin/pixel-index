import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { ModerationPage } from './ModerationPage';

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
  user: { id: 'mod-1', username: 'mod-person', displayName: 'mod-person', avatarUrl: null, role: 'moderator', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
};

function ownerView(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'reported-office',
    title: 'Reported Office',
    author: { id: 'other-1', username: 'someone-else', displayName: 'someone-else', avatarUrl: null },
    description: '',
    tags: [],
    cols: 4,
    rows: 4,
    furniture: 0,
    areas: 0,
    pets: 0,
    carpets: 0,
    layoutRevision: 1,
    pixelAgentsVersion: '1.4.0',
    bytes: 10,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: { layout: '', preview: '', thumbnail: '' },
    layout: {},
    visibility: 'public',
    visibilityReason: null,
    visibilityChangedAt: null,
    ...overrides,
  };
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
        <ModerationPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ModerationPage', () => {
  it('lists layouts across authors and visibilities', async () => {
    stubFetch(() =>
      Response.json({ schemaVersion: 1, total: 1, layouts: [ownerView()], nextCursor: null }),
    );
    renderPage();
    expect(await screen.findByText('Reported Office')).toBeInTheDocument();
    expect(screen.getByText(/someone-else/)).toBeInTheDocument();
  });

  it('sends the reason typed alongside a visibility change', async () => {
    let sentBody: { visibility?: string; reason?: string } = {};
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        sentBody = JSON.parse(String(init.body));
        return Response.json(ownerView({ visibility: 'hidden', visibilityReason: sentBody.reason }));
      }
      return Response.json({ schemaVersion: 1, total: 1, layouts: [ownerView()], nextCursor: null });
    });
    renderPage();
    await screen.findByText('Reported Office');

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    // Two comboboxes exist: the page-level visibility filter, and this
    // row's own visibility select — the row's is the second.
    const rowVisibilitySelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(rowVisibilitySelect, { target: { value: 'hidden' } });
    fireEvent.change(screen.getByPlaceholderText(/Reason/), { target: { value: 'inappropriate content' } });
    fireEvent.click(applyButton);

    await waitFor(() => expect(sentBody).toMatchObject({ visibility: 'hidden', reason: 'inappropriate content' }));
  });

  it('re-fetches when the visibility filter changes', async () => {
    let lastUrl = '';
    stubFetch((url) => {
      lastUrl = url;
      return Response.json({ schemaVersion: 1, total: 0, layouts: [], nextCursor: null });
    });
    renderPage();
    await screen.findByText('Nothing matches.');

    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'hidden' } });
    await waitFor(() => expect(lastUrl).toContain('visibility=hidden'));
  });
});
