import { defineConfig } from 'vite';

// Not wired into `pnpm build` yet: vite lands with the first UI milestone
// (`pnpm add -D vite --filter @carto-a11y/web`).
export default defineConfig({
  resolve: {
    // Keep a single copy of the engine when it is linked from the workspace.
    dedupe: ['@carto-a11y/core'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
