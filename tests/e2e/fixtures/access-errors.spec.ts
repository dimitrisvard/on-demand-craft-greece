/**
 * Self-test for the error and teardown handling of ./access.ts (see "Errors"
 * in its header). Runs only against a local HTTP server it starts itself
 * (never BASE_URL) with fake credentials, through the same `test` fixture the
 * e2e specs use.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { test, expect, describeRouteError } from './access';

const CREDENTIALS = { id: 'selftest-id', secret: 'selftest-secret' };

/** How long the server holds /slow.png: well past the end of the test. */
const SLOW_MS = 2_000;

interface Hit {
  path: string;
  id: string | undefined;
  secret: string | undefined;
}

let hits: Hit[] = [];
let server: http.Server;
let origin = '';

const authed = (h: Hit) => h.id === CREDENTIALS.id && h.secret === CREDENTIALS.secret;

test.describe('Access fixture errors and teardown (local server only)', () => {
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      hits.push({
        path,
        id: req.headers['cf-access-client-id'] as string | undefined,
        secret: req.headers['cf-access-client-secret'] as string | undefined,
      });
      if (path === '/slow.png') {
        const timer = setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end();
        }, SLOW_MS);
        res.on('close', () => clearTimeout(timer));
        return;
      }
      if (path === '/reset') {
        req.socket.destroy();
        return;
      }
      const body = path === '/page' ? '<img src="/slow.png">' : '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>${path}</title></head><body>${path}${body}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  test.use({
    accessCredentials: CREDENTIALS,
    // eslint-disable-next-line no-empty-pattern
    baseURL: async ({}, use) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback, not a React hook
      await use(`${origin}/`);
    },
  });

  test.beforeEach(() => {
    hits = [];
  });

  test('a test may end while BASE_URL requests are still in flight', async ({ page }) => {
    await page.goto('/page', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => hits.some((h) => h.path === '/slow.png')).toBe(true);
    expect(hits.every(authed)).toBe(true);
    // The test ends here while the fixture still waits for /slow.png; closing
    // the context must not turn that pending route call into a failure.
  });

  test('a failed BASE_URL request is a network error and the log line hides the credentials', async ({ page }) => {
    await page.goto('/plain');
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    let result: string;
    try {
      result = await page.evaluate(() =>
        fetch('/reset').then(
          () => 'resolved',
          (err) => `rejected: ${err}`,
        ),
      );
    } finally {
      console.error = original;
    }
    expect(result).toMatch(/^rejected:/);
    expect(hits.some((h) => h.path === '/reset' && authed(h))).toBe(true);
    const log = logged.join('\n');
    expect(log).toContain(`GET ${origin}/reset`);
    expect(log).not.toContain(CREDENTIALS.secret);
    expect(log).not.toContain(CREDENTIALS.id);
  });

  test('describeRouteError keeps the first line and masks both credential values', () => {
    const err = new Error(
      `route.fetch: failed for ${CREDENTIALS.id}\nCall log:\n  - CF-Access-Client-Secret: ${CREDENTIALS.secret}`,
    );
    const line = describeRouteError(err, CREDENTIALS);
    expect(line).toBe('route.fetch: failed for <redacted>');
    expect(describeRouteError('plain text', CREDENTIALS)).toBe('plain text');
  });
});
