// /api router (src/api/router.ts), steps 1-9, with a fake OPS binding, a fake upstream (global fetch) and the gate,
// files API and the two local handlers replaced by spies (their own suites test them).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/gate', () => ({ applyGate: vi.fn(), actionIdOf: vi.fn() }));
vi.mock('../src/api/files', () => ({ handleFiles: vi.fn() }));
vi.mock('../src/api/emails', () => ({ handleEmails: vi.fn() }));
vi.mock('../src/api/track', () => ({ handleTrack: vi.fn() }));

import { MAX_FUNCTION_BODY_BYTES } from '../../shared/src/compat/vercel-node';
import type { OpsCall } from '../../shared/src/http/rpc';
import { handleEmails } from '../src/api/emails';
import { handleFiles } from '../src/api/files';
import { resolveApi, type ResolvedApi } from '../src/api/resolve';
import { createRouteApi, ENDPOINT_TARGETS, routeApi, targetOf } from '../src/api/router';
import { handleTrack } from '../src/api/track';
import { NO_FILE_CONSTRAINTS } from '../src/auth/constraints';
import { applyGate, type GateOutcome } from '../src/auth/gate';
import type { Env } from '../src/env';
import worker from '../src/index';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://microns-site.example.workers.dev';
const UPSTREAM = 'https://upstream.example';
const STAFF = { class: 'STAFF' as const, uid: '6f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f', roles: ['admin'] };

interface OpsSeen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
  call: OpsCall;
}

interface UpstreamSeen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

let opsSeen: OpsSeen[];
let upstreamSeen: UpstreamSeen[];
let opsHandle: ReturnType<typeof vi.fn>;
let logs: string[];
let errors: string[];
let ctx: TestContext;

function makeOps() {
  opsHandle = vi.fn(async (request: Request, call: OpsCall) => {
    opsSeen.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: new Uint8Array(await request.arrayBuffer()),
      call,
    });
    return new Response('ops answer', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  });
  return { handle: opsHandle, fetch: vi.fn() } as unknown as Fetcher & { handle(request: Request, call: OpsCall): Promise<Response> };
}

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) } as unknown as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: new MemoryKV().asBinding(),
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_ANON_KEY: 'dummy-not-a-secret',
    SITE_ORIGIN: 'https://www.micronshub.eu',
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: UPSTREAM,
    DIRECTORY_INDEX_EMULATION: 'true',
    OPS: makeOps(),
    PRIVATE_FILES: {} as R2Bucket,
    R2_ACCOUNT_ID: 't1account',
    R2_ACCESS_KEY_ID: 'dummy-not-a-secret',
    R2_SECRET_ACCESS_KEY: 'dummy-not-a-secret',
    LEGACY_S3_REGION: 'eu-north-1',
    LEGACY_S3_RFQ_BUCKET: 't1-rfq',
    LEGACY_S3_ARTICLES_BUCKET: 't1-articles',
    LEGACY_AWS_ACCESS_KEY_ID: 'dummy-not-a-secret',
    LEGACY_AWS_SECRET_ACCESS_KEY: 'dummy-not-a-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-not-a-secret',
    RESEND_API_KEY: 'dummy-not-a-secret',
    TURNSTILE_SECRET_KEY: 'dummy-not-a-secret',
    ...over,
  };
}

function api(method: string, path: string, init: { body?: Uint8Array | string; headers?: Record<string, string> } = {}): Request {
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body;
  return new Request(new URL(path, SITE), { method, headers: init.headers, body });
}

