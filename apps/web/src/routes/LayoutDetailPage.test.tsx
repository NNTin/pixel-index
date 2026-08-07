import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayoutDetailPage } from './LayoutDetailPage';

afterEach(() => vi.unstubAllGlobals());

function detail(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'blue-office',
    title: 'Blue Office',
    author: { id: null, username: 'someone', avatarUrl: null },
    description: 'A cosy office.',
    tags: ['cosy', 'small'],
    cols: 25,
    rows: 22,
    furniture: 59,
    areas: 4,
    pets: 2,
    carpets: 0,
    layoutRevision: 1,
    pixelAgentsVersion: '1.4.0',
    bytes: 10,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    files: { layout: '/api/v1/layouts/blue-office/download', preview: '', thumbnail: '' },
    layout: {},
    ...overrides,
  };
}

function meta(layoutRevision = 1) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    pixelAgents: { version: '1.4.0', commit: null, layoutRevision },
    count: 1,
  };
}

function stubFetch(layoutBody: unknown, metaBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return Response.json(url.includes('/meta') ? metaBody : layoutBody);
    }),
  );
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/layouts/blue-office']}>
      <Routes>
        <Route path="layouts/:slug" element={<LayoutDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LayoutDetailPage', () => {
  it('renders full metadata: facts, tags, sha256, dates, download link', async () => {
    stubFetch(detail(), meta());
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Blue Office' })).toBeInTheDocument();
    expect(screen.getByText('25×22')).toBeInTheDocument();
    expect(screen.getByText('cosy')).toBeInTheDocument();
    expect(screen.getByText('small')).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();

    const download = screen.getByRole('link', { name: 'Download layout.json' });
    expect(download).toHaveAttribute('href', 'http://localhost:3000/api/v1/layouts/blue-office/download');
    expect(download).toHaveAttribute('download', 'blue-office.json');
  });

  it('shows no revision warning when the layout matches the current pin', async () => {
    stubFetch(detail({ layoutRevision: 3 }), meta(3));
    renderDetail();
    await screen.findByRole('heading', { name: 'Blue Office' });
    expect(screen.queryByText(/may not import cleanly/)).not.toBeInTheDocument();
  });

  it("warns when the layout's revision is ahead of the site's current pin", async () => {
    stubFetch(detail({ layoutRevision: 5 }), meta(3));
    renderDetail();
    expect(await screen.findByText('This layout may not import cleanly.')).toBeInTheDocument();
    expect(screen.getByText(/revision 5/)).toBeInTheDocument();
    expect(screen.getByText(/revision 3/)).toBeInTheDocument();
  });

  it('shows a message, not a blank page, when the layout itself is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderDetail();
    expect(await screen.findByText(/Could not reach the API/)).toBeInTheDocument();
  });
});
