// Minimal Vercel Node.js Function (req, res) shim, so files in api/ run unchanged inside the Worker
// (PLAN.md P1-6 now; grows into the Express-style shim of P2-2 for the other api/* handlers).
//
// Implemented today, only what api/sitemap.js uses:
//   req: method, url (path + query, as Vercel passes the rewritten destination), query (parsed), headers
//        (lowercased names, as Node's IncomingMessage).
//   res: statusCode, setHeader / getHeader / hasHeader / removeHeader / getHeaders, status(code), send(string |
//        bytes | null), end([string | bytes | null]).
// Not implemented yet (P2-2): req.body / req.cookies parsing, res.json, res.redirect, res.write streaming,
// res.writeHead, events, and @vercel/node's send(object | number | boolean) JSON branch. A handler that touches
// them fails loudly: a missing method is a TypeError on call, and send() / end() throw a TypeError for any other
// payload type instead of emitting "[object Object]".
//
// Lifecycle (as @vercel/node, where the response is flushed on res.end()):
//   - the Response is returned as soon as the handler ends it, even if the handler's promise is still pending;
//     work after end() and a later rejection are only logged (not awaited, not propagated). Vercel does not
//     guarantee post-response work without waitUntil either; P2-2 can add ctx.waitUntil for it;
//   - a throw (or rejection) BEFORE end() propagates to the caller (Vercel: 500 FUNCTION_INVOCATION_FAILED);
//   - one deadline covers the whole invocation (a handler awaiting a hung upstream included): when it expires
//     before end(), the caller gets 504 (Vercel: FUNCTION_INVOCATION_TIMEOUT). FUNCTION_TIMEOUT_MS is an explicit
//     budget; the project's real Vercel maxDuration is to be confirmed (vercel.json sets none).
//
// Differences from @vercel/node's helpers that do not affect gated parity fields (SEO_PARITY.md section 2.2):
// no ETag / Content-Length computation (the runtime sets Content-Length), no 304 freshness check, plain-text
// bodies on the 504 instead of Vercel's error page.

import { LOG_PREFIX } from '../env';

const SHIM_LOG_PREFIX = `${LOG_PREFIX} vercel-shim:`;

export type HeaderValue = string | number | ReadonlyArray<string>;

export interface VercelRequestShim {
  method: string;
  url: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
}

export interface VercelResponseShim {
  statusCode: number;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  setHeader(name: string, value: HeaderValue): VercelResponseShim;
  getHeader(name: string): HeaderValue | undefined;
  hasHeader(name: string): boolean;
  removeHeader(name: string): void;
  getHeaders(): Record<string, HeaderValue>;
  status(code: number): VercelResponseShim;
  send(body?: ShimPayload): VercelResponseShim;
  end(body?: ShimPayload): VercelResponseShim;
}

// Handlers are plain JS (api/*.js); their parameter types are not known to TypeScript.
export type VercelHandler = (req: any, res: any) => unknown;

export interface ShimRequestInit {
  method: string;
  // Path and query the handler sees as req.url, e.g. '/api/sitemap?type=lang&lang=en'.
  url: string;
  headers: Headers;
  // Overrides FUNCTION_TIMEOUT_MS (tests).
  timeoutMs?: number;
}

export type ShimPayload = string | Uint8Array | null | undefined;

function assertPayload(method: 'send' | 'end', payload: unknown): asserts payload is ShimPayload {
  if (payload === null || payload === undefined || typeof payload === 'string' || payload instanceof Uint8Array) return;
  const kind = Array.isArray(payload) ? 'array' : typeof payload;
  throw new TypeError(`res.${method}(${kind}) is not implemented by the Vercel shim (only string, Uint8Array or no body)`);
}

// Statuses whose Response must not carry a body (Fetch spec "null body status").
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// Deadline for one invocation, from the call to res.end() (see the lifecycle notes above).
export const FUNCTION_TIMEOUT_MS = 30_000;

// Node querystring semantics: a repeated key becomes an array, in order.
export function parseQuery(search: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  }
  return query;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // Headers iterates lowercased names; repeated values are already joined with ', '.
  for (const [name, value] of headers) out[name] = value;
  return out;
}

