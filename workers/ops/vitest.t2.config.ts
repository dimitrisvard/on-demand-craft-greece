// T2 tests of microns-ops: real workerd through `wrangler dev` with the site and ops configs and the local
// upstream stub. The harness (globalSetup) belongs to workers/site/test/integration; it generates both configs,
// starts the stub and publishes T2_SITE_URL / T2_STUB_URL. Every request enters through the site Worker, which
// reaches microns-ops over the OPS service binding, as in production.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.t2.ts'],
    environment: 'node',
    globalSetup: [fileURLToPath(new URL('../site/test/integration/global-setup.mjs', import.meta.url))],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
