// T2 (profile 'jobs', real workerd): the CAD compat path end to end. POST /api/cad/<token>/flat-pattern enters the
// site (resolver, gate CD-1 with the run's random CAD_COMPAT_TOKEN), reaches microns-ops through the OPS binding
// (route /api/cad/flat-pattern), takes an interactive lease from the real CadRouter Durable Object and calls the
// container port, which the generated config points at the stub (CAD_CONTAINER_BASE_URL -> stubs/cad-container.mjs,
// header x-microns-cad-slot). Checks: the container's answer comes back unchanged; the stub saw the key, the slot and
// a body whose file_url is the internal input URL and whose other fields are unchanged; a wrong token and a
// disallowed file_url never reach the container; a crash answer passes through and its slot's container is destroyed;
// four concurrent calls use the three slots and the fourth waits for a free one.
// The outbound handler of the real container (cad-input.internal) is not reachable locally; it is pinned by the T1
// wiring tests against the real @cloudflare/containers package (test/p5/cad/wiring.test.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeInputUrl } from '../../src/cad-container/input-proxy';

const SITE = process.env.T2_SITE_URL ?? '';
const STUB = process.env.T2_STUB_URL ?? '';
const PROFILE = process.env.T2_PROFILE ?? '';
const TOKEN = process.env.T2_CAD_COMPAT_TOKEN ?? '';

type Row = Record<string, unknown>;
interface StubCall {
  method: string;
  path: string;
  slot: string | null;
  api_key: boolean;
  content_type: string | null;
  body: Row | null;
}

const stubHost = (): string => new URL(STUB).host;
const fileUrl = (name: string): string => `https://${stubHost()}/rfq/t2/${name}?X-Amz-Signature=t2sig`;
const compatUrl = (token = TOKEN): string => `${SITE}/api/cad/${token}/flat-pattern`;

async function script(routes: Row[]): Promise<void> {
  const res = await fetch(`${STUB}/__stub/cad-container/script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ routes }) });
  expect(res.status).toBe(204);
}
const calls = async (): Promise<StubCall[]> => (await (await fetch(`${STUB}/__stub/cad-container/calls`)).json()) as StubCall[];
const destroyed = async (): Promise<string[]> => (await (await fetch(`${STUB}/__stub/cad-container/destroyed`)).json()) as string[];
const flatCalls = async (): Promise<StubCall[]> => (await calls()).filter((c) => c.path === '/flat-pattern');

function post(body: unknown, token?: string): Promise<Response> {
  return fetch(compatUrl(token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const ANSWER = { status: 'completed', source: 'cadquery', file_name: 'part.step', flat_pattern: { dimensions: { width: 180.5, height: 120 } }, dxf_base64: 'MCBFT0YK', svg_base64: 'PHN2Zy8+' };

describe.skipIf(!SITE || !STUB || PROFILE !== 'jobs' || !TOKEN)('CAD compat path through the site and ops (T2, profile jobs)', () => {
  let callsBefore = 0;

  beforeAll(async () => {
    await script([]);
  });

  afterAll(async () => {
    await script([]);
  });

  beforeEach(async () => {
    callsBefore = (await flatCalls()).length;
  });

  it('a valid call reaches the container slot with the key and the internal input URL; the answer is unchanged', async () => {
    await script([{ method: 'POST', path: '/flat-pattern', status: 200, body: ANSWER }]);
    const body = { file_url: fileUrl('part.step'), file_name: 'part.step', part_info: { material: 'Aluminium 5754', thickness: 2 } };
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(ANSWER);

    const seen = (await flatCalls()).slice(callsBefore);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', api_key: true, content_type: 'application/json' });
    expect(seen[0].slot).toMatch(/^cad-[0-2]$/);
    const forwarded = seen[0].body as Row;
    expect(Object.keys(forwarded)).toEqual(['file_url', 'file_name', 'part_info']);
    expect(String(forwarded.file_url)).toMatch(/^http:\/\/cad-input\.internal\/u\/[A-Za-z0-9_-]+$/);
    expect(decodeInputUrl(String(forwarded.file_url))).toBe(body.file_url);
    expect(forwarded.file_name).toBe('part.step');
    expect(forwarded.part_info).toEqual(body.part_info);
  });

  it('a wrong token answers 401 at the site and a disallowed input 400 in ops; neither reaches the container', async () => {
    const wrong = await post({ file_url: fileUrl('part.step') }, 'x'.repeat(48));
    expect(wrong.status).toBe(401);
    const other = await post({ file_url: 'https://evil.example.test/part.step' });
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ detail: 'file_url host not allowed' });
    const name = await post({ file_url: fileUrl('part.step'), file_name: '../x.step' });
    expect(name.status).toBe(400);
    expect(await name.json()).toEqual({ detail: 'Invalid file_name' });
    const notFound = await fetch(`${SITE}/api/cad/${TOKEN}/other`, { method: 'POST', body: '{}' });
    expect(notFound.status).toBe(404);
    expect((await flatCalls()).length).toBe(callsBefore);
  });

  it("a crash answer passes through unchanged and the slot's container is destroyed", async () => {
    await script([{ method: 'POST', path: '/flat-pattern', status: 500, body: { detail: 'Processing crashed (exit -11)' } }]);
    const before = await destroyed();
    const res = await post({ file_url: fileUrl('crash.step'), file_name: 'crash.step' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ detail: 'Processing crashed (exit -11)' });
    const slot = (await flatCalls()).slice(callsBefore)[0].slot;
    const after = await until('the slot destroyed', async () => {
      const d = await destroyed();
      return d.length > before.length ? d : null;
    });
    expect(after.slice(before.length)).toEqual([slot]);
  });

  it('four concurrent calls use the three slots; the fourth waits for a free one and succeeds', async () => {
    await script([{ method: 'POST', path: '/flat-pattern', status: 200, body: ANSWER, delay_ms: 3000 }]);
    const started = Date.now();
    const answers = await Promise.all([1, 2, 3, 4].map((n) => post({ file_url: fileUrl(`p${n}.step`), file_name: `p${n}.step` })));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    const seen = (await flatCalls()).slice(callsBefore);
    expect(seen).toHaveLength(4);
    const firstThree = new Set(seen.slice(0, 3).map((c) => c.slot));
    expect([...firstThree].sort()).toEqual(['cad-0', 'cad-1', 'cad-2']);
    // the fourth started only after a slot was released (>= one 3 s answer), well inside the 20 s acquire window
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_000);
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});
