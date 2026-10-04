/// <reference path="./ambient.d.ts" />
// Shim core: runs an unchanged Vercel Node.js Function (req, res) inside a Worker with the helper semantics of
// @vercel/node 17.0.0 (req.query, req.body, res.status/json/send/redirect …), not Express. Both Workers use it:
// microns-site for its local /api handlers, microns-ops (through its Hono adapter) for the others.
// The sitemap shim of microns-site (its src/compat/vercel-shim.ts) is separate and unchanged.
//
// req
//   method, url (= functionUrl: function path + query, rewrite merged), headers (lower-case names, repeated values
//   joined by the Headers object); lazy and settable query (repeated key -> array), body (by Content-Type, below)
//   and cookies; the raw body bytes as req[RAW_BODY] and req.rawBody (a Uint8Array, empty for GET/HEAD).
// req.body by Content-Type (@vercel/node getBodyParser)
//   none -> '' (the body is not read) · application/json -> object, empty -> {}, invalid -> ApiError(400,
//   'Invalid JSON') thrown on every access · text/plain -> string · application/x-www-form-urlencoded ->
//   querystring.parse · application/octet-stream -> Buffer · any other type -> undefined · a malformed
//   Content-Type -> the parser's TypeError on every access. A successful parse is memoised.
// res
//   statusCode, statusMessage, headersSent, writableEnded; setHeader (values stringified, arrays kept, names and
//   values validated as Node does), getHeader, getHeaders, getHeaderNames, hasHeader, removeHeader; status, json,
//   send, redirect (@vercel/node helpers); writeHead, write, end (Node). Chunks are buffered and one Response is
//   built at end(). Content-Length and Transfer-Encoding are left to the runtime; HEAD and null-body statuses
//   (204, 205, 304) carry no body.
// Lifecycle
//   The Response is returned at res.end(); work the handler does after that is handed to ctx.waitUntil and a late
//   rejection is logged. A throw before end(): an error with a numeric statusCode 400-599 (ApiError) answers that
//   status with the message as text/plain; anything else propagates to the caller (which answers 500). No end()
//   within timeoutMs: 504 text/plain "Gateway Timeout".
// Log lines carry the method and the function path only (never the query, a header or a body); e-mail addresses
// in error messages are redacted.

import { Buffer, type BufferEncoding } from 'node:buffer';
import { parse as parseQueryString } from 'node:querystring';
import { format as formatMediaType, parse as parseMediaType } from 'content-type';
import { weakEtag } from './etag';

// Handlers are plain JS (api/*.js); their parameter types are not known to TypeScript.
export type VercelHandler = (req: any, res: any) => unknown;

/** An error with an HTTP status; thrown before res.end() it becomes that status with the message as body. */
export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Largest request body a function accepts (4.5 MiB); a larger one is answered 413 before any handler runs. */
export const MAX_FUNCTION_BODY_BYTES = 4_718_592;

/** Default deadline for one invocation, from the call to res.end(). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** req[RAW_BODY]: the raw request bytes as a Uint8Array (also exposed as req.rawBody). */
export const RAW_BODY: unique symbol = Symbol('microns.rawBody');

export type BodyView = { ok: true; value: unknown } | { ok: false; error: ApiError | Error };

// ---------------------------------------------------------------------------------------------------------------
// Request helpers

function toBuffer(bytes: Uint8Array): Buffer {
  // A copy: the handler's Buffer never aliases the raw bytes.
  return Buffer.from(bytes);
}

function parseBodyValue(contentType: string | null, bytes: Uint8Array): unknown {
  // @vercel/node reads no body when the request has no Content-Type header; an empty header counts as text/plain.
  const body = contentType === null ? Buffer.from('') : toBuffer(bytes);
  const type = contentType ? parseMediaType(contentType).type : 'text/plain';
  if (type === 'application/json') {
    try {
      const str = body.toString();
      return str ? JSON.parse(str) : {};
    } catch {
      throw new ApiError(400, 'Invalid JSON');
    }
  }
  if (type === 'application/octet-stream') return body;
  if (type === 'application/x-www-form-urlencoded') return parseQueryString(body.toString());
  if (type === 'text/plain') return body.toString();
  return undefined;
}

