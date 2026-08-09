import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's own auto-cleanup detects test-framework globals
// (`typeof afterEach !== 'undefined'`), which vitest only provides when
// `test.globals: true` — this config deliberately leaves that off, so
// without this the DOM from one test leaks into the next within a file.
afterEach(cleanup);

// jsdom doesn't implement matchMedia — ThemeContext's system-preference
// fallback needs it to exist at all, even a stub that always says "no".
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// Default these suites to "this is a vendor preview deployment", which is the
// only context where the candidate-render override does anything. The test that
// cares about the other side flips it with vi.stubGlobal.
(globalThis as { __VENDOR_PREVIEW__?: boolean }).__VENDOR_PREVIEW__ = true;