export function createRequest(init: ShimRequestInit): VercelRequestShim {
  const queryStart = init.url.indexOf('?');
  return {
    method: init.method,
    url: init.url,
    query: parseQuery(queryStart === -1 ? '' : init.url.slice(queryStart + 1)),
    headers: headersToObject(init.headers),
  };
}

interface Collected {
  res: VercelResponseShim;
  ended: Promise<void>;
  isEnded(): boolean;
  toResponse(): Response;
}

function createResponse(): Collected {
  const headers = new Map<string, { name: string; value: HeaderValue }>();
  let body: string | Uint8Array | null = null;
  let ended = false;
  let resolveEnded: () => void = () => {};
  const endedPromise = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });

  const res: VercelResponseShim = {
    statusCode: 200,
    get headersSent() {
      return ended;
    },
    get writableEnded() {
      return ended;
    },
    setHeader(name, value) {
      if (ended) throw new Error('Cannot set headers after they are sent to the client');
      headers.set(name.toLowerCase(), { name, value });
      return res;
    },
    getHeader(name) {
      return headers.get(name.toLowerCase())?.value;
    },
    hasHeader(name) {
      return headers.has(name.toLowerCase());
    },
    removeHeader(name) {
      headers.delete(name.toLowerCase());
    },
    getHeaders() {
      const out: Record<string, HeaderValue> = {};
      for (const [key, { value }] of headers) out[key] = value;
      return out;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(payload) {
      assertPayload('send', payload);
      // @vercel/node send(): a string body defaults Content-Type to text/html with charset utf-8.
      if (typeof payload === 'string' && !res.hasHeader('content-type')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      } else if (payload instanceof Uint8Array && !res.hasHeader('content-type')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      return res.end(payload);
    },
    end(payload) {
      assertPayload('end', payload);
      if (ended) return res;
      body = payload ?? null;
      ended = true;
      resolveEnded();
      return res;
    },
  };

  return {
    res,
    ended: endedPromise,
    isEnded: () => ended,
    toResponse() {
      const out = new Headers();
      for (const { name, value } of headers.values()) {
        if (Array.isArray(value)) for (const item of value) out.append(name, String(item));
        else out.set(name, String(value));
      }
      const status = res.statusCode;
      return new Response(NULL_BODY_STATUSES.has(status) ? null : body, { status, headers: out });
    },
  };
}

function timeoutResponse(): Response {
  return new Response('Gateway Timeout', {
    status: 504,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

type Outcome = { kind: 'ended' } | { kind: 'returned' } | { kind: 'threw'; error: unknown } | { kind: 'timeout' };

// Run a Vercel (req, res) handler and return what it wrote as a Response, as soon as it calls res.end() (or
// send()). A throw or rejection before that propagates to the caller; no end() within the deadline gives 504.
export async function runVercelHandler(handler: VercelHandler, init: ShimRequestInit): Promise<Response> {
  const req = createRequest(init);
  const collected = createResponse();
  const timeoutMs = init.timeoutMs ?? FUNCTION_TIMEOUT_MS;

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
  try {
    let outcome = await Promise.race([ended, settled, deadline]);
    // Returned without ending: keep waiting for end() within the same deadline.
    if (outcome.kind === 'returned' && !collected.isEnded()) outcome = await Promise.race([ended, deadline]);
    if (outcome.kind === 'threw' && !collected.isEnded()) {
      propagated = outcome.error;
      throw outcome.error;
    }
    if (outcome.kind === 'timeout' && !collected.isEnded()) {
      console.error(`${SHIM_LOG_PREFIX} handler did not end the response within ${timeoutMs} ms: ${init.method} ${init.url}`);
      return timeoutResponse();
    }
    return collected.toResponse();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The handler may still be running (work after end(), or a hung upstream after the deadline): never let a
    // late rejection become an unhandled one.
    run.catch((err: unknown) => {
      if (err !== propagated) console.error(`${SHIM_LOG_PREFIX} handler failed after the response was settled: ${init.method} ${init.url}`, err);
    });
  }
}
