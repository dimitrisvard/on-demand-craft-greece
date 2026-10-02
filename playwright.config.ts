import { defineConfig } from '@playwright/test';

// BASE_URL selects the host under test (default: production).
// For a Cloudflare preview behind Access, also set CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET: the specs import `test` from ./tests/e2e/fixtures/access,
// which adds the two headers only to requests for the BASE_URL origin via
// context.route(). Do not use `extraHTTPHeaders` here — it would send the
// service token to every third-party host the page loads
// (docs/migration/SEO_PARITY.md §6).
//
// Traces (and HAR files) record full request headers, so with the Access
// credentials set tracing is turned off: a trace.zip under test-results/
// would otherwise contain CF-Access-Client-Secret in plain text. Never upload
// test-results/ or playwright-report/ as CI artifacts from such a run.
const ACCESS_CREDENTIALS_SET =
  !!process.env.CF_ACCESS_CLIENT_ID || !!process.env.CF_ACCESS_CLIENT_SECRET;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'https://www.micronshub.eu',
    screenshot: 'only-on-failure',
    trace: ACCESS_CREDENTIALS_SET ? 'off' : 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
