import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page site: every page is its own HTML file, moved over from the approved designs.
const pages = ['index', 'room', 'post', 'request', 'requests', 'messages', 'profile', 'how-it-works'];

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])),
    },
  },
});
