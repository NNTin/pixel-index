import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

// Not a test of the GitHub Pages 404.html trick itself (that's a build-time
// file plus browser-only sessionStorage behavior, not unit-testable) — this
// proves the router config it depends on actually resolves a deep route,
// the way index.html's restore script hands the real path back to it.
describe('App routing', () => {
  it('resolves a deep link directly, without visiting / first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
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
          layout: {},
        }),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/layouts/blue-office']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Blue Office' })).toBeInTheDocument();
  });

  it('renders NotFound for an unmatched route', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});
