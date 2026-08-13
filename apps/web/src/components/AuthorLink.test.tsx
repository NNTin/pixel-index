import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { PublicAuthor } from '../api/types';
import { AuthorLink } from './AuthorLink';

describe('AuthorLink', () => {
  it('links to the author page by Discord id (#61)', () => {
    const author: PublicAuthor = {
      discordId: '123456789',
      username: 'someone',
      displayName: 'Someone',
      avatarUrl: null,
    };
    render(<AuthorLink author={author} />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: 'Someone' })).toHaveAttribute(
      'href',
      '/authors/123456789',
    );
  });

  it('renders plain unlinked text for a system/legacy-unlinked author (discordId null)', () => {
    const author: PublicAuthor = {
      discordId: null,
      username: 'legacy-credit',
      displayName: 'legacy-credit',
      avatarUrl: null,
    };
    render(<AuthorLink author={author} />, { wrapper: MemoryRouter });
    expect(screen.getByText('legacy-credit')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
