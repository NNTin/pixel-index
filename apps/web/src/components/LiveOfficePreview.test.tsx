import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LayoutDetail } from '../api/types';
import { LIVE_OFFICE_CHANNEL } from '../live-office/protocol';
import { LiveOfficePreview } from './LiveOfficePreview';

function layout(): LayoutDetail {
  return {
    slug: 'test-office',
    title: 'Test Office',
    author: { id: null, username: 'tester', avatarUrl: null },
    description: '',
    tags: [],
    cols: 2,
    rows: 2,
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
    layout: { version: 1, layoutRevision: 1, cols: 2, rows: 2, tiles: [0, 0, 0, 0], furniture: [] },
  };
}

function renderPreview() {
  return render(
    <LiveOfficePreview
      layout={layout()}
      staticPreview={{ src: 'https://example.test/thumbnail.png' }}
    />,
  );
}

afterEach(() => localStorage.clear());

describe('LiveOfficePreview', () => {
  it('defaults to the live viewer and persists a thumbnail selection', () => {
    const view = renderPreview();

    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Test Office live Pixel Agents office')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Thumbnail' }));
    expect(localStorage.getItem('pixelindex_layout_render_mode')).toBe('thumbnail');
    expect(screen.getByAltText('Test Office office layout thumbnail')).toHaveAttribute(
      'src',
      'https://example.test/thumbnail.png',
    );

    view.unmount();
    renderPreview();
    expect(screen.getByRole('button', { name: 'Thumbnail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('ignores an invalid stored mode', () => {
    localStorage.setItem('pixelindex_layout_render_mode', 'surprise');
    renderPreview();
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds and removes mock agents within the controls', () => {
    renderPreview();
    expect(screen.getByText('3 mock agents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add mock agent' }));
    expect(screen.getByText('4 mock agents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove mock agent' }));
    expect(screen.getByText('3 mock agents')).toBeInTheDocument();
  });

  it('sends the layout after readiness and accepts agent removal from the viewer', async () => {
    renderPreview();
    const iframe = screen.getByTitle(
      'Test Office live Pixel Agents office',
    ) as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});

    fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: window.location.origin,
        data: { channel: LIVE_OFFICE_CHANNEL, type: 'ready' },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: LIVE_OFFICE_CHANNEL,
          type: 'render',
          agents: expect.arrayContaining([expect.objectContaining({ id: 1 })]),
        }),
        window.location.origin,
      ),
    );

    fireEvent(
      window,
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin: window.location.origin,
        data: { channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: 1 },
      }),
    );

    expect(screen.getByText('2 mock agents')).toBeInTheDocument();
    await waitFor(() =>
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agents: [expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 3 })],
        }),
        window.location.origin,
      ),
    );
  });
});
