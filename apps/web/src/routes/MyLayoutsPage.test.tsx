import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthProvider';
import { requestJson, requestUrl } from '../test/fetchStub';
import { MyLayoutsPage } from './MyLayoutsPage';

beforeEach(() => {
  location.hash = '#pixelIndexLoginCode=test-code';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  location.hash = '';
});

const AUTH_RESPONSE = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresInMs: 900_000,
  user: { id: 'owner-1', username: 'someone', displayName: 'someone', avatarUrl: null, role: 'user', capabilityCheckedAt: null, capabilityCacheTtlMs: 60000, submission: { allowed: true, reason: null, inviteUrl: null } },
};

function ownerView(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'my-office',
    title: 'My Office',
    author: { discordId: 'owner-1', username: 'someone', displayName: 'someone', avatarUrl: null },
    description: '',
    tags: [],
    cols: 4,
    rows: 4,
    visibleCols: 4,
    visibleRows: 4,
    furniture: 0,
    areas: 0,
    pets: 0,
    carpets: 0,
    seats: 3,
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

function stubFetch(
  handleOther: (url: string, init?: RequestInit) => Response,
  authResponse: unknown = AUTH_RESPONSE,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/auth/token')) return Response.json(authResponse);
      return handleOther(url, init);
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MyLayoutsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('MyLayoutsPage', () => {
  it('lists the owner\'s layouts with their visibility', async () => {
    stubFetch(() =>
      Response.json({
        schemaVersion: 1,
        total: 1,
        layouts: [ownerView({ visibility: 'hidden', visibilityReason: 'spam' })],
        nextCursor: null,
      }),
    );
    renderPage();
    expect(await screen.findByText('My Office')).toBeInTheDocument();
    expect(screen.getByText(/hidden/)).toBeInTheDocument();
    expect(screen.getByText(/spam/)).toBeInTheDocument();
  });

  it('shows an empty state with no layouts', async () => {
    stubFetch(() => Response.json({ schemaVersion: 1, total: 0, layouts: [], nextCursor: null }));
    renderPage();
    expect(await screen.findByText("You haven't submitted any layouts yet.")).toBeInTheDocument();
  });

  it('deletes a layout after confirmation, and reflects it inline', async () => {
    stubFetch((_url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ schemaVersion: 1, total: 1, layouts: [ownerView()], nextCursor: null });
    });
    renderPage();
    await screen.findByText('My Office');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('Deleted.')).toBeInTheDocument());
  });

  it('lets a departed member delete, but hides edit and replacement actions', async () => {
    stubFetch(
      (_url, init) => {
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json({ schemaVersion: 1, total: 1, layouts: [ownerView()], nextCursor: null });
      },
      {
        ...AUTH_RESPONSE,
        user: {
          ...AUTH_RESPONSE.user,
          submission: {
            allowed: false,
            reason: 'discord_membership_required' as const,
            inviteUrl: 'https://discord.gg/pixel-index',
          },
        },
      },
    );
    renderPage();
    await screen.findByText('My Office');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Replace content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted.')).toBeInTheDocument();
  });

  it('edits title/description/tags via the inline form', async () => {
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        const body = requestJson<{ title?: string }>(init);
        return Response.json(ownerView({ title: body.title }));
      }
      return Response.json({ schemaVersion: 1, total: 1, layouts: [ownerView()], nextCursor: null });
    });
    renderPage();
    await screen.findByText('My Office');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Renamed Office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Renamed Office')).toBeInTheDocument());
  });
});
