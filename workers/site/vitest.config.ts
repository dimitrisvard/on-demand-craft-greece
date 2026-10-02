// Unit tests of microns-site run in Node (vitest), with Workers globals (caches, env bindings, fetch) stubbed per
// test. Files outside workers/site (api/*.js, middleware/*) are imported by relative path.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
