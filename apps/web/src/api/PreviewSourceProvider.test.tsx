import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidatePinBanner } from '../components/CandidatePinBanner';
import { LayoutCard } from '../components/LayoutCard';
import { requestUrl } from '../test/fetchStub';
import { type PreviewManifest, resetPreviewManifestCache } from './previewSource';
import { PreviewSourceProvider } from './PreviewSourceProvider';
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
  upstreamUrl: 'https://github.com/pixel-agents-hq/pixel-agents',
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
    author: { discordId: null, username: 'someone', displayName: 'someone', avatarUrl: null },
    description: '',
    tags: [],
    cols: 21,
    rows: 22,
    visibleCols: 21,
    visibleRows: 22,
    furniture: 1,
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
    files: {
      layout: `/api/v1/layouts/${slug}/download`,
      preview: `/api/v1/layouts/${slug}/preview.png`,
      thumbnail: `/api/v1/layouts/${slug}/thumbnail.png`,
    },
  });

/** The two requests the provider makes: the manifest probe, then /meta. */
function stubFetch(options: { manifest: PreviewManifest | null; apiCommit: string | null }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
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

/**
 * The manifest fetch is memoised at module scope for the lifetime of the page,
 * so it is the one request the provider must never abort — see the note in
 * PreviewSourceProvider.tsx. This pins that: aborting it would leave every
 * later mount awaiting the same rejected promise, and the override would
 * silently never arm again.
 */
function stubCountingFetch(manifestBody: PreviewManifest) {
  let manifestRequests = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes('vendor-preview/manifest.json')) {
      manifestRequests += 1;
      // Honours the signal, unlike the other stubs in this file. That is the
      // whole point: a stub that ignores init.signal cannot tell an aborted
      // request from a completed one, so it would pass whether or not the
      // provider made the mistake this test exists to catch.
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
        setTimeout(() => resolve(Response.json(manifestBody)), 0);
      });
    }
    if (url.includes('/api/v1/meta')) {
      return Response.json({
        schemaVersion: 1,
        generatedAt: '2026-08-09T00:00:00.000Z',
        // BASELINE, not CANDIDATE: the API still lags the candidate pin, which
        // is the state in which the override is meant to be active.
        pixelAgents: { version: '1.4.0', commit: BASELINE, layoutRevision: 1 },
        count: 1,
      });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return { manifestRequests: () => manifestRequests };
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
        '/vendor-preview/blue-office.png',
      );
    });

    // The swap is only honest if the page admits to it.
    expect(screen.getByRole('status')).toHaveTextContent(/candidate Pixel Agents bbbbbbb/);
    expect(screen.getByRole('status')).toHaveTextContent(/API is still on aaaaaaa/);
  });

  it('links each short sha to the upstream commit it names', async () => {
    // A seven-character hash on its own is unactionable — the question it
    // always provokes is "what actually changed upstream?".
    stubFetch({ manifest, apiCommit: BASELINE });
    renderWithProvider(['blue-office']);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'bbbbbbb' })).toHaveAttribute(
      'href',
      `https://github.com/pixel-agents-hq/pixel-agents/commit/${CANDIDATE}`,
    );
    expect(screen.getByRole('link', { name: 'aaaaaaa' })).toHaveAttribute(
      'href',
      `https://github.com/pixel-agents-hq/pixel-agents/commit/${BASELINE}`,
    );
  });

  it('falls back to plain text when the upstream repository is unknown', async () => {
    // Better an unlinked hash than a link to nowhere.
    stubFetch({ manifest: { ...manifest, upstreamUrl: null }, apiCommit: BASELINE });
    renderWithProvider(['blue-office']);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/bbbbbbb/);
    expect(screen.queryByRole('link', { name: 'bbbbbbb' })).not.toBeInTheDocument();
  });

  it('says plainly when nothing changed, rather than implying a swap that did not happen', async () => {
    // The normal case: nothing published, every card is the API's image. Left
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

describe('PreviewSourceProvider — the memoised manifest is deliberately not aborted', () => {
  it('still arms on a later mount after an earlier one unmounted mid-flight', async () => {
    const counted = stubCountingFetch(manifest);

    // Unmount while the manifest request is still resolving. If the provider
    // had threaded its signal into fetchPreviewManifest(), this would poison
    // the module-level cache and the second mount below would never arm.
    const first = renderWithProvider(['blue-office']);
    first.unmount();

    renderWithProvider(['blue-office']);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /blue-office/ })).toHaveAttribute(
        'src',
        '/vendor-preview/blue-office.png',
      ),
    );

    // Memoised: fetched once for the page, not once per mount.
    expect(counted.manifestRequests()).toBe(1);
  });
});