function bytesOf(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

// Byte comparison without a deep-equality walk (4.5 MiB bodies).
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function allow(extra: Partial<Extract<GateOutcome, { kind: 'allow' }>> = {}): GateOutcome {
  return { kind: 'allow', actionId: 'GS-1', principal: STAFF, ...extra };
}

function apiLogLines(): string[] {
  return logs.filter((line) => line.startsWith('[microns-site] api '));
}

beforeEach(() => {
  opsSeen = [];
  upstreamSeen = [];
  logs = [];
  errors = [];
  ctx = new TestContext();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer());
    upstreamSeen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body });
    return new Response('upstream answer', { status: 200, headers: { 'X-Upstream': '1' } });
  }));
  vi.mocked(applyGate).mockReset();
  vi.mocked(applyGate).mockImplementation(async () => allow());
  vi.mocked(handleFiles).mockReset();
  vi.mocked(handleFiles).mockImplementation(async () => Response.json({ files: true }));
  vi.mocked(handleEmails).mockReset();
  vi.mocked(handleEmails).mockImplementation(async () => Response.json({ emails: true }));
  vi.mocked(handleTrack).mockReset();
  vi.mocked(handleTrack).mockImplementation(async () => new Response('track'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('step 1: paths outside the catalogue are forwarded with the body unread', () => {
  it('GET /api/x goes to the upstream; nothing is resolved, gated or sent to OPS', async () => {
    const env = makeEnv();
    const res = await routeApi(api('GET', '/api/x?q=1'), env, ctx.asContext());
    expect(await res.text()).toBe('upstream answer');
    expect(upstreamSeen).toHaveLength(1);
    expect(upstreamSeen[0]).toMatchObject({ url: `${UPSTREAM}/api/x?q=1`, method: 'GET' });
    expect(applyGate).not.toHaveBeenCalled();
    expect(opsHandle).not.toHaveBeenCalled();
  });

  it('POST with a binary body to /api/x reaches the upstream byte for byte (no "body already used")', async () => {
    const body = bytesOf(1024);
    const res = await routeApi(api('POST', '/api/x', { body, headers: { 'content-type': 'application/octet-stream' } }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(200);
    expect(upstreamSeen[0].method).toBe('POST');
    expect(upstreamSeen[0].body).toEqual(body);
    expect(errors).toEqual([]);
  });

  it('an oversized body on an unknown path is not refused here (Vercel answers it)', async () => {
    const res = await routeApi(api('POST', '/api/x', { body: bytesOf(MAX_FUNCTION_BODY_BYTES + 1) }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(200);
    expect(upstreamSeen[0].body!.byteLength).toBe(MAX_FUNCTION_BODY_BYTES + 1);
  });
});

describe('step 2: the body is buffered once, at most 4.5 MiB', () => {
  it('4,718,593 bytes -> 413 {"error":"payload_too_large"}; nothing gated or dispatched', async () => {
    const res = await routeApi(api('POST', '/api/notifications', { body: bytesOf(MAX_FUNCTION_BODY_BYTES + 1) }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(applyGate).not.toHaveBeenCalled();
    expect(opsHandle).not.toHaveBeenCalled();
  });

  it('an oversized body is read to its end (and discarded) before the 413 is sent, declared length or not', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const total = 7; // 7 MiB, over the limit after the fifth chunk
    for (const headers of [undefined, { 'content-length': String(total * chunk.byteLength) }]) {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled === total) return controller.close();
          pulled++;
          controller.enqueue(chunk);
        },
      });
      const req = new Request(new URL('/api/emails', SITE), { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit);
      const res = await routeApi(req, makeEnv(), ctx.asContext());
      expect(res.status).toBe(413);
      expect(pulled).toBe(total);
    }
    expect(handleEmails).not.toHaveBeenCalled();
  });

  it('a declared Content-Length above the limit is refused before reading', async () => {
    const req = api('POST', '/api/emails', { body: '{}', headers: { 'content-length': String(MAX_FUNCTION_BODY_BYTES + 1), 'content-type': 'application/json' } });
    const res = await routeApi(req, makeEnv(), ctx.asContext());
    expect(res.status).toBe(413);
    expect(handleEmails).not.toHaveBeenCalled();
  });

  it('exactly 4,718,592 bytes are accepted and reach the handler intact', async () => {
    const body = bytesOf(MAX_FUNCTION_BODY_BYTES);
    const res = await routeApi(api('POST', '/api/notifications?action=nest', { body, headers: { 'content-type': 'application/octet-stream' } }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(200);
    expect(opsSeen[0].body.byteLength).toBe(MAX_FUNCTION_BODY_BYTES);
    expect(sameBytes(opsSeen[0].body, body)).toBe(true);
  });

  it('the request body is read once; every consumer gets the buffered bytes', async () => {
    const req = api('POST', '/api/emails', { body: '{"action":"contact","name":"n"}', headers: { 'content-type': 'application/json' } });
    await routeApi(req, makeEnv(), ctx.asContext());
    expect(req.bodyUsed).toBe(true);
    const r = vi.mocked(applyGate).mock.calls[0][0];
    expect(new TextDecoder().decode(r.bodyBytes)).toBe('{"action":"contact","name":"n"}');
    expect(new TextDecoder().decode(vi.mocked(handleEmails).mock.calls[0][0].body!)).toBe('{"action":"contact","name":"n"}');
  });
});

describe('steps 3 and 7: dispatch by target', () => {
  it('targetOf: emails and s3 local, marketing track local and every other marketing action ops, the rest ops', () => {
    const r = (method: string, path: string) => resolveApi(new Request(new URL(path, SITE), { method }), new Uint8Array(0));
    expect(targetOf(r('POST', '/api/emails'))).toBe('local');
    expect(targetOf(r('POST', '/api/s3?action=list'))).toBe('local');
    expect(targetOf(r('GET', '/api/marketing?action=track'))).toBe('local');
    expect(targetOf(r('GET', '/api/track?type=open'))).toBe('local');
    expect(targetOf(r('GET', '/api/track?action=webhook'))).toBe('ops');
    expect(targetOf(r('POST', '/api/marketing?action=webhook'))).toBe('ops');
    expect(targetOf(r('GET', '/api/marketing?action=google-auth&step=authorize'))).toBe('ops');
    expect(targetOf(r('POST', '/api/marketing?action=apollo-enrich'))).toBe('ops');
    expect(targetOf(r('GET', '/api/marketing?action=bogus'))).toBe('ops');
    for (const p of ['/api/notifications', '/api/gsc', '/api/tenders', '/api/connector-status', '/api/tender-scan', '/api/funded-startups', '/api/scrape-website', '/api/scrape-company-profile', '/api/scan-directory']) {
      expect(targetOf(r('POST', p)), p).toBe('ops');
    }
    expect(Object.values(ENDPOINT_TARGETS)).not.toContain('forward');
  });

  it('emails -> handleEmails with the function URL, the bytes and the gate principal', async () => {
    const res = await routeApi(api('POST', '/api/emails?action=contact', { body: '{}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    expect(await res.json()).toEqual({ emails: true });
    const input = vi.mocked(handleEmails).mock.calls[0][0];
    expect(input.functionUrl).toBe('/api/emails?action=contact');
    expect(input.principal).toEqual(STAFF);
    expect(new TextDecoder().decode(input.body!)).toBe('{}');
  });

  it('s3 -> handleFiles with the resolved request, the principal and the gate constraints', async () => {
    const constraints = { ...NO_FILE_CONSTRAINTS, staff: false, maxExpiresIn: 60 };
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'S3-2', constraints }));
    const res = await routeApi(api('POST', '/api/s3?action=presign-download', { body: '{"key":"k"}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    expect(await res.json()).toEqual({ files: true });
    const input = vi.mocked(handleFiles).mock.calls[0][0];
    expect(input.resolved).toMatchObject({ endpoint: 's3', action: 'presign-download', scope: 'rfq' });
    expect(input.principal).toEqual(STAFF);
    expect(input.constraints).toEqual(constraints);
    expect(input.env.R2_ACCOUNT_ID).toBe('t1account');
  });

  it('marketing track and /api/track -> handleTrack (merged function URL), GET without a body', async () => {
    await routeApi(api('GET', '/api/marketing?action=track&type=open&eid=e&cid=c'), makeEnv(), ctx.asContext());
    await routeApi(api('GET', '/api/track?type=open&eid=e&cid=c'), makeEnv(), ctx.asContext());
    const calls = vi.mocked(handleTrack).mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.functionUrl)).toEqual([
      '/api/marketing?action=track&type=open&eid=e&cid=c',
      '/api/marketing?type=open&eid=e&cid=c&action=track',
    ]);
    expect(calls.every((c) => c.body === null)).toBe(true);
    expect(opsHandle).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/api/marketing?action=webhook', 'marketing', 'webhook'],
    ['GET', '/api/track?action=webhook', 'marketing', 'webhook'],
    ['POST', '/api/notifications', 'notifications', 'partner'],
    ['GET', '/api/gsc?action=list-sites', 'gsc', 'gsc'],
    ['GET', '/api/tenders?stats_only=true', 'tenders', 'stats'],
    ['GET', '/api/connector-status', 'tenders', 'connectors'],
    ['POST', '/api/tender-scan', 'tender-scan', 'scan'],
    ['PATCH', '/api/funded-startups', 'funded-startups', 'patch'],
    ['POST', '/api/scrape-website', 'scrape-website', 'post'],
    ['POST', '/api/scrape-company-profile', 'scrape-company-profile', 'post'],
    ['POST', '/api/scan-directory', 'scan-directory', 'post'],
  ])('%s %s -> OPS (%s, %s)', async (method, path, endpoint, action) => {
    const hasBody = method !== 'GET';
    const res = await routeApi(api(method, path, hasBody ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}), makeEnv(), ctx.asContext());
    expect(await res.text()).toBe('ops answer');
    expect(opsHandle).toHaveBeenCalledTimes(1);
    expect(opsSeen[0].call).toMatchObject({ v: 1, endpoint, action, principal: STAFF });
  });
});

describe('step 4: names of the dispatch target only', () => {
  it('a missing target name answers 500 text/plain and logs the names (no value)', async () => {
    const env = makeEnv({ OPS: undefined });
    const res = await routeApi(api('GET', '/api/tenders'), env, ctx.asContext());
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Internal Server Error');
    expect(errors).toContain('[microns-site] api config missing: OPS');
    expect(applyGate).not.toHaveBeenCalled();
  });
});

describe('steps 5-6: sentinels ungated, everything else through the gate', () => {
  it.each([
    ['OPTIONS', '/api/emails', '#options'],
    ['GET', '/api/emails', '#method'],
    ['POST', '/api/s3?action=bogus', '#unknown'],
    ['POST', '/api/s3?action=list', '#throws'],
    ['GET', '/api/marketing?action=google-auth&step=x', '#unknown-step'],
    ['OPTIONS', '/api/marketing?action=apollo-enrich', '#options'],
    ['GET', '/api/marketing?action=bogus', '#unknown'],
    ['OPTIONS', '/api/notifications', '#options'],
    ['POST', '/api/notifications', '#throws'],
    ['OPTIONS', '/api/gsc', '#options'],
    ['POST', '/api/tenders', '#method'],
    ['GET', '/api/tender-scan', '#method'],
    ['DELETE', '/api/funded-startups', '#method'],
    ['OPTIONS', '/api/scan-directory', '#options'],
  ])('%s %s (%s) never reaches applyGate and is dispatched as ANON', async (method, path, sentinel) => {
    const withBody = method !== 'GET' && method !== 'OPTIONS';
    const body = sentinel === '#throws' ? '{bad' : '{}';
    await routeApi(api(method, path, withBody ? { body, headers: { 'content-type': 'application/json' } } : {}), makeEnv(), ctx.asContext());
    expect(applyGate).not.toHaveBeenCalled();
    const dispatched =
      vi.mocked(handleEmails).mock.calls[0]?.[0].principal ??
      vi.mocked(handleFiles).mock.calls[0]?.[0].principal ??
      opsSeen[0]?.call.principal;
    expect(dispatched).toEqual({ class: 'ANON' });
    if (opsSeen[0]) expect(opsSeen[0].call.action).toBe(sentinel);
    if (vi.mocked(handleFiles).mock.calls[0]) {
      expect(vi.mocked(handleFiles).mock.calls[0][0].resolved.action).toBe(sentinel);
      expect(vi.mocked(handleFiles).mock.calls[0][0].constraints).toEqual(NO_FILE_CONSTRAINTS);
    }
  });

  it('OPTIONS on google-auth&step=refresh is gated like GET', async () => {
    vi.mocked(applyGate).mockImplementation(async () => ({ kind: 'deny', actionId: 'MK-5', response: Response.json({ error: 'unauthorized' }, { status: 401 }) }));
    const res = await routeApi(api('OPTIONS', '/api/marketing?action=google-auth&step=refresh'), makeEnv(), ctx.asContext());
    expect(applyGate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(opsHandle).not.toHaveBeenCalled();
  });

  it('deny and respond answer for the handler; nothing is dispatched', async () => {
    vi.mocked(applyGate).mockImplementationOnce(async () => ({ kind: 'deny', actionId: 'TD-1', response: Response.json({ error: 'forbidden' }, { status: 403 }) }));
    const denied = await routeApi(api('GET', '/api/tenders'), makeEnv(), ctx.asContext());
    expect(denied.status).toBe(403);
    vi.mocked(applyGate).mockImplementationOnce(async () => ({ kind: 'respond', actionId: 'MK-1', response: new Response('pixel', { status: 200 }) }));
    const responded = await routeApi(api('GET', '/api/track?type=open&eid=e&cid=c'), makeEnv(), ctx.asContext());
    expect(await responded.text()).toBe('pixel');
    expect(opsHandle).not.toHaveBeenCalled();
    expect(handleTrack).not.toHaveBeenCalled();
  });

  it('allow overrides: the function URL reaches the local handler', async () => {
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'MK-1', principal: { class: 'ANON' }, functionUrl: '/api/marketing?action=track&type=click&eid=e&cid=c&url=https%3A%2F%2Fwww.micronshub.eu%2F' }));
    await routeApi(api('GET', '/api/marketing?action=track&type=click&eid=e&cid=c&url=https%3A%2F%2Felsewhere.example%2F'), makeEnv(), ctx.asContext());
    expect(vi.mocked(handleTrack).mock.calls[0][0].functionUrl).toBe('/api/marketing?action=track&type=click&eid=e&cid=c&url=https%3A%2F%2Fwww.micronshub.eu%2F');
  });

  it('allow overrides: a rewritten body arrives intact at OPS, with the function URL and the opener origin', async () => {
    const rewritten = new TextEncoder().encode('{"action":"inv-label","tenant_id":"t-from-gate","note":"ä€"}');
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'NT-5', body: rewritten, functionUrl: '/api/notifications?action=inv-label', openerOrigin: SITE }));
    const original = '{"action":"inv-label","tenant_id":"client-value"}';
    await routeApi(api('POST', '/api/notifications?action=inv-label&tenant_id=x', { body: original, headers: { 'content-type': 'application/json', 'content-length': String(original.length) } }), makeEnv(), ctx.asContext());
    expect(opsSeen[0].body).toEqual(rewritten);
    expect(opsSeen[0].url).toBe(`${SITE}/api/notifications?action=inv-label`);
    expect(opsSeen[0].call.functionUrl).toBe('/api/notifications?action=inv-label');
    expect(opsSeen[0].call.openerOrigin).toBe(SITE);
    expect(opsSeen[0].headers['content-length']).toBeUndefined();
  });

  it('allow overrides on s3: handleFiles sees the rewritten body and query, with the action already decided', async () => {
    const rewritten = new TextEncoder().encode('{"key":"rfq-1/a.step","expiresIn":60}');
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'S3-2', body: rewritten, functionUrl: '/api/s3?action=presign-download&x=1' }));
    await routeApi(api('POST', '/api/s3?action=presign-download', { body: '{"key":"rfq-1/a.step","expiresIn":999999}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    const resolved = vi.mocked(handleFiles).mock.calls[0][0].resolved;
    expect(resolved.body).toEqual({ ok: true, value: { key: 'rfq-1/a.step', expiresIn: 60 } });
    expect(resolved.bodyBytes).toEqual(rewritten);
    expect(resolved.query).toEqual({ action: 'presign-download', x: '1' });
    expect(resolved.action).toBe('presign-download');
  });
});

describe('callOps: the request handed to microns-ops', () => {
  it('URL on the client host, method kept, credentials and hop-by-hop headers stripped, principal only in the call', async () => {
    const body = '{"country_code":"GR"}';
    const req = api('POST', '/api/connector-status?x=1', {
      body,
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        authorization: 'Bearer test-token-value',
        cookie: 'sb=1',
        'cf-access-client-id': 'id.access',
        'cf-access-client-secret': 'not-a-real-secret',
        'cf-access-jwt-assertion': 'assertion',
        'cf-connecting-ip': '198.51.100.7',
        'x-microns-principal': 'ADMIN',
        'X-Microns-Request-Id': 'forged',
        connection: 'keep-alive, x-hop-named',
        'x-hop-named': '1',
        'keep-alive': 'timeout=5',
        te: 'trailers',
        upgrade: 'h2c',
        'proxy-authorization': 'Basic x',
        host: 'evil.example',
        'x-custom': 'kept',
        accept: 'application/json',
      },
    });
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'TD-2' }));
    await routeApi(new Request(req, { method: 'PATCH' }), makeEnv(), ctx.asContext());
    const seen = opsSeen[0];
    expect(seen.url).toBe(`${SITE}/api/tenders?x=1&connectors=true`);
    expect(seen.method).toBe('PATCH');
    expect(Object.keys(seen.headers).sort()).toEqual(['accept', 'authorization', 'cf-connecting-ip', 'content-type', 'x-custom']);
    expect(new TextDecoder().decode(seen.body)).toBe(body);
    expect(seen.call).toEqual({
      v: 1,
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      endpoint: 'tenders',
      action: 'patch',
      functionUrl: '/api/tenders?x=1&connectors=true',
      principal: STAFF,
    });
  });

  it('GET carries no body', async () => {
    await routeApi(api('GET', '/api/funded-startups?action=stats'), makeEnv(), ctx.asContext());
    expect(opsSeen[0].method).toBe('GET');
    expect(opsSeen[0].body.byteLength).toBe(0);
  });

  it('an RPC rejection answers 500 text/plain; on nest 504 JSON TIMEOUT', async () => {
    const env = makeEnv();
    opsHandle.mockRejectedValue(new Error('Worker exceeded CPU time limit.'));
    const plain = await routeApi(api('POST', '/api/notifications', { body: '{"action":"partner"}', headers: { 'content-type': 'application/json' } }), env, ctx.asContext());
    expect(plain.status).toBe(500);
    expect(plain.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await plain.text()).toBe('Internal Server Error');
    const nest = await routeApi(api('POST', '/api/notifications', { body: '{"action":"nest"}', headers: { 'content-type': 'application/json' } }), env, ctx.asContext());
    expect(nest.status).toBe(504);
    expect(nest.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await nest.text()).toBe('{"success":false,"error":"Nesting exceeded the time limit","code":"TIMEOUT"}');
    expect(errors.some((e) => e.startsWith('[microns-site] api ops call failed endpoint=notifications action=nest'))).toBe(true);
  });
});

