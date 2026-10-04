// vitest globalSetup of the T2 suites (workers/site/vitest.t2.config.ts and workers/ops/vitest.t2.config.ts):
// starts the harness (./harness.mjs) once per run and stops it afterwards. T2_SITE_URL, T2_STUB_URL and T2_TMP
// are set before the test workers start, so every T2 file reads them from process.env.
// With T2_REUSE=1 an already running harness (`npm run t2:up`) is used instead, through its urls.json.

import { startHarness, waitForUrls } from './harness.mjs';

export default async function setup() {
  if (process.env.T2_REUSE === '1') {
    const urls = await waitForUrls(5_000);
    if (!urls) throw new Error('T2_REUSE=1, but no running harness published workers/site/.wrangler/t2/urls.json');
    process.env.T2_SITE_URL = urls.site;
    process.env.T2_STUB_URL = urls.stub;
    process.env.T2_TMP = urls.tmp;
    return undefined;
  }
  const harness = await startHarness();
  return async () => {
    await harness.stop();
  };
}
