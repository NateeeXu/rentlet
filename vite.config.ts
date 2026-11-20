import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page site: every page is its own HTML file, moved over from the approved designs.
const pages = ['index', 'room', 'post', 'request', 'requests', 'messages', 'profile', 'how-it-works', 'terms', 'privacy', 'shuttle', 'saved', 'verification', 'review'];

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])),
    },
  },
  // Unit tests only: the Playwright specs in tests/ run under `npm run test:e2e`, and Vitest's
  // default include would otherwise pick up their *.spec.ts files and fail them.
  test: {
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
  },
});
