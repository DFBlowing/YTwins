import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The web page's build.
 *
 * Output goes to `dist/web`, which is what the local server serves. The Vite
 * dev server is a convenience for editing the page; the product itself runs
 * through `node src/web/server.ts`.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5273',
    },
  },
});
