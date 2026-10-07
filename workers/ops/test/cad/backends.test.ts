// CAD backends (D-1): the unfold request (exact multipart field set, X-API-Key, no URL or path input), answer and
// error mapping, the inline parsers on the synthetic fixtures (results within 0.1 mm of the analytic values), the
// per-kind inline caps (no parse above them), the inline mutex, DXF metrics and the registry's candidates.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FakeCadBackend } from '../../src/cad/backends/fake';
import { HttpUnfoldBackend, UNFOLD_FIELDS, isBackendDown, outcomeOfStatus } from '../../src/cad/backends/http-unfold';
import { InlineBackend, withInlineLock } from '../../src/cad/backends/inline';
import { ContainerBackend } from '../../src/cad/backends/container';
import { dxfMetrics } from '../../src/cad/dxf-metrics';
import { parseDXF } from '../../src/cad/inline/dxf-parser';
import { multipartBody } from '../../src/cad/multipart';
import { quietly } from '../../src/cad/quiet';
import { MapCadRegistry, invalidCadConfig, makeCadRegistry, missingCadConfig } from '../../src/cad/registry';
import { INLINE_CAPS, INLINE_TOO_LARGE, MB, cadKindOf, type CadInput, type CadKind, type CadResultV1 } from '../../src/cad/types';
import type { OpsEnv } from '../../src/env';
import type { CadJobMessageV1 } from '../../src/queues/messages';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';

