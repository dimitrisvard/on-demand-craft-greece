// Shim core: one test (or group) per row of the @vercel/node 17.0.0 behaviour table the shim reproduces.
import { Buffer } from 'node:buffer';
import { parse as parseQueryStringOracle } from 'node:querystring';
import etag from 'etag';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  MAX_FUNCTION_BODY_BYTES,
  RAW_BODY,
  describeError,
  parseCookies,
  parseQuery,
  parseVercelBody,
  runNodeHandler,
  type VercelHandler,
} from '../../src/compat/vercel-node';

interface RunOptions {
  method?: string;
  headers?: Record<string, string> | Array<[string, string]>;
  functionUrl?: string;
  body?: string | Uint8Array | null;
  ctx?: { waitUntil(p: Promise<unknown>): void };
  timeoutMs?: number;
}

function run(handler: VercelHandler, o: RunOptions = {}): Promise<Response> {
  const body = typeof o.body === 'string' ? new TextEncoder().encode(o.body) : (o.body ?? null);
  return runNodeHandler(handler, {
    request: new Request('https://site.test/api/public', { method: o.method ?? 'GET', headers: o.headers }),
    functionUrl: o.functionUrl ?? '/api/x',
    body,
    ctx: o.ctx,
    timeoutMs: o.timeoutMs,
    logPrefix: '[test]',
  });
}

/** Runs the handler and returns what it saw as req.body (or the error the getter threw). */
async function bodySeen(contentType: string | null, body: string | Uint8Array): Promise<{ value?: unknown; error?: unknown }> {
  let seen: { value?: unknown; error?: unknown } = {};
  await run(
    (req, res) => {
      try {
        seen = { value: req.body };
      } catch (error) {
        seen = { error };
      }
      res.end();
    },
    { method: 'POST', headers: contentType === null ? {} : { 'content-type': contentType }, body },
  );
  return seen;
}

