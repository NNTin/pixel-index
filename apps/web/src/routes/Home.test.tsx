import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestUrl } from '../test/fetchStub';
import { Home } from './Home';

afterEach(() => vi.unstubAllGlobals());

function renderHome(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Home />
    </MemoryRouter>,
  );
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'blue-office',
    title: 'Blue Office',
    author: { id: null, username: 'someone', displayName: 'someone', avatarUrl: null },
    description: 'A cosy office.',
    tags: [],
    cols: 25,
    rows: 22,
    furniture: 59,
    areas: 4,
    pets: 2,
    carpets: 0,
    seats: 3,
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

/** Every Home test hits both #6's list endpoint and FilterBar's /tags call — branch on URL, once, here. */
function stubHomeFetch(handleLayouts: (url: string) => Response, tags: { name: string; count: number }[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/tags')) return Response.json({ schemaVersion: 1, tags });
      return handleLayouts(url);
    }),
  );
}

describe('Home', () => {
  it('fetches the list once per filter change, not once per render', async () => {
    // The effect depends on a `useMemo`'d `filters`, which is only sound if
    // react-router's `searchParams` is stable across re-renders. It used to
    // depend on `searchParams.toString()` and suppress exhaustive-deps to say
    // so. If that memo ever stops holding, this is the shape of the failure:
    // a request per render, in a loop, rather than anything visible on screen.
    let calls = 0;
    stubHomeFetch((url) => {
      if (url.includes('/api/v1/layouts')) calls += 1;
      return Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null });
    });

    const view = renderHome();
    await screen.findByText('Blue Office');
    const afterFirstLoad = calls;

    // A re-render with the same URL must not re-fetch.
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Blue Office')).toBeInTheDocument());
    expect(calls).toBe(afterFirstLoad);
  });

  it('shows a loading state, then the layout list with its facts row', async () => {
    stubHomeFetch(() =>
      Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null }),
    );
    renderHome();
    expect(screen.getByText('Loading layouts…')).toBeInTheDocument();
    expect(await screen.findByText('Blue Office')).toBeInTheDocument();
    expect(screen.getByText('by someone')).toBeInTheDocument();
    // The facts row carried over from tools/build-site.mjs: dims, furniture, areas, pets, seats.
    expect(screen.getByText('25×22')).toBeInTheDocument();
    expect(screen.getByText('59 furniture')).toBeInTheDocument();
    expect(screen.getByText('4 areas')).toBeInTheDocument();
    expect(screen.getByText('2 pets')).toBeInTheDocument();
    expect(screen.getByText('3 seats')).toBeInTheDocument();
  });

  it('omits zero-valued facts (no "0 areas" clutter)', async () => {
    stubHomeFetch(() =>
      Response.json({
        schemaVersion: 1,
        total: 1,
        layouts: [summary({ areas: 0, pets: 0, seats: 0 })],
        nextCursor: null,
      }),
    );
    renderHome();
    await screen.findByText('Blue Office');
    // Loose /areas/ or /pets/ regexes now also match FilterBar's own "Has
    // pets" / "No pets" <option> labels — assert the specific chip text
    // that would render for a nonzero fact instead.
    expect(screen.queryByText(/\d areas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d pets/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d seats/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no layouts and no filters are active', async () => {
    stubHomeFetch(() => Response.json({ schemaVersion: 1, total: 0, layouts: [], nextCursor: null }));
    renderHome();
    expect(await screen.findByText('No layouts published yet.')).toBeInTheDocument();
  });

  it('shows a filter-aware empty state when filters exclude everything', async () => {
    stubHomeFetch(() => Response.json({ schemaVersion: 1, total: 0, layouts: [], nextCursor: null }));
    renderHome(['/?q=nonexistent&size=large']);
    expect(await screen.findByText(/No layouts match the current filters/)).toBeInTheDocument();
    // The same "active filters" summary also renders in the FilterBar
    // itself — both are legitimate, assert at least one exists.
    expect(screen.getAllByText(/text "nonexistent"/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/size: large/).length).toBeGreaterThan(0);
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
    stubHomeFetch((url) => {
      if (url.includes('cursor=page2')) {
        return Response.json({
          schemaVersion: 1,
          total: 2,
          layouts: [summary({ slug: 'second-office', title: 'Second Office' })],
          nextCursor: null,
        });
      }
      return Response.json({ schemaVersion: 1, total: 2, layouts: [summary()], nextCursor: 'page2' });
    });
    renderHome();

    await screen.findByText('Blue Office');
    const loadMore = screen.getByRole('button', { name: 'Load more' });
    loadMore.click();

    expect(await screen.findByText('Second Office')).toBeInTheDocument();
    expect(screen.getByText('Blue Office')).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(); // no more pages
  });

  it('re-fetches from scratch (not appends) when a filter changes', async () => {
    let lastUrl = '';
    stubHomeFetch((url) => {
      lastUrl = url;
      const wantsLarge = url.includes('minCols=31');
      return Response.json({
        schemaVersion: 1,
        total: 1,
        layouts: [summary(wantsLarge ? { slug: 'big-office', title: 'Big Office' } : {})],
        nextCursor: null,
      });
    });
    renderHome();
    await screen.findByText('Blue Office');

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'large' } });

    expect(await screen.findByText('Big Office')).toBeInTheDocument();
    expect(screen.queryByText('Blue Office')).not.toBeInTheDocument(); // replaced, not appended
    expect(lastUrl).toContain('minCols=31');
  });

  it('renders a placeholder, not a broken image, when a preview fails to load', async () => {
    stubHomeFetch(() =>
      Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null }),
    );
    renderHome();
    const img = await screen.findByAltText('Blue Office office layout');
    img.dispatchEvent(new Event('error'));
    expect(await screen.findByText('no preview')).toBeInTheDocument();
  });

  it('shows the tag picker only when tags actually exist, and toggling one re-fetches filtered', async () => {
    let lastUrl = '';
    stubHomeFetch(
      (url) => {
        lastUrl = url;
        return Response.json({ schemaVersion: 1, total: 1, layouts: [summary()], nextCursor: null });
      },
      [{ name: 'cosy', count: 3 }],
    );
    renderHome();
    await screen.findByText('Blue Office');

    const tagButton = await screen.findByRole('button', { name: 'cosy (3)' });
    fireEvent.click(tagButton);

    await waitFor(() => expect(lastUrl).toContain('tags=cosy'));
  });
});
