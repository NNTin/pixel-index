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

  send(): void {
    // Nothing is listening. The preview renders a layout it was handed; it
    // never talks back to an extension host.
  }

  onMessage(): () => void {
    // The returned value is an unsubscribe function upstream will call on
    // teardown, so it has to be callable — and, since nothing was subscribed,
    // has to do nothing.
    return () => {
      // Nothing was subscribed.
    };
  }

  onStateChange(): () => void {
    // `state` is a readonly 'connected' above, so it never changes and no
    // listener would ever fire. Same unsubscribe contract as onMessage.
    return () => {
      // Nothing was subscribed.
    };
  }

  dispose(): void {
    // No socket, no timer, no listener: nothing to release.
  }
}

export const transport: MessageTransport = new PreviewTransport();
export type { MessageTransport } from '../../../../vendor/pixel-agents/webview-ui/src/transport/types.js';
