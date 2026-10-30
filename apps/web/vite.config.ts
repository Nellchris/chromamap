import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * The demos' data and styles are served straight out of `demos/`, so the app,
 * the CLI and the repo all read exactly the same files. Serving the whole
 * folder rather than one demo inside it is what lets a second demo exist, and
 * it keeps each style's own relative source URL correct: with
 * `demos/hawaii/styles/baseline.json` served at `/hawaii/styles/baseline.json`,
 * its `../data/units.geojson` still resolves to the file beside it.
 */
export default defineConfig({
  publicDir: fileURLToPath(new URL('../../demos', import.meta.url)),
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
