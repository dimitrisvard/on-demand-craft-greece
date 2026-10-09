// T2 profile 'jobs' of microns-ops (Phase 5): real workerd through `wrangler dev` with generated site and ops configs,
// the local upstream stub with the provider stubs and the mini-PostgREST, and the Local Explorer for crons, queues and
// Workflows. Run with T2_PROFILE=jobs (npm run test:integration:jobs); the harness (globalSetup) belongs to
// workers/site/test/integration. Collects exactly test/t2-jobs/**/*.jobs.ts, a name that neither the Phase 2 T2
// config (test/**/*.t2.ts), the Phase 4 profile 'agents' (test/t2/*.t2.ts) nor the T1 config (test/**/*.test.ts)
// collects.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/t2-jobs/**/*.jobs.ts'],
    environment: 'node',
    globalSetup: [fileURLToPath(new URL('../site/test/integration/global-setup.mjs', import.meta.url))],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
