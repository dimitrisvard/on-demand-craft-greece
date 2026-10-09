// /api/cad/flat-pattern in microns-ops (src/routes/cad-compat.ts; PHASE5_SPEC §5.9): caller and method checks,
// configuration, body validation (exact answer texts), the URL rewrite to cad-input.internal with the key order and
// every other field unchanged, X-API-Key, the interactive lease (busy -> 503 after 20 s), the 110 s end-to-end
// deadline (-> 502), the container answer returned unchanged, the lease release outcome (recycle on a crash),
// the Analytics Engine point, and log lines that never carry the input URL, the body or a key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsCall } from '../../../../shared/src/http/rpc';
import { CAD_ALERT_TEXTS, resetCadAlerts } from '../../../src/cad-container/alerts';
import { decodeInputUrl } from '../../../src/cad-container/input-proxy';
import type { AgentEventPoint } from '../../../src/agents/events';
import type { OpsEnv } from '../../../src/env';
import { OpsApi } from '../../../src/index';
import { ScriptedContainer, TelegramTextRecorder } from '../../../src/ports/p5-stub/index';
import {
  ACQUIRE_RETRY_MS,
  ACQUIRE_WAIT_MS,
  COMPAT_DEADLINE_MS,
  COMPAT_DETAIL,
  COMPAT_PATH,
  CONTAINER_FLAT_PATTERN_URL,
  MAX_COMPAT_BODY_BYTES,
  handleCadCompat,
  isPlainFileName,
  type CadCompatDeps,
  type CompatRouter,
} from '../../../src/routes/cad-compat';
import { invoke, opsEnv } from '../../helpers/ops';
import { serviceJson, TEST_KEY, testRouter } from './helpers';

const HOST = 'files.example.test';
const FILE_URL = `https://${HOST}/rfq/7c1e/part.step?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=0123abcd`;
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

function env(over: Partial<OpsEnv> = {}): OpsEnv {
  const { ns } = testRouter({ CAD_SLOTS: '3' });
  return opsEnv({
    CAD_ROUTER: ns as unknown as OpsEnv['CAD_ROUTER'],
    CAD_CONTAINER: {} as OpsEnv['CAD_CONTAINER'],
    CAD_SHARED_SECRET: TEST_KEY,
    CAD_INPUT_HOSTS: HOST,
    CAD_SLOTS: '3',
    ...over,
  });
}

function call(over: Partial<OpsCall> = {}): OpsCall {
  return {
    v: 1,
    requestId: 'req-compat-1',
    endpoint: 'cad-compat',
    action: '',
    functionUrl: COMPAT_PATH,
    principal: { class: 'MACHINE', machine: 'cad-compat' },
    ...over,
  } as unknown as OpsCall;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://www.micronshub.eu${COMPAT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface Harness {
  container: ScriptedContainer;
  telegram: TelegramTextRecorder;
  points: AgentEventPoint[];
  sleeps: number[];
  clock: { t: number };
  deps: CadCompatDeps;
  router: CompatRouter & { acquires: unknown[]; releases: Array<{ id: string; o: unknown }> };
  routerEnv: ReturnType<typeof testRouter>;
}

