import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, listLayouts } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('listLayouts', () => {
  it('returns the parsed response on success', async () => {
    const body = { schemaVersion: 1, total: 0, layouts: [], nextCursor: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(listLayouts()).resolves.toEqual(body);
  });

  it('normalizes a non-2xx response into an ApiError carrying the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    await expect(listLayouts()).rejects.toMatchObject({ status: 500 });
  });

  it('normalizes a network failure into an ApiError, not a raw TypeError', async () => {
    // The shape every unreachable-API code path (#12's "degrades legibly"
    // criterion) actually renders from — fetch throws a bare TypeError on a
    // network failure, not something with a status or a friendly message.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(listLayouts()).rejects.toBeInstanceOf(ApiError);
  });
});
