// T2 profile 'agents' of microns-ops: real workerd through `wrangler dev` with generated site, ops and mail configs
// (site primary), the local upstream stub with the provider stubs and the mini-PostgREST, and the Local Explorer
// for mail injection, crons and Workflow events. Run with T2_PROFILE=agents (npm run test:integration:agents); the
// harness (globalSetup) belongs to workers/site/test/integration. Collects exactly test/t2/*.t2.ts.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/t2/*.t2.ts'],
    environment: 'node',
    globalSetup: [fileURLToPath(new URL('../site/test/integration/global-setup.mjs', import.meta.url))],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 240_000,
  },
});