function harness(script?: (slot: string, req: Request) => Response | Promise<Response>, routerOver?: Partial<CompatRouter>): Harness {
  const container = new ScriptedContainer(script ?? (() => serviceJson(200, { success: true, flat_width: 180.5 })));
  const routerEnv = testRouter({ CAD_SLOTS: '3' }, container);
  const real = routerEnv.router;
  const acquires: unknown[] = [];
  const releases: Array<{ id: string; o: unknown }> = [];
  const router = {
    acquires,
    releases,
    acquire: async (r: Parameters<CompatRouter['acquire']>[0]) => {
      acquires.push(structuredClone(r));
      return (routerOver?.acquire ?? ((x) => real.acquire(x)))(r);
    },
    release: async (id: string, o: Parameters<CompatRouter['release']>[1]) => {
      releases.push({ id, o: structuredClone(o) });
      return real.release(id, o);
    },
  };
  const clock = { t: T0 };
  const points: AgentEventPoint[] = [];
  const sleeps: number[] = [];
  const telegram = new TelegramTextRecorder();
  const deps: CadCompatDeps = {
    router,
    container,
    telegramText: telegram,
    event: (p) => points.push(p),
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    uuid: () => '9f0c3b1a-0000-4000-8000-000000000001',
  };
  return { container, telegram, points, sleeps, clock, deps, router, routerEnv };
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  resetCadAlerts();
  vi.spyOn(console, 'log').mockImplementation((l: unknown) => void logs.push(String(l)));
  vi.spyOn(console, 'error').mockImplementation((l: unknown) => void logs.push(String(l)));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('caller, method and configuration', () => {
  it('only MACHINE:cad-compat on endpoint cad-compat; other callers answer 403 without a lease', async () => {
    const h = harness();
    for (const c of [
      call({ principal: { class: 'MACHINE', machine: 'collector' } }),
      call({ principal: { class: 'STAFF', uid: 'u1', roles: ['admin'] } }),
      call({ principal: { class: 'ANON' } }),
      call({ endpoint: 'tenders' }),
    ]) {
      const res = await handleCadCompat(post({ file_url: FILE_URL }), env(), c, h.deps);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ detail: COMPAT_DETAIL.forbidden });
    }
    expect(h.router.acquires).toEqual([]);
  });

  it('POST only (405 with Allow: POST)', async () => {
    const h = harness();
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const res = await handleCadCompat(new Request(`https://x${COMPAT_PATH}`, { method }), env(), call(), h.deps);
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('missing configuration answers 502 CAD unavailable and names what is missing (never a value)', async () => {
    const h = harness();
    const res = await handleCadCompat(post({ file_url: FILE_URL }), env({ CAD_SHARED_SECRET: undefined, CAD_INPUT_HOSTS: ' ', CAD_CONTAINER: undefined }), call(), h.deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: COMPAT_DETAIL.unavailable });
    expect(logs.join('\n')).toContain('missing=CAD_CONTAINER,CAD_SHARED_SECRET,CAD_INPUT_HOSTS');
    expect(h.router.acquires).toEqual([]);
    expect(h.points.map((p) => p.outcome)).toEqual(['config_missing']);
  });
});

describe('body validation (answer texts)', () => {
  it('file_url must be https: on an allowed host without credentials', async () => {
    const h = harness();
    for (const body of [
      {},
      { file_url: null },
      { file_url: 42 },
      { file_url: 'not a url' },
      { file_url: `http://${HOST}/a.step` },
      { file_url: 'https://evil.example.test/a.step' },
      { file_url: `https://${HOST}.evil.test/a.step` },
      { file_url: `https://u:p@${HOST}/a.step` },
      { file_url: 'https://169.254.169.254/latest' },
      { file_url: 'file:///tmp/x.step' },
    ]) {
      const res = await handleCadCompat(post(body), env(), call(), h.deps);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ detail: 'file_url host not allowed' });
    }
    expect(h.router.acquires).toEqual([]);
  });

  it('file_name, when present, is a plain name of 1-255 characters', async () => {
    const h = harness();
    for (const name of ['/abs/x.step', '../x.step', 'a/b.step', 'a\\b.step', '.', '..', '', 'a\u0000b', 'a\nb', 'x'.repeat(256), 42, null, ['a']]) {
      const res = await handleCadCompat(post({ file_url: FILE_URL, file_name: name }), env(), call(), h.deps);
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(await res.json()).toEqual({ detail: 'Invalid file_name' });
    }
    for (const ok of ['part.step', 'Bracket v2 (final).STEP', 'ünïcode.stp', '.hidden.step', 'x'.repeat(255)]) expect(isPlainFileName(ok), ok).toBe(true);
    expect(h.router.acquires).toEqual([]);
  });

  it('a body that is not a JSON object answers 400 Invalid JSON body; a body above 4.5 MiB 413', async () => {
    const h = harness();
    for (const raw of ['{', '[]', '"x"', '12', 'null', '']) {
      const res = await handleCadCompat(post(raw), env(), call(), h.deps);
      expect(res.status, raw).toBe(400);
      expect(await res.json()).toEqual({ detail: 'Invalid JSON body' });
    }
    const big = await handleCadCompat(post(JSON.stringify({ file_url: FILE_URL, pad: 'x'.repeat(MAX_COMPAT_BODY_BYTES) })), env(), call(), h.deps);
    expect(big.status).toBe(413);
    expect(h.router.acquires).toEqual([]);
  });
});

