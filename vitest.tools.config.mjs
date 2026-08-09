import { defineConfig } from 'vitest/config';

// Covers tools/ — the repo-wide scripts, which belong to no workspace.
//
// Named `vitest.tools.config.mjs` and passed with --config on purpose. A plain
// `vitest.config.mjs` here would be *inherited*: vitest searches upward from
// the directory it runs in, and layout-core and api carry no config of their
// own, so their `vitest run` would pick this file up and collect nothing.
export default defineConfig({
  test: {
    include: ['tools/**/*.test.mjs'],
  },
});