const FIXTURES = new URL('../fixtures/cad/', import.meta.url).pathname;
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(FIXTURES + name));
const expected = (name: string): Record<string, unknown> => JSON.parse(readFileSync(FIXTURES + name, 'utf8')) as Record<string, unknown>;
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function job(over: Partial<CadJobMessageV1> = {}, params: Partial<CadJobMessageV1['params']> = {}): CadJobMessageV1 {
  return {
    v: 1,
    job_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: `${'a'.repeat(64)}:analyse:${'b'.repeat(64)}`,
    job_type: 'analyse',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    rfq_id: '22222222-2222-4222-8222-222222222222',
    rfq_file_id: null,
    quote_workflow_id: null,
    input: { store: 'r2', r2_key: 'rfq/x/bracket.step', sha256: 'a'.repeat(64), content_type: 'application/step', size_bytes: 10, file_name: 'bracket.step' },
    params: { material: 'steel', thickness_override: 0, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal', ...params },
    backend: 'auto',
    deadline_s: 300,
    run_id: '33333333-3333-4333-8333-333333333333',
    ...over,
  };
}

function inputOf(content: Uint8Array, fileName: string, o: { size?: number; open?: () => Promise<ReadableStream | ArrayBuffer> } = {}): CadInput {
  return {
    fileName,
    kind: cadKindOf(fileName),
    contentType: 'application/octet-stream',
    sizeBytes: o.size ?? content.byteLength,
    sha256: 'a'.repeat(64),
    open: o.open ?? (async () => new Response(content).body as ReadableStream),
  };
}

/** Every number of `actual` within 0.1 of `wanted` (null equals null), for the keys of `wanted`. */
function expectClose(actual: unknown, wanted: unknown, path = '$'): void {
  if (wanted === null || typeof wanted !== 'object') {
    if (typeof wanted === 'number') {
      expect(typeof actual, path).toBe('number');
      expect(Math.abs((actual as number) - wanted), `${path}: ${String(actual)} vs ${wanted}`).toBeLessThanOrEqual(0.1);
    } else expect(actual, path).toEqual(wanted);
    return;
  }
  for (const [k, v] of Object.entries(wanted as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;
    expect(actual, path).not.toBeNull();
    expectClose((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  }
}

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

function unfoldFetcher(answer: (req: Request) => Response | Promise<Response>, captured: Captured[] = []) {
  const fetcher = vi.fn(async (req: Request) => {
    const body = req.body ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array(0);
    captured.push({ url: req.url, method: req.method, headers: req.headers, body });
    return answer(req);
  });
  return { fetcher, captured };
}

function okAnswer(): Response {
  const headers = new Headers(JSON.parse(readFileSync(FIXTURES + 'unfold-headers.json', 'utf8')) as Record<string, string>);
  headers.set('content-type', 'application/dxf');
  return new Response(bytes('unfold-flat.dxf'), { status: 200, headers });
}

async function formOf(c: Captured): Promise<FormData> {
  return new Response(c.body, { headers: { 'content-type': c.headers.get('content-type') ?? '' } }).formData();
}

const backend = (fetcher: (req: Request) => Promise<Response>, extra: Record<string, string> = {}) =>
  new HttpUnfoldBackend('vps', fetcher, { baseUrl: 'https://cad.example.test/', apiKey: 't1-cad-key', maxConcurrency: 1, ...extra });

describe('HttpUnfoldBackend request', () => {
  it('posts exactly the six multipart parts with X-API-Key to /api/v1/unfold (never a URL or path input)', async () => {
    const { fetcher, captured } = unfoldFetcher(okAnswer);
    const step = bytes('bracket-sheet.step');
    const out = await backend(fetcher).run(job(), inputOf(step, '../../etc/Bracket (rev 2).step'), AbortSignal.timeout(5000));
    expect(out.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const c = captured[0];
    expect(c.method).toBe('POST');
    expect(new URL(c.url).pathname).toBe('/api/v1/unfold');
    expect(c.headers.get('x-api-key')).toBe('t1-cad-key');
    expect(c.headers.get('cf-access-client-id')).toBeNull();
    const text = new TextDecoder().decode(c.body);
    const names = [...text.matchAll(/Content-Disposition: form-data; name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...UNFOLD_FIELDS, 'file']);
    expect(text).not.toMatch(/file_url|storage_path/);
    const form = await formOf(c);
    expect(form.get('output_format')).toBe('dxf');
    expect(form.get('material')).toBe('steel');
    expect(form.get('drawing_size')).toBe('A3');
    const file = form.get('file') as File;
    expect(file.name).toBe('Bracket__rev_2_.step');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(step);
  });

  it('chooses output_format by job type and stores the matching artefact', async () => {
    for (const [jobType, format, name] of [
      ['drawing_pdf', 'pdf', 'drawing.pdf'],
      ['flat_svg', 'svg', 'flat.svg'],
      ['flat_dxf', 'dxf', 'flat.dxf'],
    ] as const) {
      const { fetcher, captured } = unfoldFetcher(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'X-Part-Thickness': '1.5' } }));
      const out = await backend(fetcher).run(job({ job_type: jobType }, { drawing_size: 'A4', process: 'cnc' }), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000));
      expect((await formOf(captured[0])).get('output_format')).toBe(format);
      expect((await formOf(captured[0])).get('drawing_size')).toBe('A4');
      expect(out.ok && out.artefacts.map((a) => a.name)).toEqual([name]);
    }
  });

  it('sends the Access service-token headers only when both are configured', async () => {
    const { fetcher, captured } = unfoldFetcher(okAnswer);
    await backend(fetcher, { accessClientId: 'id.access', accessClientSecret: 't1-access-value' }).run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000));
    expect(captured[0].headers.get('cf-access-client-id')).toBe('id.access');
    expect(captured[0].headers.get('cf-access-client-secret')).toBe('t1-access-value');
  });

  it('refuses inputs above 50 MB before any request', async () => {
    const { fetcher } = unfoldFetcher(okAnswer);
    const out = await backend(fetcher).run(job(), inputOf(new Uint8Array(1), 'b.step', { size: 50 * MB + 1 }), AbortSignal.timeout(5000));
    expect(out).toMatchObject({ ok: false, code: 'too_large', retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('health calls only GET /api/v1/health with the key', async () => {
    const { fetcher, captured } = unfoldFetcher(() => Response.json({ status: 'healthy' }));
    expect(await backend(fetcher).health(AbortSignal.timeout(5000))).toBe(true);
    expect(new URL(captured[0].url).pathname).toBe('/api/v1/health');
    expect(captured[0].method).toBe('GET');
    expect(captured[0].headers.get('x-api-key')).toBe('t1-cad-key');
    const down = unfoldFetcher(() => Response.json({ status: 'degraded' }));
    expect(await backend(down.fetcher).health(AbortSignal.timeout(5000))).toBe(false);
  });
});

describe('HttpUnfoldBackend answers', () => {
  it('parses the X-Part-* headers and measures the returned flat.dxf', async () => {
    const { fetcher } = unfoldFetcher(okAnswer);
    const out = await backend(fetcher).run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000));
    if (!out.ok) throw new Error(out.message);
    expectClose(out.result, expected('unfold-flat.expected.json'));
    expect(out.result.source).toBe('unfold-service');
    expect(out.result.warnings).toEqual(['synthetic flat pattern']);
    expect(out.artefacts[0].name).toBe('flat.dxf');
    expect(new Uint8Array(out.artefacts[0].body)).toEqual(bytes('unfold-flat.dxf'));
  });

  it('maps statuses: 4xx input errors and configuration errors are final, 408/429/5xx retryable', () => {
    expect(outcomeOfStatus(400)).toMatchObject({ code: 'invalid_input', retryable: false });
    expect(outcomeOfStatus(422)).toMatchObject({ code: 'invalid_input', retryable: false });
    expect(outcomeOfStatus(401)).toMatchObject({ code: 'backend_error', retryable: false });
    expect(outcomeOfStatus(404)).toMatchObject({ code: 'backend_error', retryable: false });
    expect(outcomeOfStatus(408)).toMatchObject({ code: 'unavailable', retryable: true });
    expect(outcomeOfStatus(429)).toMatchObject({ code: 'unavailable', retryable: true });
    expect(outcomeOfStatus(500)).toMatchObject({ code: 'backend_error', retryable: true });
    expect(isBackendDown(outcomeOfStatus(500))).toBe(false);
    expect(isBackendDown(outcomeOfStatus(503))).toBe(true);
  });

  it('maps a network error to unavailable (backend down) and an aborted request to timeout', async () => {
    const network = backend(async () => {
      throw new TypeError('fetch failed');
    });
    const out = await network.run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000));
    expect(out).toMatchObject({ ok: false, code: 'unavailable', retryable: true });
    expect(isBackendDown(out)).toBe(true);
    const controller = new AbortController();
    const slow = backend(async (req) => {
      setTimeout(() => controller.abort(), 5);
      await new Promise((_r, reject) => req.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return okAnswer();
    });
    expect(await slow.run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), controller.signal)).toMatchObject({ ok: false, code: 'timeout', retryable: true });
    // a signal that fired before the request starts: no request at all
    const { fetcher } = unfoldFetcher(okAnswer);
    const fired = new AbortController();
    fired.abort();
    expect(await backend(fetcher).run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), fired.signal)).toMatchObject({ ok: false, code: 'timeout' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never puts the service answer text into the outcome', async () => {
    const { fetcher } = unfoldFetcher(() => new Response('Processing error: /tmp/unfold_x/secret-path', { status: 500 }));
    const out = await backend(fetcher).run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000));
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret-path');
  });
});

