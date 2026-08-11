import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LayoutDetail } from '../api/types';
import { LIVE_OFFICE_CHANNEL } from '../live-office/protocol';
import { LiveOfficePreview } from './LiveOfficePreview';

function layout(overrides: Partial<LayoutDetail> = {}): LayoutDetail {
  return {
    slug: 'test-office',
    title: 'Test Office',
    author: { id: null, username: 'tester', displayName: 'tester', avatarUrl: null },
    description: '',
    tags: [],
    cols: 2,
    rows: 2,
    furniture: 0,
    areas: 0,
    pets: 0,
    carpets: 0,
    seats: 5,
    layoutRevision: 1,
    pixelAgentsVersion: '1.4.0',
    bytes: 10,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: { layout: '', preview: '', thumbnail: '' },
    layout: { version: 1, layoutRevision: 1, cols: 2, rows: 2, tiles: [0, 0, 0, 0], furniture: [] },
    ...overrides,
  };
}

function renderPreview(overrides: Partial<LayoutDetail> = {}) {
  return render(
    <LiveOfficePreview
      layout={layout(overrides)}
      staticPreview={{ src: 'https://example.test/thumbnail.png' }}
    />,
  );
}

/**
 * Agent matchers by id. Two of them, because the distinction matters: `contains`
 * tolerates other agents alongside these, `exactly` does not.
 *
 * They return `unknown` because `expect.arrayContaining` and
 * `expect.objectContaining` are both typed `any`, and used inline that `any`
 * spreads through the whole expected message.
 */
const agents = {
  contains: (...ids: number[]): unknown => {
    const matcher: unknown = expect.arrayContaining(agents.exactly(...ids));
    return matcher;
  },
  exactly: (...ids: number[]): unknown[] =>
    ids.map((id): unknown => {
      const matcher: unknown = expect.objectContaining({ id });
      return matcher;
    }),
};

/**
 * The window inside the live office's iframe — both the postMessage target and
 * the `source` the component checks incoming messages against. Narrowed by
 * `instanceof` and an explicit throw rather than asserted with `as`/`!`: if the
 * component ever stops rendering an iframe under that title, this fails with a
 * sentence saying so instead of a TypeError several lines later.
 */
function liveOfficeWindow(): Window {
  const iframe = screen.getByTitle('Test Office live Pixel Agents office');
  if (!(iframe instanceof HTMLIFrameElement)) {
    throw new Error('the live office preview did not render an iframe');
  }
  const frameWindow = iframe.contentWindow;
  if (!frameWindow) throw new Error('the live office iframe has no contentWindow');
  return frameWindow;
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
    expect(screen.getByRole('slider', { name: 'Mock agent count' })).toHaveValue('3');

    fireEvent.click(screen.getByRole('button', { name: 'Add mock agent' }));
    expect(screen.getByText('4 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Mock agent count' })).toHaveValue('4');

    fireEvent.click(screen.getByRole('button', { name: 'Remove mock agent' }));
    expect(screen.getByText('3 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Mock agent count' })).toHaveValue('3');
  });

  it('caps the + button and the slider at the layout\'s seat count', () => {
    renderPreview({ seats: 5 });
    const slider = screen.getByRole('slider', { name: 'Mock agent count' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '5');

    fireEvent.click(screen.getByRole('button', { name: 'Add mock agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add mock agent' }));
    expect(screen.getByText('5 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add mock agent' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add mock agent' }));
    expect(screen.getByText('5 mock agents')).toBeInTheDocument();
  });

  it('keeps the slider and the +/- buttons driving the same agent count', () => {
    renderPreview({ seats: 5 });
    const slider = screen.getByRole('slider', { name: 'Mock agent count' });

    fireEvent.change(slider, { target: { value: '5' } });
    expect(screen.getByText('5 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add mock agent' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove mock agent' }));
    expect(screen.getByText('4 mock agents')).toBeInTheDocument();
    expect(slider).toHaveValue('4');

    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText('0 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove mock agent' })).toBeDisabled();
  });

  it('disables both controls and explains itself when a layout has no seats', () => {
    renderPreview({ seats: 0 });
    expect(screen.getByText('0 mock agents')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Mock agent count' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add mock agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove mock agent' })).toBeDisabled();
    expect(screen.getByText('This layout has no seats for mock agents.')).toBeInTheDocument();
  });

  it('sends the layout after readiness and accepts agent removal from the viewer', async () => {
    renderPreview();
    const frameWindow = liveOfficeWindow();
    const postMessage = vi.spyOn(frameWindow, 'postMessage').mockReturnValue(undefined);

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frameWindow,
        origin: window.location.origin,
        data: { channel: LIVE_OFFICE_CHANNEL, type: 'ready' },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: LIVE_OFFICE_CHANNEL,
          type: 'render',
          agents: agents.contains(1),
        }),
        window.location.origin,
      ),
    );

    fireEvent(
      window,
      new MessageEvent('message', {
        source: frameWindow,
        origin: window.location.origin,
        data: { channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: 1 },
      }),
    );

    expect(screen.getByText('2 mock agents')).toBeInTheDocument();
    await waitFor(() =>
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agents: agents.exactly(2, 3),
        }),
        window.location.origin,
      ),
    );
  });
});
