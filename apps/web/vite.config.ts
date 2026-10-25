import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * The demo's data and style are served straight out of `demos/hawaii`, so the
 * app, the CLI and the repo all read exactly the same files. That also keeps
 * the style's own relative source URL (`../data/units.geojson`) correct, since
 * `demos/hawaii/styles/baseline.json` is served at `/styles/baseline.json`.
 */
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../demos/hawaii', import.meta.url)),
  resolve: {
    alias: {
      // Build against core's sources: no stale dist, and edits show up on save.
      '@carto-a11y/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    },
    dedupe: ['maplibre-gl'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