describe('multipart body', () => {
  it('is a stream of the declared length and rejects a file shorter than declared', async () => {
    const m = multipartBody([['a', '1']], { name: 'file', fileName: 'x.bin', contentType: 'application/octet-stream', size: 3, body: new Uint8Array([1, 2, 3]) }, 'B');
    const all = new Uint8Array(await new Response(m.body).arrayBuffer());
    expect(all.byteLength).toBe(m.length);
    const short = multipartBody([], { name: 'file', fileName: 'x.bin', contentType: 'application/octet-stream', size: 5, body: new Uint8Array([1]) }, 'B');
    await expect(new Response(short.body).arrayBuffer()).rejects.toThrow();
    expect(() => multipartBody([['a"', '1']], { name: 'file', fileName: 'x', contentType: 'x/y', size: 0, body: new Uint8Array(0) })).toThrow(/quote/);
  });
});

describe('InlineBackend', () => {
  const inline = new InlineBackend();
  const cases: Array<[string, Partial<CadJobMessageV1['params']>, string]> = [
    ['plate-holes.dxf', { process: 'sheet_metal' }, 'plate-holes.expected.json'],
    ['cube-10x20x30.stl', { process: 'cnc' }, 'cube-10x20x30.expected.json'],
    ['block-cnc.step', { process: 'cnc' }, 'block-cnc.expected.json'],
  ];
  for (const [file, params, want] of cases) {
    it(`analyses ${file} within 0.1 mm of the analytic values`, async () => {
      const out = await inline.run(job({}, params), inputOf(bytes(file), file), AbortSignal.timeout(5000));
      if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
      expectClose(out.result, expected(want));
      expect(out.result.source).toBe('inline-ts');
      expect(out.artefacts).toEqual([]);
    });
  }

  it('supports DXF, STL and CNC STEP analysis only (STEP sheet metal is the unfold service)', () => {
    expect(inline.supports('analyse', 'dxf', 'sheet_metal')).toBe(true);
    expect(inline.supports('analyse', 'stl', 'other')).toBe(true);
    expect(inline.supports('analyse', 'step', 'cnc')).toBe(true);
    expect(inline.supports('analyse', 'step', 'sheet_metal')).toBe(false);
    expect(inline.supports('analyse', 'step', 'mixed')).toBe(false);
    expect(inline.supports('drawing_pdf', 'dxf', 'sheet_metal')).toBe(false);
    expect(inline.supports('analyse', 'other', 'cnc')).toBe(false);
  });

  it('refuses inputs above the per-kind caps without reading them (inline_too_large)', async () => {
    const caps: Array<[CadKind, string, number]> = [
      ['step', 'big.step', INLINE_CAPS.step + 1],
      ['dxf', 'big.dxf', INLINE_CAPS.dxf + 1],
      ['stl', 'big.stl', INLINE_CAPS.stl + 1],
    ];
    expect(INLINE_CAPS).toEqual({ step: 5 * MB, dxf: 3 * MB, stl: 0.75 * MB });
    for (const [kind, name, size] of caps) {
      const open = vi.fn(async () => new ArrayBuffer(0));
      const out = await inline.run(job({}, { process: 'cnc' }), { ...inputOf(new Uint8Array(0), name, { size, open }), kind }, AbortSignal.timeout(5000));
      expect(out).toEqual({ ok: false, retryable: false, code: 'too_large', message: INLINE_TOO_LARGE });
      expect(open).not.toHaveBeenCalled();
    }
  });

  it('the parsers write nothing to the logs: inline DXF, STL and STEP, and the DXF metrics of an unfold answer', async () => {
    // a DXF whose layer names carry customer text (the copied parser prints layer names)
    const layer = 'Kunde erika.beispiel@example.de';
    const dxf = new TextEncoder().encode(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', layer, '10', '0', '20', '0', '11', '100', '21', '0', '0', 'LINE', '8', 'OUTLINE', '10', '100', '20', '0', '11', '100', '21', '50', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));
    const logger = new RecordingLogger();
    const stop = logger.start();
    const outs: Array<{ ok: boolean }> = [];
    try {
      outs.push(await inline.run(job({}, { process: 'sheet_metal' }), inputOf(dxf, 'part.dxf'), AbortSignal.timeout(5000)));
      outs.push(await inline.run(job({}, { process: 'cnc' }), inputOf(bytes('cube-10x20x30.stl'), 'cube.stl'), AbortSignal.timeout(5000)));
      outs.push(await inline.run(job({}, { process: 'cnc' }), inputOf(bytes('block-cnc.step'), 'block.step'), AbortSignal.timeout(5000)));
      const { fetcher } = unfoldFetcher(() => new Response(dxf, { status: 200, headers: { 'content-type': 'application/dxf', 'X-Part-Thickness': '2' } }));
      outs.push(await backend(fetcher).run(job(), inputOf(bytes('bracket-sheet.step'), 'b.step'), AbortSignal.timeout(5000)));
    } finally {
      stop();
    }
    expect(outs.map((o) => o.ok)).toEqual([true, true, true, true]);
    expect(logger.lines).toEqual([]);
    assertNoSecretsLogged(logger.lines, [layer]);
  });

  it('quietly() restores the console after the call, also when it throws', () => {
    const before = [console.log, console.info, console.debug, console.warn, console.error];
    let inside: unknown[] = [];
    expect(
      quietly(() => {
        inside = [console.log, console.info, console.debug, console.warn, console.error];
        return 7;
      }),
    ).toBe(7);
    expect(inside.slice(0, 4).every((f, i) => f !== before[i])).toBe(true);
    expect(inside[4]).toBe(console.error);
    expect(() =>
      quietly(() => {
        throw new Error('parse failed');
      }),
    ).toThrow('parse failed');
    expect([console.log, console.info, console.debug, console.warn, console.error]).toEqual(before);
  });

  it('a corrupt file is invalid_input (not retried)', async () => {
    const out = await inline.run(job({}, { process: 'cnc' }), inputOf(new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n'), 'empty.dxf'), AbortSignal.timeout(5000));
    expect(out).toMatchObject({ ok: false, code: 'invalid_input', retryable: false });
  });

  it('never parses two inputs at once in one isolate (module mutex)', async () => {
    let active = 0;
    let maxActive = 0;
    const slowOpen = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return ab(bytes('plate-holes.dxf'));
    };
    const runs = [1, 2, 3].map(() => inline.run(job({}, { process: 'sheet_metal' }), inputOf(bytes('plate-holes.dxf'), 'p.dxf', { open: slowOpen }), AbortSignal.timeout(5000)));
    const outs = await Promise.all(runs);
    expect(outs.every((o) => o.ok)).toBe(true);
    expect(maxActive).toBe(1);
    // the lock is released after a failure too
    await expect(withInlineLock(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await withInlineLock(async () => 'next')).toBe('next');
  });
});

describe('DXF metrics', () => {
  it('outline only: cut length, loops, pierces and net area', () => {
    const m = dxfMetrics(parseDXF(ab(bytes('plate-holes.dxf'))));
    expect(m.closed_loops).toBe(3);
    expect(m.pierces).toBe(2);
    expect(m.open_components).toBe(0);
    expect(m.bend_lines).toBe(1);
  });

  it('an open outline has no area and no pierce count', () => {
    const m = dxfMetrics(parseDXF(ab(bytes('open-outline.dxf'))));
    expect(m.area_mm2).toBeNull();
    expect(m.pierces).toBeNull();
    expect(m.open_components).toBe(1);
    expect(m.cut_length_mm).toBeCloseTo(250, 3);
  });
});

describe('registry', () => {
  const configured = { CAD_UNFOLD_URL: 'https://cad.example.test', CAD_SHARED_SECRET: 't1-cad-key' } as OpsEnv;

  it('auto: STEP sheet metal -> vps; DXF, STL and CNC STEP -> inline; other kinds -> none', () => {
    const r = makeCadRegistry(configured, { fetcher: async () => okAnswer() });
    expect(r.candidates(job(), 'step')).toEqual(['vps']);
    expect(r.candidates(job({}, { process: 'mixed' }), 'step')).toEqual(['vps']);
    expect(r.candidates(job({}, { process: 'cnc' }), 'step')).toEqual(['inline']);
    expect(r.candidates(job(), 'dxf')).toEqual(['inline']);
    expect(r.candidates(job({}, { process: 'cnc' }), 'stl')).toEqual(['inline']);
    expect(r.candidates(job(), 'other')).toEqual([]);
    expect(r.candidates(job({ job_type: 'drawing_pdf' }), 'step')).toEqual(['vps']);
  });

  it('honours an explicit backend only when it supports the job', () => {
    const r = makeCadRegistry(configured);
    expect(r.candidates(job({ backend: 'vps' }), 'step')).toEqual(['vps']);
    expect(r.candidates(job({ backend: 'inline' }), 'step')).toEqual([]);
    expect(r.candidates(job({ backend: 'container' }), 'step')).toEqual([]);
  });

  it('without the CAD secrets there is no vps backend (CAD jobs fail, the Worker does not)', () => {
    const r = makeCadRegistry({} as OpsEnv);
    expect(r.get('vps')).toBeUndefined();
    expect(r.candidates(job(), 'step')).toEqual([]);
    expect(r.candidates(job(), 'dxf')).toEqual(['inline']);
    expect(missingCadConfig({})).toEqual(['CAD_UNFOLD_URL', 'CAD_SHARED_SECRET']);
  });

  it('the vps backend is built only for an https: unfold URL; http: only in generated test configs (AGENT_STUBS)', async () => {
    const { fetcher, captured } = unfoldFetcher(() => Response.json({ status: 'healthy' }));
    const plain = { CAD_UNFOLD_URL: 'http://cad.example.test', CAD_SHARED_SECRET: 't1-cad-key' } as OpsEnv;
    const r = makeCadRegistry(plain, { fetcher });
    expect(r.get('vps')).toBeUndefined();
    expect(r.candidates(job(), 'step')).toEqual([]);
    expect(r.candidates(job(), 'dxf')).toEqual(['inline']);
    expect(missingCadConfig(plain)).toEqual([]);
    expect(invalidCadConfig(plain)).toEqual(['CAD_UNFOLD_URL']);
    for (const value of ['ftp://cad.example.test', 'cad.example.test', 'not a url']) expect(invalidCadConfig({ CAD_UNFOLD_URL: value }), value).toEqual(['CAD_UNFOLD_URL']);
    expect(invalidCadConfig(configured)).toEqual([]);
    expect(invalidCadConfig({})).toEqual([]);
    expect(captured).toEqual([]);

    // the generated T2 config points the URL at the local http stub
    const stubbed = { CAD_UNFOLD_URL: 'http://127.0.0.1:8790', CAD_SHARED_SECRET: 't1-cad-key', AGENT_STUBS: 'llm,embed,vector,browser' } as OpsEnv;
    expect(invalidCadConfig(stubbed)).toEqual([]);
    const vps = makeCadRegistry(stubbed, { fetcher }).get('vps');
    expect(vps).toBeInstanceOf(HttpUnfoldBackend);
    expect(await vps?.health(AbortSignal.timeout(5000))).toBe(true);
    expect(captured.map((c) => c.url)).toEqual(['http://127.0.0.1:8790/api/v1/health']);
  });

  it('the container slot supports nothing until Phase 5', async () => {
    const c = new ContainerBackend();
    expect(c.supports('analyse', 'step', 'sheet_metal')).toBe(false);
    expect(await c.run(job(), inputOf(new Uint8Array(0), 'x.step'), AbortSignal.timeout(1000))).toMatchObject({ ok: false, code: 'unsupported' });
    const r = makeCadRegistry({ ...configured, CAD_BACKEND_DEFAULT: 'container' } as OpsEnv);
    expect(r.candidates(job(), 'step')).toEqual([]);
    expect(r.candidates(job(), 'dxf')).toEqual(['inline']);
  });

  it("AGENT_STUBS 'cad' selects the fake backend", async () => {
    const r = makeCadRegistry({ AGENT_STUBS: 'llm,cad' } as OpsEnv);
    expect(r.get('vps')).toBeInstanceOf(FakeCadBackend);
    const out = await (r.get('vps') as FakeCadBackend).run(job(), inputOf(new Uint8Array(0), 'x.step'));
    expect(out.ok && (out.result as CadResultV1).warnings).toEqual(['fake_cad_backend']);
  });

  it('MapCadRegistry orders the default first, then inline', () => {
    const r = new MapCadRegistry([new FakeCadBackend('inline'), new FakeCadBackend('vps')], 'vps');
    expect(r.candidates(job(), 'dxf')).toEqual(['vps', 'inline']);
  });
});
