/// <reference types="vite/client" />

/**
 * True only on a Vercel *preview* deployment — see `vite.config.ts`, which
 * inlines it from the `VERCEL_ENV` system variable at build time.
 *
 * Gates the candidate Pixel Agents renders (#26) so production, GitHub Pages
 * and local dev can never show them, whatever files happen to be present.
 */
declare const __VENDOR_PREVIEW__: boolean;
/** Pinned Pixel Agents commit, used to address immutable live-office assets. */
declare const __PIXEL_AGENTS_COMMIT__: string;

// Upstream declares this in testHooks.ts, which the full Pixel Agents App
// imports. The focused live-office wrapper intentionally does not import that
// test harness, but two shared modules still reference the optional log.
interface Window {
  __pixelAgentsTestHooks?: {
    playedSounds?: Array<{ kind: string; at: number }>;
    messageLog?: Array<{
      at: number;
      type: string;
      id?: number;
      toolName?: string;
      status?: string;
      toolId?: string;
      parentToolId?: string;
    }>;
  };
}
