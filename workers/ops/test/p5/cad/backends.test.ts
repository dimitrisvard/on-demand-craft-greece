// Container backend and the Phase 5 outcome mapping of HttpUnfoldBackend (PHASE5_SPEC §5.8): the job runs on the
// container of its lease's slot (http://cad/api/v1/unfold, X-API-Key, the Phase 4 multipart contract), the
// service's own answers map as the table says (504 processing timeout, 500 crash + recycle, 401 key alert, 503 no
// key), and the registry builds the container backend from P5Ports.container only when it is configured.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTAINER_BASE_URL, ContainerBackend } from '../../../src/cad/backends/container';
import { HttpUnfoldBackend, isBackendDown, isCrashOutcome, readAnswerPrefix, serviceAnswerOutcome } from '../../../src/cad/backends/http-unfold';
import { makeCadRegistry, missingContainerConfig } from '../../../src/cad/registry';
import type { OpsEnv } from '../../../src/env';
import { ScriptedContainer } from '../../../src/ports/p5-stub/index';
import { inputOf, job, serviceJson, TEST_KEY } from './helpers';

const STEP = new Uint8Array(readFileSync(new URL('../../fixtures/cad/bracket-sheet.step', import.meta.url)));
const FLAT = new Uint8Array(readFileSync(new URL('../../fixtures/cad/unfold-flat.dxf', import.meta.url)));
const LEASE = { lease_id: 'lease-1', slot: 'cad-1' };

function okUnfold(): Response {
  return new Response(FLAT, {
    status: 200,
    headers: { 'content-type': 'application/dxf', 'x-part-thickness': '2.0', 'x-part-bends': '2', 'x-part-flat-width': '180.0', 'x-part-flat-height': '120.0' },
  });
}

function container(script: (slot: string, req: Request) => Response | Promise<Response>) {
  const port = new ScriptedContainer(script);
  return { port, backend: new ContainerBackend({ port, apiKey: TEST_KEY, maxConcurrency: 3, boundary: 'B0UNDARY' }) };
}