describe('forward target (an endpoint whose port is not finished)', () => {
  it('a gated POST reaches the upstream with the exact buffered bytes', async () => {
    const route = createRouteApi({ ...ENDPOINT_TARGETS, gsc: 'forward' });
    const body = bytesOf(2048, 3);
    const res = await route(api('POST', '/api/gsc?action=bulk', { body, headers: { 'content-type': 'application/octet-stream' } }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(200);
    expect(applyGate).toHaveBeenCalledTimes(1);
    expect(upstreamSeen[0]).toMatchObject({ url: `${UPSTREAM}/api/gsc?action=bulk`, method: 'POST' });
    expect(upstreamSeen[0].body).toEqual(body);
    expect(opsHandle).not.toHaveBeenCalled();
  });

  it('a gate override of the function URL is what the upstream receives', async () => {
    const route = createRouteApi({ ...ENDPOINT_TARGETS, marketing: 'forward' });
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'MK-1', functionUrl: '/api/marketing?type=click&action=track&url=x' }));
    await route(api('GET', '/api/track?type=click&url=y'), makeEnv(), ctx.asContext());
    expect(upstreamSeen[0].url).toBe(`${UPSTREAM}/api/marketing?type=click&action=track&url=x`);
  });
});

describe('errors and the log line', () => {
  it('a handler throw answers 500 text/plain, logged with the request id', async () => {
    vi.mocked(handleEmails).mockRejectedValue(new Error('handler failed for someone@example.com'));
    const res = await routeApi(api('POST', '/api/emails', { body: '{}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');
    expect(errors.some((e) => e.includes('[microns-site] api handler error endpoint=emails requestId='))).toBe(true);
    expect(errors.join('\n')).not.toContain('someone@example.com');
  });

  it('a gate throw answers 500', async () => {
    vi.mocked(applyGate).mockRejectedValue(new Error('gate: no action id'));
    const res = await routeApi(api('GET', '/api/tenders'), makeEnv(), ctx.asContext());
    expect(res.status).toBe(500);
  });

  it('one api line per request: endpoint, action, action id, target, status, ms, principal class, request id; no body', async () => {
    vi.mocked(applyGate).mockImplementation(async () => allow({ actionId: 'NT-5' }));
    await routeApi(api('POST', '/api/notifications', { body: '{"action":"inv-label","email":"someone@example.com"}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    const lines = apiLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[microns-site\] api endpoint=notifications action=inv-label actionId=NT-5 target=ops status=200 ms=\d+ principal=STAFF requestId=[0-9a-f-]{36}$/);
    expect(lines[0]).toContain(`requestId=${opsSeen[0].call.requestId}`);
    expect(logs.join('\n')).not.toContain('someone@example.com');
  });

  it('a client-chosen inv- action outside [a-z0-9-] is logged as invalid', async () => {
    await routeApi(api('POST', '/api/notifications', { body: '{"action":"inv-x someone@example.com"}', headers: { 'content-type': 'application/json' } }), makeEnv(), ctx.asContext());
    expect(apiLogLines()[0]).toContain('action=invalid');
    expect(logs.join('\n')).not.toContain('someone@example.com');
  });
});

describe('step 9: the answer leaves through finalise() (src/index.ts)', () => {
  it('a router answer (413) carries the vercel.json CORS headers and noindex on the preview host', async () => {
    const res = await worker.fetch(api('POST', '/api/emails', { body: bytesOf(MAX_FUNCTION_BODY_BYTES + 1) }), makeEnv(), ctx.asContext());
    expect(res.status).toBe(413);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,OPTIONS,PATCH,DELETE,POST,PUT');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('an OPS answer to HEAD keeps status and headers without a body', async () => {
    const res = await worker.fetch(api('HEAD', '/api/tenders'), makeEnv(), ctx.asContext());
    expect(opsSeen[0].call.action).toBe('#method');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// Keep the resolved type in use for readers of the mocks above.
export type { ResolvedApi };
