import { defineConfig } from 'vitest/config';

/**
 * Integration tests boot Vite and Chromium, so they are opt-in: `npm test` stays
 * fast enough to run on every change, and `npm run test:integration` is what
 * proves the renderer still draws what v1 drew.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
