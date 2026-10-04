// T2 tests of microns-site: real workerd through `wrangler dev` with the site and ops configs and the local
// upstream stub (test/integration/harness.mjs, started once per run by the globalSetup). Files: test/**/*.t2.ts
// (never matched by the unit-test include of vitest.config.ts). One file at a time: they share one harness.
// Run: npm run test:integration [-- <file filter>]; with a running `npm run t2:up`, T2_REUSE=1 reuses it.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.t2.ts'],
    environment: 'node',
    globalSetup: [fileURLToPath(new URL('./test/integration/global-setup.mjs', import.meta.url))],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
