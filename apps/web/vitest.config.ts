import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  // vite.config.ts inlines this from VERCEL_ENV as a literal. Here it resolves
  // to a global instead, so a test can flip it — the guard is only worth having
  // if both sides of it are exercised.
  define: {
    __VENDOR_PREVIEW__: 'globalThis.__VENDOR_PREVIEW__',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
