// Input proxy of the CAD Container (src/cad-container/input-proxy.ts): the URL codec, the exact-host allow-list
// (also against the hosts the Phase 2 presign functions produce, which CAD_INPUT_HOSTS lists in production) and the
// outbound handler (https only, GET/HEAD only, at most 3 redirects re-checked per hop, 403 otherwise, headers of
// the container request never forwarded, only status, content-type and content-length passed back).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyTarget, presignGet, r2Target } from '../../../../shared/src/storage/s3-presign';
import {
  decodeInputUrl,
  encodeInputUrl,
  fetchCompatInput,
  INPUT_FETCH_TIMEOUT_MS,
  INPUT_HOST,
  inputHostList,
  isAllowedInputHost,
  isAllowedInputUrl,
  MAX_INPUT_REDIRECTS,
} from '../../../src/cad-container/input-proxy';
import type { OpsEnv } from '../../../src/env';

const HOSTS = 'files.example.test, other.example.test:8443';
const env = (hosts = HOSTS) => ({ CAD_INPUT_HOSTS: hosts }) as OpsEnv;
// Test credentials built at runtime (never real values).
const ACCESS_ID = ['T1', 'ACCESS', 'ID'].join('');
const SECRET = ['t1', 'secret', 'value'].join('-');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('URL codec', () => {
  it('round-trips any URL through http://cad-input.internal/u/<base64url>', () => {
    for (const original of [
      'https://files.example.test/a.step',
      'https://files.example.test/rfq/%C3%BC%20x.step?X-Amz-Signature=abc&X-Amz-Date=20261008T090000Z',
      'https://files.example.test/' + 'x'.repeat(3000),
      'https://files.example.test/ünïcode.step',
    ]) {
      const encoded = encodeInputUrl(original);
      expect(encoded.startsWith(`http://${INPUT_HOST}/u/`)).toBe(true);
      expect(encoded.slice(`http://${INPUT_HOST}/u/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeInputUrl(encoded)).toBe(original);
      expect(decodeInputUrl(new URL(encoded))).toBe(original);
    }
  });

  it('decodes nothing but the exact internal form', () => {
    const good = encodeInputUrl('https://files.example.test/a.step');
    const segment = good.slice(`http://${INPUT_HOST}/u/`.length);
    for (const bad of [
      `https://${INPUT_HOST}/u/${segment}`,
      `http://${INPUT_HOST}:8080/u/${segment}`,
      `http://other.internal/u/${segment}`,
      `http://${INPUT_HOST}/v/${segment}`,
      `http://${INPUT_HOST}/u/`,
      `http://${INPUT_HOST}/u/${segment}?x=1`,
      `http://${INPUT_HOST}/u/${segment}#f`,
      `http://${INPUT_HOST}/u/${segment}+/`,
      `http://${INPUT_HOST}/u/a`,
      `http://${INPUT_HOST}/u/${'A'.repeat(9000)}`,
      `http://${INPUT_HOST}/u/__8`,
      'not a url',
    ]) {
      expect(decodeInputUrl(bad), bad).toBeNull();
    }
  });
});

describe('allow-list', () => {
  it('matches the exact host[:port], case-insensitive, nothing else', () => {
    expect(inputHostList(' A.example.test ,, b.example.test:8443 ')).toEqual(['a.example.test', 'b.example.test:8443']);
    expect(isAllowedInputHost(new URL('https://files.example.test/x'), HOSTS)).toBe(true);
    expect(isAllowedInputHost(new URL('https://FILES.example.test/x'), HOSTS)).toBe(true);
    expect(isAllowedInputHost(new URL('https://other.example.test:8443/x'), HOSTS)).toBe(true);
    for (const bad of [
      'https://other.example.test/x',
      'https://files.example.test:444/x',
      'https://sub.files.example.test/x',
      'https://files.example.test.evil.test/x',
      'https://evilfiles.example.test/x',
      'https://files.example.test./x',
      'https://example.test/x',
    ]) {
      expect(isAllowedInputHost(new URL(bad), HOSTS), bad).toBe(false);
    }
    expect(isAllowedInputHost(new URL('https://files.example.test/x'), '')).toBe(false);
  });

  it('a usable input is https:, without credentials, on the list', () => {
    expect(isAllowedInputUrl(new URL('https://files.example.test/x'), HOSTS)).toBe(true);
    expect(isAllowedInputUrl(new URL('http://files.example.test/x'), HOSTS)).toBe(false);
    expect(isAllowedInputUrl(new URL('https://u:p@files.example.test/x'), HOSTS)).toBe(false);
    expect(isAllowedInputUrl(new URL('https://u@files.example.test/x'), HOSTS)).toBe(false);
    expect(isAllowedInputUrl(new URL('ftp://files.example.test/x'), HOSTS)).toBe(false);
    expect(isAllowedInputUrl(new URL('https://files.example.test/x'), undefined)).toBe(false);
  });

  it('accepts the presign hosts of the Phase 2 storage targets (R2 eu jurisdiction and the legacy RFQ bucket)', async () => {
    const r2 = r2Target('0123456789abcdef0123456789abcdef', 'eu', 'microns-private', ACCESS_ID, SECRET);
    const legacy = legacyTarget('microns-rfq-files', 'eu-north-1', ACCESS_ID, SECRET);
    const urls = [await presignGet(r2, 'rfq/x/part.step', 600), await presignGet(legacy, 'rfq/x/part.step', 600)];
    const hosts = urls.map((u) => new URL(u).host).join(',');
    expect(hosts).toBe('0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com,microns-rfq-files.s3.eu-north-1.amazonaws.com');
    for (const u of urls) expect(isAllowedInputUrl(new URL(u), hosts), u).toBe(true);
    // the same bucket outside the eu jurisdiction is a different host and is refused
    const plain = await presignGet(r2Target('0123456789abcdef0123456789abcdef', '', 'microns-private', ACCESS_ID, SECRET), 'k', 600);
    expect(isAllowedInputUrl(new URL(plain), hosts)).toBe(false);
  });
});

describe('fetchCompatInput', () => {
  function upstream(script: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return script(String(input), init);
    });
    return calls;
  }
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('streams an allowed input back with status, content-type and content-length only', async () => {
    quiet();
    const calls = upstream(() => new Response('STEPDATA', { status: 200, headers: { 'content-type': 'application/step', 'content-length': '8', 'set-cookie': 'a=b', 'x-amz-request-id': 'r1' } }));
    const original = 'https://files.example.test/rfq/a.step?X-Amz-Signature=abc';
    const res = await fetchCompatInput(new Request(encodeInputUrl(original), { headers: { 'x-api-key': 'never-forwarded', 'user-agent': 'python-httpx' } }), env(), {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('STEPDATA');
    expect([...res.headers.keys()].sort()).toEqual(['content-length', 'content-type']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(original);
    expect(calls[0].init?.redirect).toBe('manual');
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('passes an upstream error status through (the service reports it)', async () => {
    quiet();
    upstream(() => new Response('<Error>NoSuchKey</Error>', { status: 404, headers: { 'content-type': 'application/xml' } }));
    const res = await fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/missing.step')), env(), {});
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/xml');
  });

  it('refuses with 403 and no upstream request: other host, http:, credentials, bad encoding, other methods', async () => {
    quiet();
    const calls = upstream(() => new Response('x'));
    const cases: Request[] = [
      new Request(encodeInputUrl('https://evil.example.test/a.step')),
      new Request(encodeInputUrl('http://files.example.test/a.step')),
      new Request(encodeInputUrl('https://u:p@files.example.test/a.step')),
      new Request(encodeInputUrl('https://169.254.169.254/latest/meta-data')),
      new Request(encodeInputUrl('not a url at all')),
      new Request(`http://${INPUT_HOST}/u/%%%`),
      new Request(`http://${INPUT_HOST}/other`),
      new Request(encodeInputUrl('https://files.example.test/a.step'), { method: 'POST', body: 'x' }),
      new Request(encodeInputUrl('https://files.example.test/a.step'), { method: 'PUT', body: 'x' }),
    ];
    for (const req of cases) expect((await fetchCompatInput(req, env(), {})).status, req.url).toBe(403);
    expect((await fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/a.step')), env(''), {})).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('follows up to 3 redirects whose targets are allowed; a fourth answers 403', async () => {
    quiet();
    let n = 0;
    const calls = upstream((url) => {
      n++;
      if (url.endsWith('/final.step')) return new Response('OK', { status: 200 });
      return new Response(null, { status: 302, headers: { location: `/hop${n}${n >= 3 ? '/final.step' : ''}` } });
    });
    const ok = await fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/start')), env(), {});
    expect(ok.status).toBe(200);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/start', '/hop1', '/hop2', '/hop3/final.step']);
    expect(calls.length - 1).toBe(MAX_INPUT_REDIRECTS);

    const loop = upstream(() => new Response(null, { status: 307, headers: { location: 'https://files.example.test/again' } }));
    const refused = await fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/start')), env(), {});
    expect(refused.status).toBe(403);
    expect(loop).toHaveLength(MAX_INPUT_REDIRECTS + 1);
  });

  it('re-checks every redirect hop: a disallowed or http: target answers 403 and is never fetched', async () => {
    quiet();
    for (const location of ['https://evil.example.test/x', 'http://files.example.test/x', 'https://u:p@files.example.test/x', '//evil.example.test/x']) {
      const calls = upstream(() => new Response(null, { status: 301, headers: { location } }));
      const res = await fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/a')), env(), {});
      expect(res.status, location).toBe(403);
      expect(calls, location).toHaveLength(1);
    }
  });

  it('one 100 s timeout bounds the whole input fetch, redirects included; an upstream that never answers is aborted with 502', async () => {
    expect(INPUT_FETCH_TIMEOUT_MS).toBe(100_000);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: unknown) => void lines.push(String(l)));
    const controller = new AbortController();
    const timeouts = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => controller.signal);
    let hop = 0;
    const calls = upstream((_url, init) => {
      // without a signal the stand-in answers at once, so a missing bound shows as a 200 instead of a hang
      if (!init?.signal) return new Response('unbounded', { status: 200 });
      if (hop++ === 0) return new Response(null, { status: 302, headers: { location: '/slow.step' } });
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
      });
    });
    const pending = fetchCompatInput(new Request(encodeInputUrl('https://files.example.test/start.step')), env(), {});
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    const res = await pending;
    expect(res.status).toBe(502);
    expect(timeouts).toHaveBeenCalledTimes(1);
    expect(timeouts).toHaveBeenCalledWith(100_000);
    expect(calls.map((c) => c.init?.signal)).toEqual([controller.signal, controller.signal]);
    expect(lines.join('\n')).toContain('error=TimeoutError');
  });

  it('a network error answers 502; log lines carry the host and status only, never the URL or its signature', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: unknown) => void lines.push(String(l)));
    upstream(() => {
      throw new TypeError('fetch failed');
    });
    const original = 'https://files.example.test/rfq/secret-name.step?X-Amz-Signature=deadbeef';
    expect((await fetchCompatInput(new Request(encodeInputUrl(original)), env(), {})).status).toBe(502);
    upstream(() => new Response('ok'));
    expect((await fetchCompatInput(new Request(encodeInputUrl(original)), env(), {})).status).toBe(200);
    expect(lines.join('\n')).not.toMatch(/secret-name|deadbeef|X-Amz/);
    expect(lines.every((l) => l.startsWith('[microns-cad] '))).toBe(true);
  });
});
