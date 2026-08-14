import { describe, expect, it } from 'vitest';

import {
  isEditOfficeMessage,
  isRenderOfficeMessage,
  isViewerMessage,
  LIVE_OFFICE_CHANNEL,
} from './protocol';

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

  it('validates ready, error, remove-agent, and layout viewer messages', () => {
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'ready' })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'error', message: 'failed' })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: 4 })).toBe(true);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'remove-agent', id: '4' })).toBe(false);
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'layout', layout: '{}' })).toBe(true);
    // The layout travels as serialised bytes — an object here is the caller
    // having skipped the one step that decides what gets published (#65).
    expect(isViewerMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'layout', layout: {} })).toBe(false);
  });

  it('accepts an edit request, including the null that asks for a blank layout', () => {
    expect(
      isEditOfficeMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'edit', layout: { version: 1 } }),
    ).toBe(true);
    expect(
      isEditOfficeMessage({
        channel: LIVE_OFFICE_CHANNEL,
        type: 'edit',
        layout: null,
        layoutRevision: 4,
      }),
    ).toBe(true);
    // A missing `layout` is a different thing from a null one: the first is a
    // malformed message, the second is "start me a blank room".
    expect(isEditOfficeMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'edit' })).toBe(false);
    expect(
      isEditOfficeMessage({
        channel: LIVE_OFFICE_CHANNEL,
        type: 'edit',
        layout: null,
        layoutRevision: '4',
      }),
    ).toBe(false);
    expect(isEditOfficeMessage({ channel: 'another-frame', type: 'edit', layout: null })).toBe(false);
    // A render is not an edit, whatever else it carries.
    expect(
      isEditOfficeMessage({ channel: LIVE_OFFICE_CHANNEL, type: 'render', layout: {}, agents: [] }),
    ).toBe(false);
  });
});
