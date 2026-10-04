// T2: e-mail tracking links over real workerd (/api/marketing?action=track and the /api/track alias), the unchanged
// api/marketing.js through the shim, with the stub database answering "not found" (its default).
//   - byte fixtures: T1 pixel (70 B), T2, T5, T10 JSON answers
//   - shapes: T3 pixel with the four cache headers, T6 302 with Cache-Control no-store, T9 unsubscribe page (547 B)
//   - every database call goes to the stub (SUPABASE_URL of the generated config)
// Each case uses its own sent-event id, so the per-event rate limit of tracking links never interferes.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface StubClient {
  stubReset(): Promise<void>;
  stubCalls(): Promise<Array<{ method: string; path: string; headers?: Record<string, string> }>>;
}

const SITE = (process.env.T2_SITE_URL as string | undefined) ?? '';
const PIXEL_SHA256 = '497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581';
const UNSUBSCRIBE_SHA256 = '2c9b981f4b00465600eb652d7cb3bf19d1d31327b57293d626e6344411a5eb43';
const NO_CACHE = 'no-store, no-cache, must-revalidate, proxy-revalidate';
const CID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let stub: StubClient;

async function loadStubClient(): Promise<StubClient> {
  const specifier = new URL('./stub-client.ts', (import.meta as unknown as { url: string }).url).href;
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

function eid(): string {
  return crypto.randomUUID();
}

function track(query: string, alias = false): Promise<Response> {
  const path = alias ? `/api/track?${query}` : `/api/marketing?action=track&${query}`;
  return fetch(`${SITE}${path}`, { redirect: 'manual' });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeAll(async () => {
  expect(SITE, 'T2_SITE_URL is set by the T2 harness (vitest.t2.config.ts globalSetup)').not.toBe('');
  stub = await loadStubClient();
});

beforeEach(async () => {
  await stub.stubReset();
});

describe('byte fixtures (no database read)', () => {
  it.each([false, true])('T1: type=open without ids -> the 70-byte pixel (alias %s)', async (alias) => {
    const res = await track('type=open', alias);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(NO_CACHE);
    expect(res.headers.get('pragma')).toBeNull();
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(70);
    expect(await sha256(body)).toBe(PIXEL_SHA256);
  });

  it('T2: no ids, other type -> 400 {"error":"Missing required parameters"}', async () => {
    const res = await track(`type=click&eid=${eid()}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.text()).toBe('{"error":"Missing required parameters"}');
  });

  it('T5: click without url -> 400 {"error":"Missing url parameter"}', async () => {
    const res = await track(`type=click&eid=${eid()}&cid=${CID}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Missing url parameter"}');
  });

  it('T10: ids with another type -> 400 {"error":"Invalid tracking type"}', async () => {
    const res = await track(`type=bogus&eid=${eid()}&cid=${CID}`, true);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Invalid tracking type"}');
  });

  it('none of these reads the database', async () => {
    await (await track('type=open')).arrayBuffer();
    await (await track(`type=click&eid=${eid()}`)).arrayBuffer();
    expect(await stub.stubCalls()).toEqual([]);
  });
});

describe('shapes after a "not found" database read', () => {
  it('T3: open with ids -> pixel with Cache-Control, Pragma and Expires', async () => {
    const res = await track(`type=open&eid=${eid()}&cid=${CID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(NO_CACHE);
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.headers.get('expires')).toBe('0');
    expect(await sha256(await res.arrayBuffer())).toBe(PIXEL_SHA256);
  });

  it('T6: click to a site page -> 302 to the decoded url, Cache-Control no-store, empty body', async () => {
    const target = 'https://www.micronshub.eu/en/services';
    const res = await track(`type=click&eid=${eid()}&cid=${CID}&url=${encodeURIComponent(encodeURIComponent(target))}`, true);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(target);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('T9: unsubscribe -> the 547-byte page as text/html', async () => {
    const res = await track(`type=unsubscribe&eid=${eid()}&cid=${CID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(547);
    expect(await sha256(body)).toBe(UNSUBSCRIBE_SHA256);
  });

  it('the reads go to the stub database only', async () => {
    const id = eid();
    await (await track(`type=open&eid=${id}&cid=${CID}`)).arrayBuffer();
    const calls = await stub.stubCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.path.startsWith('/rest/v1/marketing_events?'))).toBe(true);
    expect(calls.some((c) => c.path.includes(id))).toBe(true);
  });
});
