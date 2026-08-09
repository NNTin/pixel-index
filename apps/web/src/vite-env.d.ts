/// <reference types="vite/client" />

/**
 * True only on a Vercel *preview* deployment — see `vite.config.ts`, which
 * inlines it from the `VERCEL_ENV` system variable at build time.
 *
 * Gates the candidate Pixel Agents renders (#26) so production, GitHub Pages
 * and local dev can never show them, whatever files happen to be present.
 */
declare const __VENDOR_PREVIEW__: boolean;
