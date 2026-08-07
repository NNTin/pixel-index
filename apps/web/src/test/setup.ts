import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's own auto-cleanup detects test-framework globals
// (`typeof afterEach !== 'undefined'`), which vitest only provides when
// `test.globals: true` — this config deliberately leaves that off, so
// without this the DOM from one test leaks into the next within a file.
afterEach(cleanup);
