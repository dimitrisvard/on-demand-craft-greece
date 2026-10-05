// vitest config of the offline evaluation (npm run eval:synthetic, owner: npm run eval:live). Same module set-up as
// the T1 tests (runtime-module aliases, the wrangler-rules plugin, the Agents SDK inlined); collects eval/*.eval.ts
// only, so neither the T1 run nor the T2 runs pick the evaluation up.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base, { wranglerRules } from '../vitest.config.ts';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [wranglerRules()],
  resolve: base.resolve,
  test: {
    include: ['eval/*.eval.ts'],
    environment: 'node',
    server: base.test?.server,
    testTimeout: 600_000,
    // The metrics are the output of this run: always printed.
    silent: false,
  },
});
