import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@carto-a11y/core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
