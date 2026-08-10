import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayoutJsonPanel } from './LayoutJsonPanel';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('LayoutJsonPanel', () => {
  it('auto-formats compact JSON and copies the formatted result', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { container } = render(
      <LayoutJsonPanel
        state={{ status: 'ready', source: '{"version":1,"nested":{"value":true}}' }}
        slug="compact-office"
        downloadPath="/api/v1/layouts/compact-office/download"
      />,
    );

    const formatted = '{\n  "version": 1,\n  "nested": {\n    "value": true\n  }\n}\n';
    expect(container.querySelector('code')?.textContent).toBe(formatted);

    fireEvent.click(screen.getByRole('button', { name: 'Copy layout.json' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(formatted));
    expect(screen.getByRole('status')).toHaveTextContent('Copied formatted layout.json.');
  });

  it('falls back to a selection copy where there is no async clipboard', async () => {
    // The path taken on a plain-HTTP deploy, in older Safari, and in jsdom —
    // all of which lack navigator.clipboard entirely. It had no coverage at
    // all until platform/clipboard.ts made the absence expressible in the
    // types; the afterEach above already leaves the clipboard undefined.
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      render(
        <LayoutJsonPanel
          state={{ status: 'ready', source: '{"version":1}' }}
          slug="no-clipboard"
          downloadPath="/api/v1/layouts/no-clipboard/download"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy layout.json' }));
      await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
      expect(screen.getByRole('status')).toHaveTextContent('Copied formatted layout.json.');
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('reports a refused copy instead of failing silently', async () => {
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      render(
        <LayoutJsonPanel
          state={{ status: 'ready', source: '{"version":1}' }}
          slug="refused"
          downloadPath="/api/v1/layouts/refused/download"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy layout.json' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Could not copy/));
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('reports a failure where neither clipboard API exists at all', async () => {
    // jsdom's own baseline: no navigator.clipboard and no document.execCommand.
    // The button must say so rather than appear to have worked.
    render(
      <LayoutJsonPanel
        state={{ status: 'ready', source: '{"version":1}' }}
        slug="nothing-at-all"
        downloadPath="/api/v1/layouts/nothing-at-all/download"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy layout.json' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Could not copy/));
  });

  it('shows malformed JSON as an error and disables copy', () => {
    render(
      <LayoutJsonPanel
        state={{ status: 'ready', source: '{not json' }}
        slug="broken"
        downloadPath="/api/v1/layouts/broken/download"
      />,
    );

    expect(screen.getByText('This layout.json could not be formatted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy layout.json' })).toBeDisabled();
  });

  it('keeps the download available while the source is unavailable', () => {
    render(
      <LayoutJsonPanel
        state={{ status: 'error', message: 'Could not reach the API.' }}
        slug="offline"
        downloadPath="/api/v1/layouts/offline/download"
      />,
    );

    expect(screen.getByText('Could not reach the API.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download layout.json' })).toHaveAttribute(
      'download',
      'offline.json',
    );
  });
});
