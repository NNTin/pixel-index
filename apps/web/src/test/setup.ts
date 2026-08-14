import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's own auto-cleanup detects test-framework globals
// (`typeof afterEach !== 'undefined'`), which vitest only provides when
// `test.globals: true` — this config deliberately leaves that off, so
// without this the DOM from one test leaks into the next within a file.
afterEach(cleanup);

// Default these suites to "this is a vendor preview deployment", which is the
// only context where the candidate-render override does anything. The test that
// cares about the other side flips it with vi.stubGlobal.
(globalThis as { __VENDOR_PREVIEW__?: boolean }).__VENDOR_PREVIEW__ = true;

// jsdom (25) ships Blob without the `text()` every browser has had for years,
// so a component reading an uploaded file the ordinary way is untestable
// without this. Defined rather than assigned, and only when missing, so a
// future jsdom that implements it properly wins.
if (typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    configurable: true,
    writable: true,
    value(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('could not read the blob'));
        // `readAsText` always produces a string; the union is FileReader's,
        // shared with `readAsArrayBuffer`, not something this can encounter.
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.readAsText(this);
      });
    },
  });
}
