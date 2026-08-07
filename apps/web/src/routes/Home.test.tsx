import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Home } from './Home';

afterEach(() => vi.unstubAllGlobals());

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'blue-office',
    title: 'Blue Office',
    author: { id: null, username: 'someone', avatarUrl: null },
    description: 'A cosy office.',
    tags: [],
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: { layout: '', preview: '', thumbnail: '' },
    ...overrides,
  };
}

describe('Home', () => {
  it('shows a loading state, then the layout list with its facts row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null }),
      ),
    );
    renderHome();
    expect(screen.getByText('Loading layouts…')).toBeInTheDocument();
    expect(await screen.findByText('Blue Office')).toBeInTheDocument();
    expect(screen.getByText('by someone')).toBeInTheDocument();
    // The facts row carried over from tools/build-site.mjs: dims, furniture, areas, pets.
    expect(screen.getByText('25×22')).toBeInTheDocument();
    expect(screen.getByText('59 furniture')).toBeInTheDocument();
    expect(screen.getByText('4 areas')).toBeInTheDocument();
    expect(screen.getByText('2 pets')).toBeInTheDocument();
  });

  it('omits zero-valued facts (no "0 areas" clutter)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          total: 1,
          layouts: [summary({ areas: 0, pets: 0 })],
          nextCursor: null,
        }),
      ),
    );
    renderHome();
    await screen.findByText('Blue Office');
    expect(screen.queryByText(/areas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pets/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no layouts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ schemaVersion: 1, total: 0, layouts: [], nextCursor: null })),
    );
    renderHome();
    expect(await screen.findByText('No layouts published yet.')).toBeInTheDocument();
  });

  it('shows a message, not a blank page, when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderHome();
    expect(await screen.findByText(/Could not reach the API/)).toBeInTheDocument();
  });

  it('loads the next page via "Load more" and appends, without a duplicate request loop', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=page2')) {
        return Response.json({
          schemaVersion: 1,
          total: 2,
          layouts: [summary({ slug: 'second-office', title: 'Second Office' })],
          nextCursor: null,
        });
      }
      return Response.json({
        schemaVersion: 1,
        total: 2,
        layouts: [summary()],
        nextCursor: 'page2',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderHome();

    await screen.findByText('Blue Office');
    const loadMore = screen.getByRole('button', { name: 'Load more' });
    loadMore.click();

    expect(await screen.findByText('Second Office')).toBeInTheDocument();
    expect(screen.getByText('Blue Office')).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(); // no more pages
  });

  it('renders a placeholder, not a broken image, when a preview fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null }),
      ),
    );
    renderHome();
    const img = await screen.findByAltText('Blue Office office layout');
    img.dispatchEvent(new Event('error'));
    expect(await screen.findByText('no preview')).toBeInTheDocument();
  });
});
