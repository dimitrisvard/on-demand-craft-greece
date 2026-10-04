// Vitest config for the frontend API helper tests (run with workers/site's vitest:
//   workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs).
// No imports: the root node_modules has no vitest, so 'vitest/config' cannot be
// resolved from here. Test files use the globals (describe, it, expect, vi).
const src = new URL('../../src', import.meta.url).pathname;
const supabaseMock = new URL('./mocks/supabase-client.ts', import.meta.url).pathname;

export default {
  root: new URL('../..', import.meta.url).pathname,
  resolve: {
    alias: [
      // The real client throws without build env vars; every test uses this mock.
      { find: /^@\/integrations\/supabase\/client$/, replacement: supabaseMock },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/frontend-api/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
};