describe('the call to the container', () => {
  it('rewrites only file_url (same key order), sends the key, takes an interactive lease and returns the answer unchanged', async () => {
    const answer = JSON.stringify({ success: true, flat_pattern: { width: 180.5, height: 120 }, dxf_base64: 'MCBFT0YK', svg_base64: 'PHN2Zy8+' });
    const h = harness(() => new Response(answer, { status: 200, headers: { 'content-type': 'application/json', 'x-extra': 'dropped' } }));
    const body = { file_url: FILE_URL, file_name: 'part.step', part_info: { material: 'Stainless 1.4301', thickness: 2, nested: { a: [1, 2] } }, debug: false };
    const res = await handleCadCompat(post(body), env(), call(), h.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-extra')).toBeNull();
    expect(await res.text()).toBe(answer);

    expect(h.router.acquires).toEqual([{ job_id: 'compat:9f0c3b1a-0000-4000-8000-000000000001', backend_candidates: ['container'], deadline_s: 110, priority: 'interactive' }]);
    expect(h.container.requests).toHaveLength(1);
    const sent = h.container.requests[0];
    expect(sent.slot).toBe('cad-0');
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(CONTAINER_FLAT_PATTERN_URL);
    expect(sent.url).toBe('http://cad/flat-pattern');
    expect(sent.headers['x-api-key']).toBe(TEST_KEY);
    expect(sent.headers['content-type']).toBe('application/json');
    const forwarded = JSON.parse(sent.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(forwarded)).toEqual(['file_url', 'file_name', 'part_info', 'debug']);
    expect(forwarded.file_url).toMatch(/^http:\/\/cad-input\.internal\/u\/[A-Za-z0-9_-]+$/);
    expect(decodeInputUrl(String(forwarded.file_url))).toBe(FILE_URL);
    expect({ ...forwarded, file_url: FILE_URL }).toEqual(body);
    expect(sent.body).not.toContain(HOST);

    expect(h.router.releases).toEqual([{ id: expect.any(String), o: { ok: true } }]);
    expect((await h.routerEnv.router.snapshot()).leases).toEqual([]);
    expect(h.points).toEqual([expect.objectContaining({ event: 'cad_compat', agent: 'cad', route: 'container', step: 'cad-0', outcome: 'status_200', bytes: answer.length, run_id: 'req-compat-1' })]);
  });

  it('a missing file_name stays missing (the service applies its own default)', async () => {
    const h = harness();
    await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), h.deps);
    expect(Object.keys(JSON.parse(h.container.requests[0].body ?? '{}'))).toEqual(['file_url']);
  });

  it('error answers of the service pass through unchanged; a crash recycles the slot, a key refusal alerts once', async () => {
    const crash = harness(() => serviceJson(500, { detail: 'Processing crashed (exit -11)' }));
    const r1 = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), crash.deps);
    expect(r1.status).toBe(500);
    expect(await r1.text()).toBe('{"detail":"Processing crashed (exit -11)"}');
    expect(crash.router.releases[0].o).toEqual({ ok: false, retryable: true, backend_down: false, recycle: true });
    expect(crash.container.destroyed).toEqual(['cad-0']);

    const timeout = harness(() => serviceJson(504, { detail: 'Processing timeout after 120 s' }));
    const r2 = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), timeout.deps);
    expect(r2.status).toBe(504);
    expect(timeout.router.releases[0].o).toEqual({ ok: false, retryable: false, backend_down: false });

    const refused = harness(() => serviceJson(401, { error: 'Invalid API key' }));
    for (let i = 0; i < 3; i++) expect((await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), refused.deps)).status).toBe(401);
    expect(refused.telegram.texts()).toEqual([CAD_ALERT_TEXTS.key_mismatch('container')]);
    expect(refused.container.destroyed).toEqual(['cad-0', 'cad-0', 'cad-0']);

    const input = harness(() => serviceJson(400, { detail: 'file_url is required' }));
    const r3 = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), input.deps);
    expect(r3.status).toBe(400);
    expect(input.router.releases[0].o).toEqual({ ok: false, retryable: false, backend_down: false });
  });

  it('no free slot for 20 s answers 503 CAD busy (retry every 2 s), never calls the container', async () => {
    const h = harness(undefined, { acquire: async () => ({ granted: false, retry_after_s: 30 }) });
    const res = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), h.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ detail: 'CAD busy' });
    expect(h.sleeps.every((ms) => ms === ACQUIRE_RETRY_MS)).toBe(true);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(ACQUIRE_WAIT_MS);
    expect(h.router.acquires).toHaveLength(ACQUIRE_WAIT_MS / ACQUIRE_RETRY_MS + 1);
    expect(h.container.requests).toEqual([]);
    expect(h.router.releases).toEqual([]);
    expect(h.points.map((p) => p.outcome)).toEqual(['busy']);
  });

  it('a slot that frees within the 20 s is used', async () => {
    let n = 0;
    const h = harness(undefined, { acquire: async () => (++n < 4 ? { granted: false, retry_after_s: 30 } : { granted: true, lease_id: 'l-4', backend: 'container', slot: 'cad-2' }) });
    const res = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), h.deps);
    expect(res.status).toBe(200);
    expect(h.sleeps).toEqual([2000, 2000, 2000]);
    expect(h.container.requests[0].slot).toBe('cad-2');
  });

  it('the 110 s deadline counts from the start of the request: no answer in time -> 502, lease released as down', async () => {
    const h = harness(async (_slot, req) => {
      await new Promise((_r, reject) => req.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError'))));
      return serviceJson(200, {});
    });
    // the lease came after the clock had already moved to 50 ms before the deadline
    const deps: CadCompatDeps = { ...h.deps, now: (() => {
      let first = true;
      return () => {
        if (first) {
          first = false;
          return T0;
        }
        return T0 + COMPAT_DEADLINE_MS - 50;
      };
    })() };
    const started = Date.now();
    const res = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), deps);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: 'CAD unavailable' });
    expect(h.router.releases[0].o).toEqual({ ok: false, retryable: true, backend_down: true });
    expect(logs.join('\n')).toContain('reason=timeout');
  });

  it('a network error of the container answers 502; an unexpected throw too, and the lease is released', async () => {
    const h = harness(() => {
      throw new TypeError('connection lost');
    });
    expect((await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), h.deps)).status).toBe(502);
    expect(h.router.releases[0].o).toEqual({ ok: false, retryable: true, backend_down: true });
    const broken = harness(undefined, { acquire: async () => {
      throw new Error('router down');
    } });
    const res = await handleCadCompat(post({ file_url: FILE_URL }), env(), call(), broken.deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: 'CAD unavailable' });
  });

  it('log lines name the redacted path and never the input URL, its signature, the body or the key', async () => {
    const h = harness();
    await handleCadCompat(post({ file_url: FILE_URL, file_name: 'customer-secret-part.step' }), env(), call(), h.deps);
    await handleCadCompat(post({ file_url: 'https://evil.example.test/x' }), env(), call(), h.deps);
    const all = logs.join('\n');
    expect(all).toContain('path=/api/cad/<redacted>/flat-pattern');
    expect(all).not.toMatch(/files\.example\.test|X-Amz|0123abcd|customer-secret|evil\.example/);
    expect(all).not.toContain(TEST_KEY);
  });
});

describe('through OpsApi.handle and the app', () => {
  it('the route is registered at /api/cad/flat-pattern and reaches the container port of the env (T2 base URL)', async () => {
    const seen: Array<{ url: string; slot: string | null; key: string | null; body: string }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push({ url: req.url, slot: req.headers.get('x-microns-cad-slot'), key: req.headers.get('x-api-key'), body: await req.text() });
      return new Response('{"success":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const e = env({ CAD_CONTAINER: undefined, CAD_CONTAINER_BASE_URL: 'http://cad-stub.test/cad-container' });
    const res = await invoke(OpsApi, call(), { env: e, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file_url: FILE_URL, file_name: 'p.step' }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"success":true}');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: 'http://cad-stub.test/cad-container/flat-pattern', slot: 'cad-0', key: TEST_KEY });
    expect(decodeInputUrl(String((JSON.parse(seen[0].body) as { file_url: string }).file_url))).toBe(FILE_URL);
    // the app's own call log line carries the endpoint and status only
    expect(logs.some((l) => l.startsWith('[microns-ops] api endpoint=cad-compat') && l.includes('status=200'))).toBe(true);
  });
});
