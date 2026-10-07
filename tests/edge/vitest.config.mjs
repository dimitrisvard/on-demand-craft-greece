// Vitest config for the Supabase edge-function tests (run with workers/site's vitest:
//   workers/site/node_modules/.bin/vitest run -c tests/edge/vitest.config.mjs).
// No imports: the root node_modules has no vitest, so 'vitest/config' cannot be resolved from here; test files use
// the globals (describe, it, expect, vi). Node 22 provides fetch, Web Crypto and AbortController, which is all
// supabase/functions/telegram-leads-bot/agent-callback.ts uses.
//
// The function's index.ts imports Deno's std `serve` and supabase-js by URL. The plugin below rewrites those two
// specifiers in files under supabase/functions/ (Vite leaves https: imports to Node, which cannot load them) and
// serves in-memory modules for them, so the test can load index.ts under Node and call its request handler:
//   serve(handler)   stores the handler on globalThis.__edgeServeHandler
//   createClient()   returns globalThis.__edgeSupabase (a test double) or a chain that answers { data: [] }
// Nothing here reaches a network: the tests replace fetch with a recorder.

const DENO_SERVE = 'https://deno.land/std@0.190.0/http/server.ts';
const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.39.0';
const SERVE_ID = 'virtual:edge-stub-serve';
const SUPABASE_ID = 'virtual:edge-stub-supabase';

const SERVE_STUB = `export function serve(handler) { globalThis.__edgeServeHandler = handler; }`;
const SUPABASE_STUB = `
function chain() {
  const result = { data: [], error: null };
  const target = {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return (ok, err) => Promise.resolve(result).then(ok, err);
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}
export function createClient() {
  return globalThis.__edgeSupabase ?? { from: () => chain() };
}
`;

export default {
  root: new URL('../..', import.meta.url).pathname,
  plugins: [
    {
      name: 'edge-function-url-imports',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('/supabase/functions/')) return null;
        return code.split(JSON.stringify(DENO_SERVE)).join(JSON.stringify(SERVE_ID)).split(JSON.stringify(SUPABASE_JS)).join(JSON.stringify(SUPABASE_ID));
      },
      resolveId(id) {
        if (id === SERVE_ID || id === SUPABASE_ID) return `\0${id}`;
        return null;
      },
      load(id) {
        if (id === `\0${SERVE_ID}`) return SERVE_STUB;
        if (id === `\0${SUPABASE_ID}`) return SUPABASE_STUB;
        return null;
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/edge/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
};