/** Exact @vercel/node getBodyParser semantics for this Content-Type and these bytes, evaluated once. */
export function parseVercelBody(contentType: string | null, bytes: Uint8Array): BodyView {
  try {
    return { ok: true, value: parseBodyValue(contentType, bytes) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Node querystring-style parse over URLSearchParams (a repeated key becomes an array, in order), exactly as
 * @vercel/node's getQueryParser. Accepts a search string ('?a=1', 'a=1', '') or a URL path with its query
 * ('/api/x?a=1', which is parsed as req.url is: through new URL(path, 'http://localhost')).
 */
export function parseQuery(search: string): Record<string, string | string[]> {
  const params = search.startsWith('/') || ABSOLUTE_URL.test(search)
    ? new URL(search, 'http://localhost').searchParams
    : new URLSearchParams(search);
  const query: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    const existing = query[key];
    if (existing !== undefined) {
      query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      query[key] = value;
    }
  });
  return query;
}

// cookie@0.7.0 parse (the version @vercel/node 17.0.0 bundles for req.cookies): first occurrence of a name wins,
// optional double quotes removed, percent-decoding where valid.
function decodeCookie(value: string): string {
  if (value.indexOf('%') === -1) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function startIndex(str: string, index: number, max: number): number {
  do {
    const code = str.charCodeAt(index);
    if (code !== 32 && code !== 9) return index;
  } while (++index < max);
  return max;
}

function endIndex(str: string, index: number, min: number): number {
  while (index > min) {
    const code = str.charCodeAt(--index);
    if (code !== 32 && code !== 9) return index + 1;
  }
  return min;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const obj: Record<string, string> = {};
  if (!header) return obj;
  const len = header.length;
  const max = len - 2;
  if (max < 0) return obj;
  let index = 0;
  do {
    const eqIdx = header.indexOf('=', index);
    if (eqIdx === -1) break;
    let endIdx = header.indexOf(';', index);
    if (endIdx === -1) {
      endIdx = len;
    } else if (eqIdx > endIdx) {
      index = header.lastIndexOf(';', eqIdx - 1) + 1;
      continue;
    }
    const keyStartIdx = startIndex(header, index, eqIdx);
    const keyEndIdx = endIndex(header, eqIdx, keyStartIdx);
    const key = header.slice(keyStartIdx, keyEndIdx);
    if (obj[key] === undefined) {
      let valStartIdx = startIndex(header, eqIdx + 1, endIdx);
      let valEndIdx = endIndex(header, endIdx, valStartIdx);
      if (header.charCodeAt(valStartIdx) === 34 && header.charCodeAt(valEndIdx - 1) === 34) {
        valStartIdx++;
        valEndIdx--;
      }
      obj[key] = decodeCookie(header.slice(valStartIdx, valEndIdx));
    }
    index = endIdx + 1;
  } while (index < max);
  return obj;
}

// @vercel/node setLazyProp: computed on first read, then a plain writable value; a throwing getter is not
// memoised (it throws again on the next read); assignment replaces it.
function setLazyProp(target: object, prop: string, getter: () => unknown): void {
  const opts = { configurable: true, enumerable: true };
  const optsReset = { ...opts, writable: true };
  Object.defineProperty(target, prop, {
    ...opts,
    get: () => {
      const value = getter();
      Object.defineProperty(target, prop, { ...optsReset, value });
      return value;
    },
    set: (value: unknown) => {
      Object.defineProperty(target, prop, { ...optsReset, value });
    },
  });
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // Headers iterates lower-cased names; repeated values are already joined with ', '.
  for (const [name, value] of headers) out[name] = value;
  return out;
}

interface ShimRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: Uint8Array;
  [RAW_BODY]: Uint8Array;
  [key: string]: unknown;
}

function createRequest(init: NodeHandlerInit): ShimRequest {
  const raw = init.body ?? new Uint8Array(0);
  const headers = headersToObject(init.request.headers);
  const contentType = init.request.headers.get('content-type');
  const req: ShimRequest = {
    method: init.request.method,
    url: init.functionUrl,
    headers,
    rawBody: raw,
    [RAW_BODY]: raw,
  };
  setLazyProp(req, 'cookies', () => parseCookies(headers.cookie));
  setLazyProp(req, 'query', () => parseQuery(init.functionUrl));
  setLazyProp(req, 'body', () => {
    const view = parseVercelBody(contentType, raw);
    if (!view.ok) throw view.error;
    return view.value;
  });
  return req;
}

// ---------------------------------------------------------------------------------------------------------------
// Response helpers

type HeaderValue = string | string[];

// Node's header checks (lib/_http_common.js): a name must be an HTTP token; a value may hold HTAB, visible ASCII,
// space and obs-text only.
const TOKEN = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const INVALID_VALUE_CHAR = /[^\t\x20-\x7e\x80-\xff]/;

// Managed by the runtime from the body actually sent (Content-Length is set from it).
const RUNTIME_HEADERS: ReadonlySet<string> = new Set(['content-length', 'transfer-encoding']);

// Statuses whose Response must not carry a body (Fetch spec "null body status").
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

const INVALID_REDIRECT =
  "Invalid redirect arguments. Please use a single argument URL, e.g. res.redirect('/destination') or use a status code and URL, e.g. res.redirect(307, '/destination').";

function validateHeaderName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !TOKEN.test(name)) {
    throw new TypeError(`Header name must be a valid HTTP token ["${String(name)}"]`);
  }
}

