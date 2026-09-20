import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file builds its own database. PGlite is in-process, so running
    // files in parallel would multiply memory for no gain.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
