import type {
  MessageTransport,
  TransportState,
} from '../../../../vendor/pixel-agents/webview-ui/src/transport/types.js';

/**
 * The embedded office is a local demo, not a Pixel Agents standalone server.
 * Upstream's browser transport would otherwise retry `/ws` forever. Vite
 * aliases upstream OfficeCanvas imports to this deliberately inert transport.
 */
class PreviewTransport implements MessageTransport {
  readonly state: TransportState = 'connected';
  readonly ready = Promise.resolve();

  send(): void {}

  onMessage(): () => void {
    return () => {};
  }

  onStateChange(): () => void {
    return () => {};
  }

  dispose(): void {}
}

export const transport: MessageTransport = new PreviewTransport();
export type { MessageTransport } from '../../../../vendor/pixel-agents/webview-ui/src/transport/types.js';