function normaliseHeaderValue(name: string, value: unknown): HeaderValue {
  if (value === undefined) throw new TypeError(`Invalid value "undefined" for header "${name}"`);
  const out = Array.isArray(value) ? value.map((item) => String(item)) : String(value);
  for (const item of Array.isArray(out) ? out : [out]) {
    if (INVALID_VALUE_CHAR.test(item)) throw new TypeError(`Invalid character in header content ["${name}"]`);
  }
  return out;
}

function chunkBytes(chunk: string | Uint8Array, encoding: string | undefined): Uint8Array {
  if (typeof chunk === 'string') {
    // Buffer.from rejects an unknown encoding with a TypeError, as Node's res.write/end do.
    return Uint8Array.from(Buffer.from(chunk, (encoding ?? 'utf8') as BufferEncoding));
  }
  // A copy, as if written to the socket at once.
  return Uint8Array.from(chunk);
}

// Node's ERR_INVALID_ARG_TYPE wording for the received value.
function describeReceived(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'function') return `function ${value.name || '<anonymous>'}`;
  if (typeof value === 'object') {
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    return name ? `an instance of ${name}` : 'an object';
  }
  return `type ${typeof value} (${String(value)})`;
}

function assertChunk(chunk: unknown): asserts chunk is string | Uint8Array {
  if (typeof chunk === 'string' || chunk instanceof Uint8Array) return;
  throw new TypeError(`The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ${describeReceived(chunk)}`);
}

