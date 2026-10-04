// T2: /api/s3 through the real site Worker (wrangler dev with both Worker configs, local R2 binding and the
// upstream stub of test/integration/harness.mjs). Run with `npm run test:integration -- files.t2`.
//   - sentinels answered by the files API itself (OPTIONS 204, unknown action, invalid JSON), with parity CORS
//   - presign-upload as staff: presigned PUT on the R2 S3 endpoint (EU jurisdiction), 300 s, Content-Type signed
//   - presign-download as staff: the local R2 binding is asked first (head); a key it does not hold is presigned on
//     the legacy bucket
// Only paths that stay on this machine are exercised: list, delete and delete-folder also call the legacy S3 API,
// which T2 never reaches (they are covered against the fake S3 in test/files.test.ts and on the preview in T3).
// The stub client (test/integration/stub-client.ts) is loaded at run time, so this file type-checks on its own.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  stubReset(): Promise<void>;
  stubCalls(): Promise<Array<{ method: string; path: string; headers?: Record<string, string> }>>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
}

const SITE = (process.env.T2_SITE_URL as string | undefined) ?? '';
// Values the harness writes into the generated site config (§2.12): R2 account and legacy bucket names.
const R2_HOST = 't2account.eu.r2.cloudflarestorage.com';
const RFQ_BUCKET = 't2-rfq';
const REGION = 'eu-north-1';
const UID = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

let stub: StubClient;

async function loadStubClient(): Promise<StubClient> {
  const specifier = './stub-client';
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

async function staffToken(): Promise<string> {
  const token = await stub.mintSupabaseJwt({ sub: UID, email: 't2-staff@example.test', exp: Math.floor(Date.now() / 1000) + 600 });
  await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: UID, email: 't2-staff@example.test' } });
  await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: [{ role: 'admin' }] });
  return token;
}

function s3(action: string, body: unknown, token?: string, method = 'POST'): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${SITE}/api/s3?action=${action}`, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
}

beforeAll(async () => {
  expect(SITE, 'T2_SITE_URL is set by the T2 harness (vitest.t2.config.ts globalSetup)').not.toBe('');
  stub = await loadStubClient();
});

beforeEach(async () => {
  await stub.stubReset();
});

describe('/api/s3 sentinels through the Worker', () => {
  it('OPTIONS: 204 without a body, parity CORS headers', async () => {
    const res = await fetch(`${SITE}/api/s3?action=presign-upload`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('unknown action: 400 with the value, no credential needed', async () => {
    const res = await s3('bogus', {});
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'Unknown action: bogus' });
  });

  it('invalid JSON: 500 Invalid JSON', async () => {
    const res = await s3('list', '{not json');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });
});

describe('/api/s3 presigned URLs through the Worker (staff)', () => {
  it('presign-upload: R2 EU endpoint, rfq/ key prefix, 300 s, Content-Type signed; contract key and legacy publicUrl', async () => {
    const token = await staffToken();
    const res = await s3('presign-upload', { fileName: 'part 1.step', prefix: 'RFQ-04102026-7/part-a', contentType: 'model/step' }, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { uploadUrl: string; key: string; publicUrl: string };
    expect(body.key).toBe('RFQ-04102026-7/part-a/part_1.step');
    expect(body.publicUrl).toBe(`https://${RFQ_BUCKET}.s3.${REGION}.amazonaws.com/RFQ-04102026-7/part-a/part_1.step`);
    const url = new URL(body.uploadUrl);
    expect(url.host).toBe(R2_HOST);
    expect(url.pathname).toBe('/microns-private/rfq/RFQ-04102026-7/part-a/part_1.step');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/\/auto\/s3\/aws4_request$/);
  });

  it('presign-download: a key the local R2 binding does not hold is presigned on the legacy bucket, 3600 s at most', async () => {
    const token = await staffToken();
    const res = await s3('presign-download', { key: 'RFQ-04102026-7/part-a/none.step', expiresIn: 86_400 }, token);
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.host).toBe(`${RFQ_BUCKET}.s3.${REGION}.amazonaws.com`);
    expect(url.pathname).toBe('/RFQ-04102026-7/part-a/none.step');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(new RegExp(`/${REGION}/s3/aws4_request$`));
  });

  it('presign-upload with a dot segment in the prefix: 500, no URL', async () => {
    const token = await staffToken();
    const res = await s3('presign-upload', { fileName: 'x.step', prefix: 'RFQ-1/../RFQ-2' }, token);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('path segment');
  });
});