function bytes(response: Response): Promise<Uint8Array> {
  return response.arrayBuffer().then((buf) => new Uint8Array(buf));
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('vercel-node constants', () => {
  it('caps request bodies at 4.5 MiB (4,718,592 bytes)', () => {
    expect(MAX_FUNCTION_BODY_BYTES).toBe(4.5 * 1024 * 1024);
    expect(MAX_FUNCTION_BODY_BYTES).toBe(4_718_592);
  });

  it('gives one invocation 30 s by default', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('keys the raw body with a symbol', () => {
    expect(typeof RAW_BODY).toBe('symbol');
  });
});

describe('ApiError', () => {
  it('is an Error carrying an HTTP status and the message', () => {
    const err = new ApiError(400, 'Invalid JSON');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid JSON');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('req.query', () => {
  it('holds every key of the function URL, a repeated key as an array in order, decoded as URLSearchParams does', async () => {
    let query: unknown;
    await run((req, res) => {
      query = req.query;
      res.end();
    }, { functionUrl: '/api/marketing?type=open&a=1&a=2&a=3&q=a+b&e=%E2%82%AC&bare&empty=' });
    expect(query).toStrictEqual({ type: 'open', a: ['1', '2', '3'], q: 'a b', e: '€', bare: '', empty: '' });
  });

  it('is parsed on first read only and can be replaced by assignment', async () => {
    let first: unknown;
    let again: unknown;
    let replaced: unknown;
    await run((req, res) => {
      first = req.query;
      again = req.query;
      req.query = { action: 'override' };
      replaced = req.query;
      res.end();
    }, { functionUrl: '/api/x?a=1' });
    expect(again).toBe(first);
    expect(replaced).toStrictEqual({ action: 'override' });
  });

  it('parseQuery gives the same result for a search string, a bare query and a function URL', () => {
    const expected = { a: ['1', '2'], b: 'x y' };
    expect(parseQuery('?a=1&b=x+y&a=2')).toStrictEqual(expected);
    expect(parseQuery('a=1&b=x+y&a=2')).toStrictEqual(expected);
    expect(parseQuery('/api/tenders?a=1&b=x+y&a=2')).toStrictEqual(expected);
    expect(parseQuery('https://site.test/api/tenders?a=1&b=x+y&a=2')).toStrictEqual(expected);
    expect(parseQuery('')).toStrictEqual({});
    expect(parseQuery('/api/tenders')).toStrictEqual({});
  });
});

describe('req.url, req.method, req.headers', () => {
  it('req.url is the function URL (path + query), req.method as received, header names lower-case', async () => {
    let seen: Record<string, unknown> = {};
    await run((req, res) => {
      seen = { url: req.url, method: req.method, headers: { ...req.headers } };
      res.end();
    }, {
      method: 'PATCH',
      functionUrl: '/api/tenders?connectors=true',
      headers: [['X-Custom', 'one'], ['x-custom', 'two'], ['Authorization', 'Bearer t']],
    });
    expect(seen.url).toBe('/api/tenders?connectors=true');
    expect(seen.method).toBe('PATCH');
    expect(seen.headers).toMatchObject({ 'x-custom': 'one, two', authorization: 'Bearer t' });
    expect(seen.headers).not.toHaveProperty('Authorization');
  });

  it('exposes the raw body bytes as req[RAW_BODY] and req.rawBody (empty for a request without a body)', async () => {
    const raw = new Uint8Array([123, 34, 97, 34, 58, 49, 125]);
    let post: unknown[] = [];
    let get: unknown[] = [];
    await run((req, res) => {
      post = [req[RAW_BODY], req.rawBody];
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    await run((req, res) => {
      get = [req[RAW_BODY], req.rawBody];
      res.end();
    });
    expect(post[0]).toBe(raw);
    expect(post[1]).toBe(raw);
    expect(get[0]).toStrictEqual(new Uint8Array(0));
  });

  it('req.cookies parses the Cookie header like cookie@0.7.0 (first name wins, quotes removed, valid escapes decoded)', async () => {
    let cookies: unknown;
    await run((req, res) => {
      cookies = req.cookies;
      res.end();
    }, { headers: { cookie: 'a=1; b="two"; a=3; c=%20x; d=%zz;  e = 5 ; noeq; f=' } });
    expect(cookies).toStrictEqual({ a: '1', b: 'two', c: ' x', d: '%zz', e: '5', f: '' });
    expect(parseCookies(undefined)).toStrictEqual({});
    expect(parseCookies('x')).toStrictEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('req.body by Content-Type', () => {
  it('no Content-Type header: the empty string, whatever the bytes (the body is not read)', async () => {
    expect(await bodySeen(null, '{"a":1}')).toStrictEqual({ value: '' });
  });

  it('an empty Content-Type header counts as text/plain', async () => {
    expect(await bodySeen('', 'plain text')).toStrictEqual({ value: 'plain text' });
  });

  it('application/json: the parsed value; type matching ignores case and parameters', async () => {
    expect(await bodySeen('application/json', '{"action":"contact","n":[1,2]}')).toStrictEqual({ value: { action: 'contact', n: [1, 2] } });
    expect(await bodySeen('Application/JSON; charset=utf-8', '"s"')).toStrictEqual({ value: 's' });
    expect(await bodySeen('application/json', 'null')).toStrictEqual({ value: null });
  });

  it('application/json with an empty body: {}', async () => {
    expect(await bodySeen('application/json', '')).toStrictEqual({ value: {} });
  });

  it('application/json that does not parse: ApiError(400, "Invalid JSON") on every read, never memoised', async () => {
    const thrown: unknown[] = [];
    await run((req, res) => {
      for (let i = 0; i < 2; i++) {
        try {
          void req.body;
        } catch (error) {
          thrown.push(error);
        }
      }
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
    expect(thrown).toHaveLength(2);
    for (const error of thrown) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 400, message: 'Invalid JSON' });
    }
    expect(thrown[0]).not.toBe(thrown[1]);
  });

  it('application/json with a byte order mark is invalid JSON (bytes are decoded without stripping it)', async () => {
    const seen = await bodySeen('application/json', '﻿{"a":1}');
    expect(seen.error).toMatchObject({ statusCode: 400, message: 'Invalid JSON' });
  });

  it('text/plain: the UTF-8 string', async () => {
    expect(await bodySeen('text/plain; charset=utf-8', 'héllo €')).toStrictEqual({ value: 'héllo €' });
  });

  it('application/x-www-form-urlencoded: querystring.parse of the text (null prototype, repeated keys as arrays)', async () => {
    const text = 'a=1&a=2&b=x+y&c=%E2%82%AC&flag';
    const seen = await bodySeen('application/x-www-form-urlencoded', text);
    expect(seen.value).toStrictEqual(parseQueryStringOracle(text));
    expect({ ...(seen.value as object) }).toStrictEqual({ a: ['1', '2'], b: 'x y', c: '€', flag: '' });
    expect(Object.getPrototypeOf(seen.value)).toBeNull();
  });

  it('application/octet-stream: a Buffer copy of the bytes', async () => {
    const raw = new Uint8Array([0, 1, 254, 255]);
    let body: unknown;
    let rawAfter: Uint8Array | undefined;
    await run((req, res) => {
      body = req.body;
      (req.body as Uint8Array)[0] = 99;
      rawAfter = req.rawBody;
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: raw });
    expect(Buffer.isBuffer(body)).toBe(true);
    expect([...(body as Uint8Array)]).toStrictEqual([99, 1, 254, 255]);
    expect([...rawAfter!]).toStrictEqual([0, 1, 254, 255]);
  });

  it('any other type (multipart, XML, …): undefined', async () => {
    expect(await bodySeen('multipart/form-data; boundary=----x', '------x--')).toStrictEqual({ value: undefined });
    expect(await bodySeen('application/xml', '<a/>')).toStrictEqual({ value: undefined });
  });

  it('a malformed Content-Type: the parser TypeError on every read', async () => {
    const thrown: unknown[] = [];
    await run((req, res) => {
      for (let i = 0; i < 2; i++) {
        try {
          void req.body;
        } catch (error) {
          thrown.push(error);
        }
      }
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'json' }, body: '{}' });
    expect(thrown).toHaveLength(2);
    expect(thrown[0]).toBeInstanceOf(TypeError);
    expect(thrown[0]).toMatchObject({ message: 'invalid media type' });
  });

  it('is memoised after a successful read and can be replaced by assignment (also after a failed read)', async () => {
    let same = false;
    let replaced: unknown;
    let afterFailure: unknown;
    await run((req, res) => {
      same = req.body === req.body;
      req.body = { action: 'rfq' };
      replaced = req.body;
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    await run((req, res) => {
      try {
        void req.body;
      } catch {
        req.body = 'set by the handler';
      }
      afterFailure = req.body;
      res.end();
    }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(same).toBe(true);
    expect(replaced).toStrictEqual({ action: 'rfq' });
    expect(afterFailure).toBe('set by the handler');
  });
});

describe('parseVercelBody (the same table, evaluated once)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it.each([
    ['no header', null, '{"a":1}', ''],
    ['empty header', '', 'x', 'x'],
    ['json', 'application/json', '{"a":[1]}', { a: [1] }],
    ['empty json', 'application/json', '', {}],
    ['text', 'text/plain', 'abc', 'abc'],
    ['multipart', 'multipart/form-data; boundary=b', '--b--', undefined],
  ] as Array<[string, string | null, string, unknown]>)('%s', (_name, type, text, expected) => {
    expect(parseVercelBody(type, enc(text))).toStrictEqual({ ok: true, value: expected });
  });

  it('form-urlencoded and octet-stream', () => {
    const form = parseVercelBody('application/x-www-form-urlencoded', enc('a=1&a=2'));
    expect(form.ok && { ...(form.value as object) }).toStrictEqual({ a: ['1', '2'] });
    const octets = parseVercelBody('application/octet-stream', new Uint8Array([7, 8]));
    expect(octets.ok && Buffer.isBuffer(octets.value) && [...octets.value]).toStrictEqual([7, 8]);
  });

  it('invalid JSON and a malformed type are errors, not throws', () => {
    const json = parseVercelBody('application/json', enc('{'));
    expect(json.ok).toBe(false);
    expect(!json.ok && json.error).toBeInstanceOf(ApiError);
    expect(!json.ok && json.error).toMatchObject({ statusCode: 400, message: 'Invalid JSON' });
    const type = parseVercelBody('text/plain;;', enc('x'));
    expect(!type.ok && type.error).toBeInstanceOf(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('res header methods', () => {
  it('status, setHeader (values stringified, arrays kept), getHeader, hasHeader, removeHeader, getHeaders, statusCode', async () => {
    let seen: Record<string, unknown> = {};
    const response = await run((req, res) => {
      seen.initial = res.statusCode;
      seen.chain = res.status(201) === res;
      res.setHeader('X-Number', 5);
      res.setHeader('Set-Cookie', ['a=1', 'b=2']);
      res.setHeader('X-Gone', 'x');
      res.removeHeader('x-gone');
      seen.number = res.getHeader('x-number');
      seen.cookies = res.getHeader('SET-COOKIE');
      seen.has = [res.hasHeader('X-NUMBER'), res.hasHeader('x-gone')];
      seen.all = { ...res.getHeaders() };
      seen.names = res.getHeaderNames();
      seen.flags = [res.headersSent, res.writableEnded];
      res.end('done');
      seen.after = [res.headersSent, res.writableEnded];
    });
    expect(seen).toStrictEqual({
      initial: 200,
      chain: true,
      number: '5',
      cookies: ['a=1', 'b=2'],
      has: [true, false],
      all: { 'x-number': '5', 'set-cookie': ['a=1', 'b=2'] },
      names: ['x-number', 'set-cookie'],
      flags: [false, false],
      after: [true, true],
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-number')).toBe('5');
    expect(response.headers.getSetCookie()).toStrictEqual(['a=1', 'b=2']);
  });

  it('a direct statusCode assignment is used', async () => {
    const response = await run((req, res) => {
      res.statusCode = 404;
      res.end('missing');
    });
    expect(response.status).toBe(404);
  });

  it('rejects headers Node rejects: invalid name, undefined value, control or non-Latin-1 characters', async () => {
    const thrown: string[] = [];
    await run((req, res) => {
      const attempts: Array<() => void> = [
        () => res.setHeader('Bad Name', 'x'),
        () => res.setHeader('X-Undefined', undefined),
        () => res.setHeader('X-Newline', 'a\r\nInjected: 1'),
        () => res.setHeader('Location', 'https://site.test/ü/日本'),
      ];
      for (const attempt of attempts) {
        try {
          attempt();
        } catch (error) {
          thrown.push((error as Error).constructor.name);
        }
      }
      res.setHeader('X-Latin1', 'café');
      res.end();
    });
    expect(thrown).toStrictEqual(['TypeError', 'TypeError', 'TypeError', 'TypeError']);
  });

  it('setHeader and removeHeader throw once the headers are sent', async () => {
    const thrown: string[] = [];
    await run((req, res) => {
      res.end('x');
      for (const attempt of [() => res.setHeader('X-Late', '1'), () => res.removeHeader('X-Late')]) {
        try {
          attempt();
        } catch (error) {
          thrown.push((error as Error).message);
        }
      }
    });
    expect(thrown).toStrictEqual([
      'Cannot set headers after they are sent to the client',
      'Cannot remove headers after they are sent to the client',
    ]);
  });
});

describe('res.json', () => {
  it('JSON.stringify with Content-Type application/json; charset=utf-8 when unset, then send (weak ETag)', async () => {
    const body = { success: true, items: [1, 'two'], text: 'é' };
    const response = await run((req, res) => res.status(200).json(body));
    const text = JSON.stringify(body);
    expect(await response.text()).toBe(text);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('etag')).toBe(etag(text, { weak: true }));
  });

  it('keeps a type set by the handler (re-formatted with charset utf-8)', async () => {
    const response = await run((req, res) => {
      res.setHeader('Content-Type', 'application/problem+json');
      res.status(400).json({ error: 'x' });
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
  });
});

describe('res.send(string)', () => {
  it('defaults the type to text/html; charset=utf-8 and sets a weak ETag of the UTF-8 bytes', async () => {
    const response = await run((req, res) => res.status(200).send('<p>héllo</p>'));
    expect(await response.text()).toBe('<p>héllo</p>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('etag')).toBe(etag('<p>héllo</p>', { weak: true }));
  });

  it('re-formats an existing type with charset=utf-8 (text/csv, a replaced charset, sorted parameters)', async () => {
    const typeAfter = async (type: string) =>
      (await run((req, res) => {
        res.setHeader('Content-Type', type);
        res.send('a,b');
      })).headers.get('content-type');
    expect(await typeAfter('text/csv')).toBe('text/csv; charset=utf-8');
    expect(await typeAfter('text/plain; charset=ISO-8859-1')).toBe('text/plain; charset=utf-8');
    expect(await typeAfter('Text/HTML; Level=1')).toBe('text/html; charset=utf-8; level=1');
  });

  it('keeps an ETag set by the handler; strings of 1,000 characters or more get the same ETag rule', async () => {
    const own = await run((req, res) => {
      res.setHeader('ETag', '"own"');
      res.send('x');
    });
    expect(own.headers.get('etag')).toBe('"own"');
    const long = 'ü'.repeat(1200);
    const big = await run((req, res) => res.send(long));
    expect(big.headers.get('etag')).toBe(etag(long, { weak: true }));
    expect(await big.text()).toBe(long);
  });

  it('204 and 304 drop Content-Type and the body (the ETag stays)', async () => {
    for (const status of [204, 304]) {
      const response = await run((req, res) => res.status(status).send('ignored'));
      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).toBeNull();
      expect(response.headers.get('etag')).toBe(etag('ignored', { weak: true }));
      expect(response.body).toBeNull();
    }
  });

  it('HEAD: same status and headers, no body', async () => {
    const response = await run((req, res) => res.status(200).send('hello'), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('etag')).toBe(etag('hello', { weak: true }));
    expect(response.body).toBeNull();
  });

  it('leaves Content-Length to the runtime', async () => {
    const response = await run((req, res) => res.send('12345'));
    expect(response.headers.has('content-length')).toBe(false);
  });

  it('a malformed type set by the handler makes send throw the parser TypeError', async () => {
    let thrown: unknown;
    await run((req, res) => {
      res.setHeader('Content-Type', 'not a type');
      try {
        res.send('x');
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(thrown).toBeInstanceOf(TypeError);
  });
});

describe('res.send(Buffer | object | number | boolean | null)', () => {
  it('a Buffer: application/octet-stream when unset, bytes unchanged, weak ETag', async () => {
    const pdf = Buffer.from('%PDF-1.7 binary ÿ', 'latin1');
    const response = await run((req, res) => res.status(200).send(pdf));
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect([...(await bytes(response))]).toStrictEqual([...pdf]);
    expect(response.headers.get('etag')).toBe(etag(pdf, { weak: true }));
  });

  it('a Buffer keeps a type set by the handler without a charset (inv-label PDF)', async () => {
    const response = await run((req, res) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="label-x.pdf"');
      res.status(200).send(Buffer.from('%PDF-'));
    });
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toBe('%PDF-');
  });

  it('object, number, boolean: JSON (a Uint8Array that is not a Buffer is an object too)', async () => {
    const cases: Array<[unknown, string]> = [
      [{ a: 1 }, '{"a":1}'],
      [[1, 2], '[1,2]'],
      [5, '5'],
      [true, 'true'],
      [new Uint8Array([1, 2]), '{"0":1,"1":2}'],
    ];
    for (const [value, text] of cases) {
      const response = await run((req, res) => res.send(value));
      expect(await response.text()).toBe(text);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    }
  });

  it('null: an empty body with an ETag and no default type; undefined: an empty body without ETag', async () => {
    const nullBody = await run((req, res) => res.send(null));
    expect(await nullBody.text()).toBe('');
    expect(nullBody.headers.get('content-type')).toBeNull();
    expect(nullBody.headers.get('etag')).toBe(etag('', { weak: true }));
    const noBody = await run((req, res) => res.send());
    expect(await noBody.text()).toBe('');
    expect(noBody.headers.get('etag')).toBeNull();
  });

  it('a function or symbol: the @vercel/node error', async () => {
    let thrown: unknown;
    await run((req, res) => {
      try {
        res.send(() => 1);
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(thrown).toMatchObject({ message: '`body` is not a valid string, object, boolean, number, Stream, or Buffer' });
  });
});

describe('res.end(string | Buffer)', () => {
  it('sends the body as given: no type, charset or ETag added', async () => {
    const pixel = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    const gif = await run((req, res) => {
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.end(pixel);
    });
    expect(gif.headers.get('content-type')).toBe('image/gif');
    expect(gif.headers.get('etag')).toBeNull();
    expect([...(await bytes(gif))]).toStrictEqual([...pixel]);

    const html = await run((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>é</html>');
    });
    expect(html.headers.get('content-type')).toBe('text/html');
    expect(await html.text()).toBe('<html>é</html>');
  });

  it('a string without a type set gets no Content-Type at all', async () => {
    const response = await run((req, res) => res.end('plain'));
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('plain');
  });

  it('honours an encoding, a callback, and treats a falsy chunk as no chunk; other chunk types throw', async () => {
    let called = false;
    const latin1 = await run((req, res) => res.end('é', 'latin1', () => {
      called = true;
    }));
    expect([...(await bytes(latin1))]).toStrictEqual([0xe9]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(called).toBe(true);

    const zero = await run((req, res) => res.end(0));
    expect(await zero.text()).toBe('');

    let thrown: unknown;
    await run((req, res) => {
      try {
        res.end(5);
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).toMatchObject({
      message: 'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received type number (5)',
    });
  });

  it('a second end() is ignored; HEAD carries no body', async () => {
    const twice = await run((req, res) => {
      res.end('first');
      res.end('second');
    });
    expect(await twice.text()).toBe('first');
    const head = await run((req, res) => res.end('body'), { method: 'HEAD' });
    expect(head.body).toBeNull();
  });
});

describe('res.redirect', () => {
  it('one argument: 307 with Location, no body and no Content-Type; relative URLs kept', async () => {
    const response = await run((req, res) => res.redirect('/en/contact?x=1'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en/contact?x=1');
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('status and URL: that status (302 tracking redirect)', async () => {
    const response = await run((req, res) => res.redirect(302, 'https://example.com/landing?utm=a%20b'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/landing?utm=a%20b');
  });

  it('a Location or header value with U+0080-U+00FF characters is accepted and handed to the runtime unchanged', async () => {
    const redirect = await run((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, 'https://x.test/café?n=Müller');
    });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('https://x.test/café?n=Müller');

    const bodyless = await run((req, res) => {
      res.setHeader('X-Name', 'Müller');
      res.end();
    });
    expect(bodyless.headers.get('x-name')).toBe('Müller');
  });

  it('keeps headers set before the redirect', async () => {
    const response = await run((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, '/x');
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('a string first argument is always the URL (a second argument is ignored), as in @vercel/node', async () => {
    const response = await run((req, res) => res.redirect('/first', '/ignored'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/first');
  });

  it('invalid arguments throw the @vercel/node error; a Location Node rejects throws inside the handler', async () => {
    const thrown: unknown[] = [];
    for (const attempt of [
      (res: { redirect(a?: unknown, b?: unknown): unknown }) => res.redirect(302),
      (res: { redirect(a?: unknown, b?: unknown): unknown }) => res.redirect(302, 42),
      (res: { redirect(a?: unknown, b?: unknown): unknown }) => res.redirect(302, 'https://x.test/日本'),
    ]) {
      await run((req, res) => {
        try {
          attempt(res);
        } catch (error) {
          thrown.push(error);
        }
        if (!res.writableEnded) res.end();
      });
    }
    expect(thrown[0]).toMatchObject({ message: expect.stringContaining('Invalid redirect arguments') });
    expect(thrown[1]).toMatchObject({ message: expect.stringContaining('Invalid redirect arguments') });
    expect(thrown[2]).toBeInstanceOf(TypeError);
  });
});

describe('res.writeHead and res.write', () => {
  it('are buffered into one Response at end()', async () => {
    const response = await run((req, res) => {
      res.setHeader('X-Set', 'by-setHeader');
      res.writeHead(201, { 'X-Set': 'by-writeHead', 'Content-Type': 'text/plain' });
      res.write('a');
      res.write(Buffer.from('b'));
      res.end('c');
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-set')).toBe('by-writeHead');
    expect(await response.text()).toBe('abc');
  });

  it('accept a status message and the array header forms; setHeader after writeHead throws', async () => {
    let thrown: unknown;
    const response = await run((req, res) => {
      res.writeHead(202, 'Accepted for later', [['X-A', '1'], ['X-A', '2']]);
      try {
        res.setHeader('X-B', '1');
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(response.status).toBe(202);
    expect(response.statusText).toBe('Accepted for later');
    expect(response.headers.get('x-a')).toBe('1, 2');
    expect(thrown).toMatchObject({ message: 'Cannot set headers after they are sent to the client' });

    const flat = await run((req, res) => res.writeHead(200, ['X-C', '3', 'X-D', '4']).end());
    expect([flat.headers.get('x-c'), flat.headers.get('x-d')]).toStrictEqual(['3', '4']);
  });

  it('an invalid status code throws RangeError', async () => {
    let thrown: unknown;
    await run((req, res) => {
      try {
        res.writeHead(42);
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(thrown).toBeInstanceOf(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('lifecycle', () => {
  it('the Response is returned at end() while the handler keeps running; that work goes to ctx.waitUntil', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let afterEnd = false;
    const waited: Array<Promise<unknown>> = [];
    const response = await run(async (req, res) => {
      res.status(200).json({ success: true });
      await gate;
      afterEnd = true;
    }, { ctx: { waitUntil: (p) => waited.push(p) } });
    expect(response.status).toBe(200);
    expect(afterEnd).toBe(false);
    expect(waited).toHaveLength(1);
    release();
    await waited[0];
    expect(afterEnd).toBe(true);
  });

  it('a rejection after end() is logged (method and function path, e-mail addresses redacted), never thrown', async () => {
    const waited: Array<Promise<unknown>> = [];
    const response = await run(async (req, res) => {
      res.end('ok');
      await Promise.resolve();
      throw new Error('telegram send failed for owner@example.com');
    }, { ctx: { waitUntil: (p) => waited.push(p) }, functionUrl: '/api/notifications?action=inv-consume&token=abc', method: 'POST' });
    expect(await response.text()).toBe('ok');
    await waited[0];
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = errors.mock.calls[0].join(' ');
    expect(logged).toContain('[test] vercel-node: handler failed after the response was settled: POST /api/notifications');
    expect(logged).toContain('<redacted>');
    expect(logged).not.toContain('owner@example.com');
    expect(logged).not.toContain('token=abc');
  });

  it('without ctx, a late rejection is still caught and logged', async () => {
    let fail: (e: Error) => void = () => {};
    const response = await run(async (req, res) => {
      res.end('ok');
      await new Promise<void>((_, reject) => {
        fail = reject;
      });
    });
    expect(response.status).toBe(200);
    fail(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('only a handler that reached end() is handed to ctx.waitUntil; after a timeout or a throw it is not kept alive', async () => {
    const waitUntil = vi.fn();
    const ctx = { waitUntil };

    const hung = await run(() => new Promise(() => {}), { ctx, timeoutMs: 20 });
    expect(hung.status).toBe(504);
    const returnedWithoutEnd = await run(() => undefined, { ctx, timeoutMs: 20 });
    expect(returnedWithoutEnd.status).toBe(504);
    const withStatus = await run(() => {
      throw new ApiError(400, 'Invalid JSON');
    }, { ctx });
    expect(withStatus.status).toBe(400);
    const plain = new Error('boom');
    await expect(run(async () => {
      await Promise.resolve();
      throw plain;
    }, { ctx })).rejects.toBe(plain);
    expect(waitUntil).not.toHaveBeenCalled();

    const ended = await run((req, res) => res.end('ok'), { ctx });
    expect(ended.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

describe('a throw or rejection before end()', () => {
  it('an uncaught ApiError (req.body with invalid JSON) answers its status with the message as text/plain', async () => {
    const response = await run((req, res) => {
      const { action } = req.body as { action?: string };
      res.json({ action });
    }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Invalid JSON');
  });

  it('any error with a numeric statusCode 400-599 does the same; other values propagate', async () => {
    const withStatus = Object.assign(new Error('not allowed'), { statusCode: 403 });
    const forbidden = await run(async () => {
      throw withStatus;
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe('not allowed');

    for (const statusCode of [302, 600, '400', 400.5]) {
      const err = Object.assign(new Error('x'), { statusCode });
      await expect(run(() => {
        throw err;
      })).rejects.toBe(err);
    }
  });

  it('a plain error propagates unchanged, synchronous or asynchronous', async () => {
    const sync = new Error('sync');
    const async = new Error('async');
    await expect(run(() => {
      throw sync;
    })).rejects.toBe(sync);
    await expect(run(async () => {
      await Promise.resolve();
      throw async;
    })).rejects.toBe(async);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('timeout', () => {
  it('no end() within timeoutMs: 504 text/plain "Gateway Timeout", logged without the query', async () => {
    const response = await run(() => new Promise(() => {}), { timeoutMs: 20, functionUrl: '/api/gsc?site=x' });
    expect(response.status).toBe(504);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Gateway Timeout');
    expect(errors.mock.calls[0][0]).toBe('[test] vercel-node: handler did not end the response within 20 ms: GET /api/gsc');
  });

  it('a handler that returns without ending also times out', async () => {
    const response = await run(() => undefined, { timeoutMs: 20 });
    expect(response.status).toBe(504);
  });

  it('a handler that returns first and ends later (timer, callback) is answered by that end() within timeoutMs', async () => {
    const response = await run((req, res) => {
      setTimeout(() => res.status(201).end('late'), 10);
    }, { timeoutMs: 1000 });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('late');
    expect(errors).not.toHaveBeenCalled();
  });

  it('the default deadline is DEFAULT_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const pending = run(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(504);
  });
});

describe('describeError', () => {
  it('keeps the name, message and stack frames, and redacts e-mail addresses', () => {
    const text = describeError(new TypeError('no row for "Jane.Doe+rfq@example.co.uk" (id 7)'));
    expect(text.split('\n')[0]).toBe('TypeError: no row for "<redacted>" (id 7)');
    expect(text).toContain('at ');
    expect(describeError('string')).toBe('non-Error value (string)');
  });
});
