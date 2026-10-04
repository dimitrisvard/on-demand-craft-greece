// Unit tests (T1) of the shared Worker code run in Node (vitest), with Workers globals stubbed per test.
// Both Workers import these modules by relative path, so every test here also covers their use there.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
