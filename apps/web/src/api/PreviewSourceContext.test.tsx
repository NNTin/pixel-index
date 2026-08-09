import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidatePinBanner } from '../components/CandidatePinBanner';
import { LayoutCard } from '../components/LayoutCard';
import { type PreviewManifest,resetPreviewManifestCache } from './previewSource';
import { PreviewSourceProvider } from './PreviewSourceContext';
import type { LayoutSummary } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
  resetPreviewManifestCache();
});

const CANDIDATE = 'b'.repeat(40);
const BASELINE = 'a'.repeat(40);

const manifest: PreviewManifest = {
  generatedAt: '2026-08-09T00:00:00.000Z',
  candidate: { commit: CANDIDATE, version: '1.5.0' },
  baseline: { commit: BASELINE, version: '1.4.0' },
  baseUrl: 'https://renders.example.com/bbb/',
  changed: 1,
  failed: 1,
  shown: 2,
  cap: 50,
  layouts: {
    'blue-office': { file: 'blue-office.png' },
    'four-rooms': { failed: 'invalid' },
  },
};

const summary = (slug: string): LayoutSummary =>
  ({
    slug,
    title: slug,
    author: { id: null, username: 'someone', avatarUrl: null },
    description: '',
    tags: [],
    cols: 21,
    rows: 22,
    furniture: 1,
    areas: 0,
    pets: 0,
    carpets: 0,
    layoutRevision: 1,
    pixelAgentsVersion: '1.4.0',
    bytes: 10,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: {
      layout: `/api/v1/layouts/${slug}/download`,
      preview: `/api/v1/layouts/${slug}/preview.png`,
      thumbnail: `/api/v1/layouts/${slug}/thumbnail.png`,
    },
  }) as LayoutSummary;

/** The two requests the provider makes: the manifest probe, then /meta. */
function stubFetch(options: { manifest: PreviewManifest | null; apiCommit: string | null }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('vendor-preview/manifest.json')) {
        return options.manifest === null
          ? new Response('', { status: 404 })
          : Response.json(options.manifest);
      }
      if (url.includes('/api/v1/meta')) {
        return Response.json({
          schemaVersion: 1,
          generatedAt: '2026-08-09T00:00:00.000Z',
          pixelAgents: { version: '1.4.0', commit: options.apiCommit, layoutRevision: 1 },
          count: 1,
        });
      }
      return new Response('', { status: 404 });
    }),
  );
}

function renderWithProvider(slugs: string[]) {
  return render(
    <MemoryRouter>
      <PreviewSourceProvider>
        <CandidatePinBanner />
        {slugs.map((slug) => (
          <LayoutCard key={slug} layout={summary(slug)} />
        ))}
      </PreviewSourceProvider>
    </MemoryRouter>,
  );
}

describe('candidate previews end to end', () => {
  it('swaps a thumbnail to the candidate render and says so', async () => {
    stubFetch({ manifest, apiCommit: BASELINE });
    renderWithProvider(['blue-office']);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /blue-office/ })).toHaveAttribute(
        'src',
        'https://renders.example.com/bbb/blue-office.png',
      );
    });

    // The swap is only honest if the page admits to it.
    expect(screen.getByRole('status')).toHaveTextContent(/candidate Pixel Agents bbbbbbb/);
    expect(screen.getByRole('status')).toHaveTextContent(/API is still on aaaaaaa/);
  });

  it('says plainly when nothing changed, rather than implying a swap that did not happen', async () => {
    // The normal week: nothing published, every card is the API's image. Left
    // unsaid, a reviewer seeing ordinary thumbnails cannot tell the mechanism
    // ran and found nothing from the mechanism being broken — which is a
    // confusion this project has already hit once for real.
    stubFetch({
      manifest: { ...manifest, changed: 0, failed: 0, shown: 0, layouts: {} },
      apiCommit: BASELINE,
    });
    renderWithProvider(['blue-office']);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/nothing changed visually/);
    expect(screen.getByRole('img', { name: /blue-office/ })).toHaveAttribute(
      'src',
      'http://localhost:3000/api/v1/layouts/blue-office/thumbnail.png',
    );
  });

  it('admits to being a sample when the cap truncated the set', async () => {
    // 800 changed, 50 shown. A sample that does not say so invites the reader
    // to conclude the other 750 were fine.
    stubFetch({
      manifest: { ...manifest, changed: 800, failed: 0, shown: 50, cap: 50 },
      apiCommit: BASELINE,
    });
    renderWithProvider(['blue-office']);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/800 layouts render differently/);
    expect(banner).toHaveTextContent(/sample of 50/);
    expect(banner).toHaveTextContent(/the rest keep the API's current images/);
  });

  it('mentions layouts the candidate cannot draw at all', async () => {
    stubFetch({ manifest, apiCommit: BASELINE });
    renderWithProvider(['four-rooms']);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/1 layout cannot be drawn/);
  });

  it('marks a layout the candidate cannot draw instead of showing its old image', async () => {
    stubFetch({ manifest, apiCommit: BASELINE });
    renderWithProvider(['four-rooms']);

    await waitFor(() => {
      expect(screen.getByText(/does not render under the candidate Pixel Agents/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('img', { name: /four-rooms/ })).not.toBeInTheDocument();
  });

  it('leaves everything alone when there is no manifest', async () => {
    // Production, Pages, and every PR that is not a vendor bump.
    stubFetch({ manifest: null, apiCommit: BASELINE });
    renderWithProvider(['blue-office']);

    expect(screen.getByRole('img', { name: /blue-office/ })).toHaveAttribute(
      'src',
      'http://localhost:3000/api/v1/layouts/blue-office/thumbnail.png',
    );
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('disarms once the API has caught up to the candidate pin', async () => {
    // The state after this PR merges and the API redeploys. The manifest is
    // still committed and still fetched — it just stops applying.
    stubFetch({ manifest, apiCommit: CANDIDATE });
    renderWithProvider(['blue-office']);

    await waitFor(() =>
      expect(screen.getByRole('img', { name: /blue-office/ })).toHaveAttribute(
        'src',
        'http://localhost:3000/api/v1/layouts/blue-office/thumbnail.png',
      ),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
