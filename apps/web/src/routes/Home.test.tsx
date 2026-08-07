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

describe('Home', () => {
  it('shows a loading state, then the layout list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          total: 1,
          layouts: [
            {
              slug: 'blue-office',
              title: 'Blue Office',
              author: { id: null, username: 'someone', avatarUrl: null },
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
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    renderHome();
    expect(screen.getByText('Loading layouts…')).toBeInTheDocument();
    expect(await screen.findByText('Blue Office')).toBeInTheDocument();
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
});
