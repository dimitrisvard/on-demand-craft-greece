/**
 * Self-test for ./access.ts. Runs only against two local HTTP servers it
 * starts itself (never BASE_URL) and fake credentials, and asserts that the
 * Access headers reach the BASE_URL origin and never any other origin —
 * including through redirects (SEO_PARITY.md §6).
 */
import { test, expect } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { MAX_HOPS, accessCredentialsFromEnv, installAccessRoute } from './access';

const CREDENTIALS = { id: 'selftest-id', secret: 'selftest-secret' };

interface Hit {
  server: 'A' | 'B';
  method: string;
  path: string;
  id: string | undefined;
  secret: string | undefined;
}

let hits: Hit[] = [];
let serverA: http.Server;
let serverB: http.Server;
let originA = '';
let originB = '';

function startServer(name: 'A' | 'B'): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const path = req.url ?? '/';
      hits.push({
        server: name,
        method: req.method ?? '',
        path,
        id: req.headers['cf-access-client-id'] as string | undefined,
        secret: req.headers['cf-access-client-secret'] as string | undefined,
      });
      const redirect = (to: string) => {
        res.writeHead(302, { Location: to });
        res.end();
      };
      if (path === '/same') return redirect('/landing');
      if (path === '/abs-same') return redirect(`${originA}/landing`);
      if (path === '/cross') return redirect(`${originB}/x`);
      if (path === '/chain') return redirect('/cross');
      if (path === '/long') return redirect('/long/1');
      const long = /^\/long\/(\d+)$/.exec(path);
      if (long) {
        const n = Number(long[1]);
        return n > MAX_HOPS ? redirect(`${originB}/x`) : redirect(`/long/${n + 1}`);
      }
      if (path === '/post' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`posted:${body}`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><title>${name} ${path}</title></head>` +
          `<body>${name} ${path}<img src="${name === 'A' ? originB : originA}/pixel.png">` +
          `<img src="/self.png"></body></html>`,
      );
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test.describe('Access fixture self-test (local servers only)', () => {
  test.beforeAll(async () => {
    serverA = await startServer('A');
    serverB = await startServer('B');
    originA = `http://127.0.0.1:${(serverA.address() as AddressInfo).port}`;
    originB = `http://127.0.0.1:${(serverB.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise((r) => serverA.close(r));
    await new Promise((r) => serverB.close(r));
  });

  test.beforeEach(async ({ context }) => {
    hits = [];
    await installAccessRoute(context, `${originA}/`, CREDENTIALS);
  });

  const onA = () => hits.filter((h) => h.server === 'A');
  const onB = () => hits.filter((h) => h.server === 'B');
  const authed = (h: Hit) => h.id === CREDENTIALS.id && h.secret === CREDENTIALS.secret;
  const leaked = (h: Hit) => h.id !== undefined || h.secret !== undefined;

  // The page is served by B (not routed, loaded natively) and embeds a
  // subresource from A and one from B. (A *fulfilled* A document cannot be
  // used here: Chromium treats a fulfilled document as public address space
  // and blocks its loopback subresources under Private Network Access — a
  // local-test artefact; real third-party hosts are public.)
  test('headers go to the BASE_URL origin only, not to a cross-origin request', async ({ page }) => {
    const res = await page.goto(`${originB}/page`);
    expect(res?.status()).toBe(200);
    await expect.poll(() => onA().some((h) => h.path === '/pixel.png')).toBe(true);
    await expect.poll(() => onB().some((h) => h.path === '/self.png')).toBe(true);
    expect(onA().every(authed)).toBe(true);
    expect(onB().some(leaked)).toBe(false);
  });

  test('same-origin redirect is followed natively with the headers on every hop', async ({ page }) => {
    const res = await page.goto(`${originA}/same`);
    expect(res?.status()).toBe(200);
    expect(page.url()).toBe(`${originA}/landing`);
    const landing = onA().filter((h) => h.path === '/landing');
    expect(landing.length).toBeGreaterThan(0);
    expect(onA().every(authed)).toBe(true);
    expect(onB().some(leaked)).toBe(false);
  });

  test('absolute same-origin redirect keeps the headers', async ({ page }) => {
    const res = await page.goto(`${originA}/abs-same`);
    expect(res?.status()).toBe(200);
    expect(page.url()).toBe(`${originA}/landing`);
    expect(onA().every(authed)).toBe(true);
  });

  test('cross-origin redirect: the other origin never receives the headers', async ({ page }) => {
    const res = await page.goto(`${originA}/cross`);
    expect(res?.status()).toBe(200);
    expect(page.url()).toBe(`${originB}/x`);
    expect(onB().some((h) => h.path === '/x')).toBe(true);
    expect(onB().some(leaked)).toBe(false);
  });

  test('same-origin hop followed by a cross-origin hop does not leak', async ({ page }) => {
    const res = await page.goto(`${originA}/chain`);
    expect(res?.status()).toBe(200);
    expect(page.url()).toBe(`${originB}/x`);
    expect(onB().some(leaked)).toBe(false);
  });

  test('chain longer than MAX_HOPS that ends off-origin does not leak', async ({ page }) => {
    // MAX_HOPS + 2 redirects in total, below Chromium's own limit of 20.
    await page.goto(`${originA}/long`);
    expect(page.url()).toBe(`${originB}/x`);
    expect(onB().some(leaked)).toBe(false);
  });

  test('same-origin POST keeps method, body and headers', async ({ page }) => {
    await page.goto(`${originA}/page`);
    const text = await page.evaluate(async () => (await fetch('/post', { method: 'POST', body: 'hello' })).text());
    expect(text).toBe('posted:hello');
    const post = onA().filter((h) => h.method === 'POST');
    expect(post.length).toBe(1);
    expect(post.every(authed)).toBe(true);
  });

  test('credentials are read only when both variables are non-empty', () => {
    expect(accessCredentialsFromEnv({})).toBeNull();
    expect(accessCredentialsFromEnv({ CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: '' })).toBeNull();
    expect(accessCredentialsFromEnv({ CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b' })).toEqual({
      id: 'a',
      secret: 'b',
    });
  });
});
