import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@carto-a11y/cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