function setCharset(type: string, charset: string): string {
  const parsed = parseMediaType(type);
  parsed.parameters.charset = charset;
  return formatMediaType(parsed);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

type Callback = (() => void) | undefined;

export interface ShimResponse {
  statusCode: number;
  statusMessage: string;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly finished: boolean;
  setHeader(name: string, value: unknown): ShimResponse;
  getHeader(name: string): HeaderValue | undefined;
  getHeaders(): Record<string, HeaderValue>;
  getHeaderNames(): string[];
  hasHeader(name: string): boolean;
  removeHeader(name: string): void;
  status(code: number): ShimResponse;
  json(body: unknown): ShimResponse;
  send(body?: unknown): ShimResponse;
  redirect(statusOrUrl: unknown, url?: unknown): ShimResponse;
  writeHead(statusCode: number, statusMessage?: unknown, headers?: unknown): ShimResponse;
  write(chunk: unknown, encoding?: unknown, callback?: unknown): boolean;
  end(chunk?: unknown, encoding?: unknown, callback?: unknown): ShimResponse;
}

interface Collected {
  res: ShimResponse;
  ended: Promise<void>;
  isEnded(): boolean;
  response(): Response;
}

function createResponse(method: string, logPrefix: string): Collected {
  const headers = new Map<string, { name: string; value: HeaderValue }>();
  const chunks: Uint8Array[] = [];
  let headersSent = false;
  let ended = false;
  let built: Response | null = null;
  let resolveEnded: () => void = () => {};
  const endedPromise = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });

  function later(callback: Callback): void {
    if (typeof callback !== 'function') return;
    Promise.resolve().then(callback).catch((err: unknown) => {
      console.error(`${logPrefix} vercel-node: response callback failed`, describeError(err));
    });
  }

  function buildResponse(): Response {
    const out = new Headers();
    for (const [lower, { name, value }] of headers) {
      if (RUNTIME_HEADERS.has(lower)) continue;
      if (Array.isArray(value)) for (const item of value) out.append(name, item);
      else out.set(name, value);
    }
    // Node coerces the status as writeHead does (statusCode |= 0).
    const status = Number(res.statusCode) | 0;
    const noBody = NULL_BODY_STATUSES.has(status) || method === 'HEAD';
    const init: ResponseInit = { status, headers: out };
    if (res.statusMessage) init.statusText = res.statusMessage;
    return new Response(noBody ? null : concat(chunks.length ? chunks : [new Uint8Array(0)]), init);
  }

  const res: ShimResponse = {
    statusCode: 200,
    statusMessage: '',
    get headersSent() {
      return headersSent;
    },
    get writableEnded() {
      return ended;
    },
    get finished() {
      return ended;
    },
    setHeader(name, value) {
      if (headersSent) throw new Error('Cannot set headers after they are sent to the client');
      validateHeaderName(name);
      headers.set(name.toLowerCase(), { name, value: normaliseHeaderValue(name, value) });
      return res;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase())?.value;
    },
    getHeaders() {
      const out: Record<string, HeaderValue> = Object.create(null) as Record<string, HeaderValue>;
      for (const [key, { value }] of headers) out[key] = value;
      return out;
    },
    getHeaderNames() {
      return [...headers.keys()];
    },
    hasHeader(name) {
      return headers.has(String(name).toLowerCase());
    },
    removeHeader(name) {
      if (headersSent) throw new Error('Cannot remove headers after they are sent to the client');
      headers.delete(String(name).toLowerCase());
    },
    status(code) {
      res.statusCode = code;
      return res;
    },

    // @vercel/node json(): JSON.stringify, default type application/json; charset=utf-8, then send().
    json(jsonBody) {
      const body = JSON.stringify(jsonBody);
      if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
      return res.send(body);
    },

    // @vercel/node send() (dev-server.mjs:1020-1086), step by step.
    send(body) {
      let chunk: unknown = body;
      let encoding: 'utf8' | undefined;
      switch (typeof chunk) {
        case 'string':
          if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html');
          break;
        case 'boolean':
        case 'number':
        case 'object':
          if (chunk === null) {
            chunk = '';
          } else if (Buffer.isBuffer(chunk)) {
            if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/octet-stream');
          } else {
            return res.json(chunk);
          }
          break;
      }
      if (typeof chunk === 'string') {
        encoding = 'utf8';
        const type = res.getHeader('content-type');
        if (typeof type === 'string') res.setHeader('content-type', setCharset(type, 'utf-8'));
      }
      let len: number | undefined;
      if (chunk !== undefined) {
        if (Buffer.isBuffer(chunk)) {
          len = chunk.length;
        } else if (typeof chunk === 'string') {
          if (chunk.length < 1000) {
            len = Buffer.byteLength(chunk, encoding);
          } else {
            const buf = Buffer.from(chunk, encoding);
            len = buf.length;
            chunk = buf;
            encoding = undefined;
          }
        } else {
          throw new Error('`body` is not a valid string, object, boolean, number, Stream, or Buffer');
        }
        res.setHeader('content-length', len);
      }
      if (!res.getHeader('etag') && len !== undefined) {
        res.setHeader('etag', weakEtag(chunk as string | Uint8Array));
      }
      if (res.statusCode === 204 || res.statusCode === 304) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Length');
        res.removeHeader('Transfer-Encoding');
        chunk = '';
      }
      if (method === 'HEAD') res.end();
      else if (encoding) res.end(chunk, encoding);
      else res.end(chunk);
      return res;
    },

    // @vercel/node redirect(): default 307, no body; relative URLs are kept as given.
    redirect(statusOrUrl, url) {
      let status = statusOrUrl;
      let location = url;
      if (typeof status === 'string') {
        location = status;
        status = 307;
      }
      if (typeof status !== 'number' || typeof location !== 'string') throw new Error(INVALID_REDIRECT);
      res.writeHead(status, { Location: location }).end();
      return res;
    },

    // Node writeHead(statusCode[, statusMessage][, headers]): headers given here override setHeader values.
    writeHead(statusCode, statusMessage, headerArg) {
      if (headersSent) throw new Error('Cannot write headers after they are sent to the client');
      let given = headerArg;
      if (typeof statusMessage === 'string') res.statusMessage = statusMessage;
      else given = statusMessage;
      const code = Number(statusCode) | 0;
      if (code < 100 || code > 999) throw new RangeError(`Invalid status code: ${String(statusCode)}`);
      res.statusCode = code;
      if (Array.isArray(given)) {
        if (given.length && Array.isArray(given[0])) {
          // [[name, value], …]: each pair is appended.
          for (const [name, value] of given as Array<[unknown, unknown]>) {
            if (!name) continue;
            validateHeaderName(name);
            const normalised = normaliseHeaderValue(name, value);
            const existing = headers.get(name.toLowerCase());
            const merged = existing ? ([] as string[]).concat(existing.value, normalised) : normalised;
            headers.set(name.toLowerCase(), { name: existing?.name ?? name, value: merged });
          }
        } else {
          // [name, value, name, value, …]: each pair is set.
          if (given.length % 2 !== 0) throw new TypeError('The argument \'headers\' is invalid: an even number of names and values is required');
          for (let i = 0; i < given.length; i += 2) {
            if (given[i]) res.setHeader(given[i] as string, given[i + 1]);
          }
        }
      } else if (given && typeof given === 'object') {
        for (const name of Object.keys(given)) {
          if (name) res.setHeader(name, (given as Record<string, unknown>)[name]);
        }
      }
      headersSent = true;
      return res;
    },

    write(chunk, encoding, callback) {
      if (ended) return false;
      if (chunk === null) throw new TypeError('May not write null values to stream');
      assertChunk(chunk);
      const enc = typeof encoding === 'string' ? encoding : undefined;
      chunks.push(chunkBytes(chunk, enc));
      headersSent = true;
      later((typeof encoding === 'function' ? encoding : callback) as Callback);
      return true;
    },

    end(chunk, encoding, callback) {
      let data = chunk;
      let enc = encoding;
      let cb = callback;
      if (typeof data === 'function') {
        cb = data;
        data = undefined;
      } else if (typeof enc === 'function') {
        cb = enc;
        enc = undefined;
      }
      if (ended) {
        later(cb as Callback);
        return res;
      }
      // Node treats a falsy chunk as no chunk.
      if (data) {
        assertChunk(data);
        chunks.push(chunkBytes(data, typeof enc === 'string' ? enc : undefined));
      }
      headersSent = true;
      built = buildResponse();
      ended = true;
      resolveEnded();
      later(cb as Callback);
      return res;
    },
  };

  return {
    res,
    ended: endedPromise,
    isEnded: () => ended,
    response: () => {
      if (!built) throw new Error('vercel-node: response read before res.end()');
      return built;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle

export interface NodeHandlerInit {
  /** Method and headers only; the body is NOT read from it. */
  request: Request;
  /** Becomes req.url: function path + query (rewrite merged). */
  functionUrl: string;
  /** Raw body bytes (null for GET/HEAD); req.body is parsed lazily from these. */
  body: Uint8Array | null;
  /** Work after res.end() is handed to ctx.waitUntil when given. */
  ctx?: { waitUntil(p: Promise<unknown>): void };
  /** Default DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** '[microns-site]' | '[microns-ops]' */
  logPrefix: string;
}

const EMAIL_LIKE = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

/** Error summary for a log line: name, message (e-mail addresses redacted) and stack frames. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return `non-Error value (${typeof err})`;
  const head = `${err.name}: ${err.message}`.replace(EMAIL_LIKE, '<redacted>');
  const frames = (err.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at ')).join('\n');
  return frames ? `${head}\n${frames}` : head;
}

/** A thrown value that answers with its own status: a numeric statusCode 400-599 (ApiError and alike). */
function statusErrorResponse(err: unknown): Response | null {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) return null;
  const message = (err as { message?: unknown }).message;
  return new Response(typeof message === 'string' ? message : '', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function timeoutResponse(): Response {
  return new Response('Gateway Timeout', {
    status: 504,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function functionPathOf(functionUrl: string): string {
  const q = functionUrl.indexOf('?');
  return q === -1 ? functionUrl : functionUrl.slice(0, q);
}

type Outcome = { kind: 'ended' } | { kind: 'returned' } | { kind: 'threw'; error: unknown } | { kind: 'timeout' };

/** Runs a Vercel (req, res) handler and resolves with its Response at res.end(). */
export async function runNodeHandler(handler: VercelHandler, init: NodeHandlerInit): Promise<Response> {
  const method = init.request.method;
  const where = `${method} ${functionPathOf(init.functionUrl)}`;
  const prefix = `${init.logPrefix} vercel-node:`;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const req = createRequest(init);
  const collected = createResponse(method, init.logPrefix);

  // Promise.resolve().then(): a synchronous throw becomes a rejection like an async one.
  const run = Promise.resolve().then(() => handler(req, collected.res));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const ended = collected.ended.then((): Outcome => ({ kind: 'ended' }));
  const settled = run.then(
    (): Outcome => ({ kind: 'returned' }),
    (error: unknown): Outcome => ({ kind: 'threw', error }),
  );

  let propagated: unknown = undefined;
  let afterEnd = false;
  try {
    let outcome = await Promise.race([ended, settled, deadline]);
    // Returned without ending: keep waiting for end() within the same deadline.
    if (outcome.kind === 'returned' && !collected.isEnded()) outcome = await Promise.race([ended, deadline]);
    if (collected.isEnded()) {
      afterEnd = true;
      return collected.response();
    }
    if (outcome.kind === 'threw') {
      propagated = outcome.error;
      const answer = statusErrorResponse(outcome.error);
      if (answer) return answer;
      throw outcome.error;
    }
    console.error(`${prefix} handler did not end the response within ${timeoutMs} ms: ${where}`);
    return timeoutResponse();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The handler may still be running (work after end(), or a hung upstream after the deadline): never let a
    // late rejection become an unhandled one.
    const tail = run.then(
      () => undefined,
      (err: unknown) => {
        if (err !== propagated) console.error(`${prefix} handler failed after the response was settled: ${where}`, describeError(err));
      },
    );
    if (afterEnd && init.ctx) init.ctx.waitUntil(tail);
  }
}