describe('ContainerBackend', () => {
  it('runs the job on the lease slot: POST http://cad/api/v1/unfold with the key and the multipart contract', async () => {
    const { port, backend } = container(() => okUnfold());
    const out = await backend.run(job(), inputOf(STEP, 'bracket.step'), AbortSignal.timeout(5000), LEASE);
    expect(out.ok).toBe(true);
    expect(port.requests).toHaveLength(1);
    const r = port.requests[0];
    expect(r.slot).toBe('cad-1');
    expect(r.method).toBe('POST');
    expect(r.url).toBe(`${CONTAINER_BASE_URL}/api/v1/unfold`);
    expect(r.headers['x-api-key']).toBe(TEST_KEY);
    expect(r.headers['content-type']).toBe('multipart/form-data; boundary=B0UNDARY');
    for (const field of ['material', 'thickness_override', 'k_factor_override', 'output_format', 'drawing_size']) expect(r.body).toContain(`name="${field}"`);
    expect(r.body).toContain('filename="bracket.step"');
    expect(r.body).not.toMatch(/file_url|https?:\/\//);
    if (out.ok) {
      expect(out.result.versions).toMatchObject({ backend: 'container' });
      expect(out.artefacts[0].name).toBe('flat.dxf');
    }
  });

  it('supports what the unfold service supports; unconfigured it supports nothing', () => {
    const { backend } = container(() => okUnfold());
    expect(backend.configured).toBe(true);
    expect(backend.supports('analyse', 'step', 'sheet_metal')).toBe(true);
    expect(backend.supports('drawing_pdf', 'step', 'sheet_metal')).toBe(true);
    expect(backend.supports('analyse', 'dxf', 'sheet_metal')).toBe(false);
    expect(backend.maxConcurrency).toBe(3);
    const none = new ContainerBackend();
    expect(none.configured).toBe(false);
    expect(none.supports('analyse', 'step', 'sheet_metal')).toBe(false);
  });

  it('a lease without a slot fails without a request and without marking the container down', async () => {
    const { port, backend } = container(() => okUnfold());
    for (const lease of [undefined, { lease_id: 'x' }]) {
      const out = await backend.run(job(), inputOf(STEP, 'b.step'), AbortSignal.timeout(5000), lease);
      expect(out).toMatchObject({ ok: false, code: 'backend_error', retryable: true });
      expect(isBackendDown(out)).toBe(false);
    }
    expect(port.requests).toEqual([]);
  });

  it('the vps fetcher receives the lease too and may ignore it; health carries no lease', async () => {
    const seen: Array<{ url: string; lease: unknown }> = [];
    const vps = new HttpUnfoldBackend(
      'vps',
      async (req, lease) => {
        seen.push({ url: req.url, lease });
        return new URL(req.url).pathname === '/api/v1/health' ? Response.json({ status: 'healthy' }) : okUnfold();
      },
      { baseUrl: 'https://cad.example.test', apiKey: TEST_KEY, maxConcurrency: 1 },
    );
    expect(await vps.health(AbortSignal.timeout(5000))).toBe(true);
    expect((await vps.run(job(), inputOf(STEP, 'b.step'), AbortSignal.timeout(5000), { lease_id: 'l-9' })).ok).toBe(true);
    expect(seen).toEqual([
      { url: 'https://cad.example.test/api/v1/health', lease: { lease_id: '' } },
      { url: 'https://cad.example.test/api/v1/unfold', lease: { lease_id: 'l-9' } },
    ]);
  });
});

describe('outcome mapping of the service answers (amends the Phase 4 table)', () => {
  const run = async (answer: () => Response) => {
    const { backend } = container(() => answer());
    return backend.run(job(), inputOf(STEP, 'b.step'), AbortSignal.timeout(5000), LEASE);
  };

  it('504 "Processing timeout …" -> timeout, not retryable, service not down', async () => {
    const out = await run(() => serviceJson(504, { detail: 'Processing timeout after 120 s' }));
    expect(out).toEqual({ ok: false, retryable: false, code: 'timeout', message: 'unfold 504 processing timeout', httpStatus: 504 });
    expect(isBackendDown(out)).toBe(false);
    // any other 504 keeps the Phase 4 rule (retryable, backend down)
    const gateway = await run(() => new Response('upstream timeout', { status: 504 }));
    expect(gateway).toMatchObject({ code: 'backend_error', retryable: true });
    expect(isBackendDown(gateway)).toBe(true);
  });

  it('500 "Processing crashed (exit …)" -> retryable with recycle; other 500s keep the Phase 4 rule', async () => {
    const crash = await run(() => serviceJson(500, { detail: 'Processing crashed (exit -11)' }));
    expect(crash).toEqual({ ok: false, retryable: true, code: 'backend_error', message: 'unfold 500 processing crashed', httpStatus: 500, recycle: true });
    expect(isCrashOutcome(crash)).toBe(true);
    expect(isBackendDown(crash)).toBe(false);
    const other = await run(() => serviceJson(500, { detail: 'Processing error: x' }));
    expect(other).toMatchObject({ code: 'backend_error', retryable: true });
    expect(other).not.toHaveProperty('recycle');
    expect(isCrashOutcome(other)).toBe(false);
  });

  it('401 -> backend_error, not retryable, alert key_mismatch; the container slot is recycled, the vps is not', async () => {
    const out = await run(() => serviceJson(401, { error: 'Invalid API key' }));
    expect(out).toEqual({ ok: false, retryable: false, code: 'backend_error', message: 'unfold 401 key refused', httpStatus: 401, alert: 'key_mismatch', recycle: true });
    expect(serviceAnswerOutcome(401, '', 'vps')).toEqual({ ok: false, retryable: false, code: 'backend_error', message: 'unfold 401 key refused', httpStatus: 401, alert: 'key_mismatch' });
  });

  it('503 "API key not configured" -> unavailable, not retryable, alert, backend down; other 503s keep the Phase 4 rule', async () => {
    const out = await run(() => serviceJson(503, { error: 'API key not configured' }));
    expect(out).toEqual({ ok: false, retryable: false, code: 'unavailable', message: 'unfold 503 key not configured', httpStatus: 503, alert: 'key_not_configured' });
    expect(isBackendDown(out)).toBe(true);
    const busy = await run(() => new Response('There is no Container instance available at this time.', { status: 503 }));
    expect(busy).toMatchObject({ code: 'backend_error', retryable: true, httpStatus: 503 });
    expect(busy).not.toHaveProperty('alert');
  });

  it('no answer before the abort -> timeout, retryable (Phase 4 rule); the answer text never reaches the outcome', async () => {
    const controller = new AbortController();
    const { backend } = container(async (_slot, req) => {
      setTimeout(() => controller.abort(), 5);
      await new Promise((_r, reject) => req.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return okUnfold();
    });
    expect(await backend.run(job(), inputOf(STEP, 'b.step'), controller.signal, LEASE)).toMatchObject({ ok: false, code: 'timeout', retryable: true });
    const leak = await run(() => serviceJson(500, { detail: `Processing crashed (exit 1) /tmp/compat_x/${TEST_KEY}` }));
    expect(JSON.stringify(leak)).not.toContain(TEST_KEY);
  });

  it('reads at most the first 4096 bytes of an error answer; a truncated JSON answer is still recognised', async () => {
    const long = JSON.stringify({ detail: `Processing crashed (exit -9) ${'x'.repeat(20_000)}` });
    expect((await readAnswerPrefix(new Response(long))).length).toBe(4096);
    expect(serviceAnswerOutcome(500, long.slice(0, 4096), 'container')).toMatchObject({ recycle: true });
    expect(serviceAnswerOutcome(504, '{"detail": "Processing timeout after 0.05 s"', 'container')).toMatchObject({ code: 'timeout', retryable: false });
    expect(await readAnswerPrefix(new Response(null, { status: 500 }))).toBe('');
  });
});

describe('registry with the container backend', () => {
  const vps = { CAD_UNFOLD_URL: 'https://cad.example.test', CAD_SHARED_SECRET: TEST_KEY } as OpsEnv;

  it('built from P5Ports.container with the slot count when the binding (or the T2 base URL) and the key are set', async () => {
    const port = new ScriptedContainer(() => okUnfold());
    const binding = { getByName: () => undefined } as unknown as OpsEnv['CAD_CONTAINER'];
    const r = makeCadRegistry({ ...vps, CAD_CONTAINER: binding, CAD_SLOTS: '3', CAD_BACKEND_DEFAULT: 'container' } as OpsEnv, { container: port });
    expect(r.candidates(job(), 'step')).toEqual(['container']);
    expect(r.candidates(job(), 'dxf')).toEqual(['inline']);
    expect(r.candidates(job({ backend: 'container' }), 'step')).toEqual(['container']);
    const c = r.get('container') as ContainerBackend;
    expect(c.configured).toBe(true);
    expect(c.maxConcurrency).toBe(3);
    expect((await c.run(job(), inputOf(STEP, 'b.step'), AbortSignal.timeout(5000), LEASE)).ok).toBe(true);
    expect(port.requests.map((q) => q.slot)).toEqual(['cad-1']);
    // the T2 override counts as the binding
    expect((makeCadRegistry({ ...vps, CAD_CONTAINER_BASE_URL: 'http://127.0.0.1:1/cad-container', CAD_BACKEND_DEFAULT: 'container' } as OpsEnv).get('container') as ContainerBackend).configured).toBe(true);
  });

  it('without the binding or the key the container supports nothing; missingContainerConfig names what is missing', () => {
    const binding = {} as OpsEnv['CAD_CONTAINER'];
    for (const env of [{ ...vps, CAD_BACKEND_DEFAULT: 'container' }, { CAD_CONTAINER: binding, CAD_BACKEND_DEFAULT: 'container' }] as OpsEnv[]) {
      const r = makeCadRegistry(env, { container: new ScriptedContainer() });
      expect(r.candidates(job(), 'step')).toEqual([]);
      expect((r.get('container') as ContainerBackend).configured).toBe(false);
    }
    expect(missingContainerConfig({})).toEqual(['CAD_CONTAINER', 'CAD_SHARED_SECRET']);
    expect(missingContainerConfig({ CAD_CONTAINER: binding })).toEqual(['CAD_SHARED_SECRET']);
    expect(missingContainerConfig({ CAD_CONTAINER_BASE_URL: 'http://x', CAD_SHARED_SECRET: TEST_KEY })).toEqual([]);
  });

  it("CAD_BACKEND_DEFAULT 'vps' keeps the vps first even with the container configured", () => {
    const r = makeCadRegistry({ ...vps, CAD_CONTAINER_BASE_URL: 'http://127.0.0.1:1/cad-container' } as OpsEnv, { fetcher: async () => okUnfold() });
    expect(r.candidates(job(), 'step')).toEqual(['vps']);
  });
});
