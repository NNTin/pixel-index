import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // One Vite dev server and one browser, shared by the whole file.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
