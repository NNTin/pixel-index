import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayoutJsonPanel } from './LayoutJsonPanel';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('LayoutJsonPanel', () => {
  it('auto-formats compact JSON and copies the formatted result', async () => {
    const writeText = vi.fn(async () => {});
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
