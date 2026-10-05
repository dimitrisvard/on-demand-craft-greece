// vitest globalSetup of the T2 suites (workers/site/vitest.t2.config.ts, workers/ops/vitest.t2.config.ts and, with
// T2_PROFILE=agents, workers/ops/vitest.t2.agents.config.ts): starts the harness (./harness.mjs) once per run and
// stops it afterwards. T2_SITE_URL, T2_STUB_URL and T2_TMP (profile 'agents' also T2_EXPLORER_URL,
// T2_APPROVAL_SECRET and T2_PROFILE) are set before the test workers start, so every T2 file reads them from
// process.env. The profile is T2_PROFILE ('api' when unset, so every Phase 2 command keeps its meaning).
// With T2_REUSE=1 an already running harness (`npm run t2:up`, or `harness.mjs up --profile agents`) is used
// instead, through its urls file.

import { startHarness, urlsFile, waitForUrls } from './harness.mjs';

export default async function setup() {
  const profile = process.env.T2_PROFILE || 'api';
  if (process.env.T2_REUSE === '1') {
    const urls = await waitForUrls(5_000, profile);
    if (!urls) throw new Error(`T2_REUSE=1, but no running harness published ${urlsFile(profile)}`);
    if (urls.site) process.env.T2_SITE_URL = urls.site;
    if (urls.ops) process.env.T2_OPS_URL = urls.ops;
    process.env.T2_STUB_URL = urls.stub;
    process.env.T2_TMP = urls.tmp;
    if (profile === 'agents') {
      process.env.T2_PROFILE = profile;
      process.env.T2_EXPLORER_URL = urls.explorer;
      process.env.T2_APPROVAL_SECRET = urls.approvalSecret;
    }
    return undefined;
  }
  const harness = await startHarness({ profile });
  return async () => {
    await harness.stop();
  };
}
