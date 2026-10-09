// Vitest config for the Supabase edge-function tests (run with workers/site's vitest:
//   workers/site/node_modules/.bin/vitest run -c tests/edge-functions/vitest.config.mjs).
// The functions are Deno code: their URL imports are mapped to the local stubs below, and `Deno.env` is stubbed per
// test, so the real index.ts runs in Node without network.
const stub = (name) => new URL(`./stubs/${name}`, import.meta.url).pathname;

export default {
  root: new URL('../..', import.meta.url).pathname,
  resolve: {
    alias: [
      { find: /^https:\/\/deno\.land\/std@0\.190\.0\/http\/server\.ts$/, replacement: stub('deno-serve.ts') },
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2\.39\.0$/, replacement: stub('supabase-js.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/edge-functions/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
};
