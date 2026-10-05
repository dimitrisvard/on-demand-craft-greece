// Unit tests (T1) of microns-mail run in Node (vitest), with the Email Worker bindings faked per test.
// workers/shared is imported by relative path.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
