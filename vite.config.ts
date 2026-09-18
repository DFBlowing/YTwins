import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The web pages' build.
 *
 * Two pages, and the pair is the product's shape rather than a build detail
 * (ticket 15): `index.html` is the product itself — one box, with 投递 / 追溯 /
 * 浮现 fused behind it — and `demo.html` is the three-act page, kept as the
 * demo's and the regression suite's reference and deliberately not touched.
 * Output goes to `dist/web`, which is what the local server serves; `/` is the
 * product because the server falls back to `index.html`, and the three acts are
 * at `/demo.html`. The Vite dev server is a convenience for editing the pages;
 * the product itself runs through `node src/web/server.ts`.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      // Named entries rather than the default single `index.html`, because there
      // are two pages now: without this, `demo.html` and its script would be left
      // out of the build and the demo would 404 on a real server.
      input: {
        index: resolve(import.meta.dirname, 'src/web/index.html'),
        demo: resolve(import.meta.dirname, 'src/web/demo.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5273',
    },
  },
});
