import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPreviewSource,
  fetchPreviewManifest,
  type PreviewManifest,
  resetPreviewManifestCache,
  shouldOverride,
} from './previewSource';

afterEach(() => {
  vi.unstubAllGlobals();
  resetPreviewManifestCache();
});

const manifest = (overrides: Partial<PreviewManifest> = {}): PreviewManifest => ({
  generatedAt: '2026-08-09T00:00:00.000Z',
  candidate: { commit: 'b'.repeat(40), version: '1.5.0' },
  baseline: { commit: 'a'.repeat(40), version: '1.4.0' },
  upstreamUrl: 'https://github.com/pixel-agents-hq/pixel-agents',
  changed: 1,
  failed: 0,
  shown: 1,
  cap: 50,
  layouts: { 'blue-office': { file: 'blue-office.png' } },
  ...overrides,
});

describe('shouldOverride', () => {
  it('overrides while the API is still on the old pin', () => {
    expect(shouldOverride(manifest(), { commit: 'a'.repeat(40), version: '1.4.0' })).toBe(true);
  });

  it('disarms itself once the API is on the candidate pin', () => {
    // The manifest is merged along with the pin, so it WILL exist in
    // production. This is what stops it from serving stale renders forever
    // instead of needing a cleanup commit nobody would remember to make.
    expect(shouldOverride(manifest(), { commit: 'b'.repeat(40), version: '1.5.0' })).toBe(false);
  });

  it('falls back to the version when the API reports no commit', () => {
    // An API built before the pin shipped as a file in the image reports
    // commit: null — a real state to handle, not a hypothetical.
    expect(shouldOverride(manifest(), { commit: null, version: '1.4.0' })).toBe(true);
    expect(shouldOverride(manifest(), { commit: null, version: '1.5.0' })).toBe(false);
  });

  it('stays off when the API reports nothing comparable', () => {
    // Fail safe: a live image that might be slightly stale beats a static one
    // that is certainly stale.
    expect(shouldOverride(manifest(), { commit: null, version: null })).toBe(false);
    expect(shouldOverride(manifest(), null)).toBe(false);
  });

  it('prefers the commit over the version, so a bump within one version still overrides', () => {
    // The pin is routinely several commits past a tag (v1.4.0-14-g9794e07),
    // so two different pins can share a version.
    const sameVersion = manifest({ candidate: { commit: 'b'.repeat(40), version: '1.4.0' } });
    expect(shouldOverride(sameVersion, { commit: 'a'.repeat(40), version: '1.4.0' })).toBe(true);
  });
});

describe('buildPreviewSource', () => {
  const apiPin = { commit: 'a'.repeat(40), version: '1.4.0' };

  it('points a known layout at the candidate render', () => {
    const source = buildPreviewSource(manifest(), apiPin);
    expect(source.active).toBe(true);
    expect(source.resolve('blue-office')).toEqual({
      kind: 'candidate',
      src: '/vendor-preview/blue-office.png',
    });
  });

  it('marks a layout the candidate cannot draw instead of falling back to the API', () => {
    // Falling back would show the OLD pin's picture for a layout the new pin
    // cannot render — the exact lie this mechanism exists to stop.
    const source = buildPreviewSource(
      manifest({ layouts: { 'blue-office': { failed: 'invalid' } } }),
      apiPin,
    );
    expect(source.resolve('blue-office')).toEqual({ kind: 'failed', reason: 'invalid' });
  });

  it('leaves a layout the gate never saw on the API', () => {
    // Submitted after the gate ran: unmeasured, not broken.
    const source = buildPreviewSource(manifest(), apiPin);
    expect(source.resolve('submitted-yesterday')).toEqual({ kind: 'api' });
  });

  it('is entirely inert when it should not override', () => {
    const source = buildPreviewSource(manifest(), { commit: 'b'.repeat(40), version: '1.5.0' });
    expect(source.active).toBe(false);
    expect(source.resolve('blue-office')).toEqual({ kind: 'api' });
  });
});

describe('fetchPreviewManifest', () => {
  it('never even looks outside a preview deployment', async () => {
    // The guard that makes production unreachable by this mechanism. A
    // production build cannot contain the manifest at all — only a preview
    // build fetches it into dist/ — but a manifest that found its way back
    // into public/ is exactly the regression this replaces, so the runtime
    // refuses independently rather than trusting the build.
    vi.stubGlobal('__VENDOR_PREVIEW__', false);
    const fetchMock = vi.fn(async () => Response.json(manifest()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPreviewManifest()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on a 404 — the case on every deployment but a vendor preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(fetchPreviewManifest()).resolves.toBeNull();
  });

  it('returns null when the request throws, rather than breaking the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchPreviewManifest()).resolves.toBeNull();
  });

  it('fetches once per page load however many components ask', async () => {
    // A gallery renders 24 cards; 24 requests for one unchanging file would be
    // a self-inflicted wound.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(manifest()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([fetchPreviewManifest(), fetchPreviewManifest(), fetchPreviewManifest()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
