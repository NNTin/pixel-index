import { describe, expect, it } from 'vitest';

import { isRenderOfficeMessage, isViewerMessage, LIVE_OFFICE_CHANNEL } from './protocol';

describe('live office message protocol', () => {
  it('accepts only addressed render messages with a layout and agents', () => {
    expect(
      isRenderOfficeMessage({
        channel: LIVE_OFFICE_CHANNEL,
        type: 'render',
        layout: { version: 1 },
        agents: [],
      }),
    ).toBe(true);
    expect(isRenderOfficeMessage({ channel: 'another-frame', type: 'render', layout: {}, agents: [] })).toBe(false);
    expect(isRenderOfficeMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'render', agents: [] })).toBe(false);
  });

  it('validates ready, error, and remove-agent viewer messages', () => {
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'ready' })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'error', message: 'failed' })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: 4 })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: '4' })).toBe(false);
  });
});
