export const LIVE_OFFICE_CHANNEL = 'pixel-index-live-office';

export interface MockAgent {
  id: number;
  activity: string;
  tool: string;
}

export interface RenderOfficeMessage {
  channel: typeof LIVE_OFFICE_CHANNEL;
  type: 'render';
  layout: unknown;
  agents: MockAgent[];
}

export type ViewerMessage =
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'ready' }
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'error'; message: string }
  | { channel: typeof LIVE_OFFICE_CHANNEL; type: 'remove-agent'; id: number };

export function isRenderOfficeMessage(value: unknown): value is RenderOfficeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RenderOfficeMessage>;
  return (
    message.channel === LIVE_OFFICE_CHANNEL &&
    message.type === 'render' &&
    Boolean(message.layout) &&
    Array.isArray(message.agents)
  );
}

export function isViewerMessage(value: unknown): value is ViewerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ViewerMessage>;
  if (message.channel !== LIVE_OFFICE_CHANNEL) return false;
  if (message.type === 'ready') return true;
  if (message.type === 'error') return typeof message.message === 'string';
  return message.type === 'remove-agent' && typeof message.id === 'number';
}
