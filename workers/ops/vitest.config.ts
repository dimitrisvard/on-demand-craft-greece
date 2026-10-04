// Unit tests (T1) of microns-ops run in Node (vitest). Node cannot load the runtime module 'cloudflare:workers',
// so it resolves to a stub (test/helpers/cloudflare-workers.ts) that provides WorkerEntrypoint. Files outside
// workers/ops (api/*.js, lib/*, workers/shared) are imported by relative path.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./test/helpers/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
