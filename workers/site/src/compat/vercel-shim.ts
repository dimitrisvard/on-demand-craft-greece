// Minimal Vercel Node.js Function (req, res) shim, so files in api/ run unchanged inside the Worker
// (PLAN.md P1-6 now; grows into the Express-style shim of P2-2 for the other api/* handlers).
//
// Implemented today, only what api/sitemap.js uses:
//   req: method, url (path + query, as Vercel passes the rewritten destination), query (parsed), headers
//        (lowercased names, as Node's IncomingMessage).
//   res: statusCode, setHeader / getHeader / hasHeader / removeHeader / getHeaders, status(code), send(string |
//        bytes), end([string | bytes]).
// Not implemented yet (P2-2): req.body / req.cookies parsing, res.json, res.redirect, res.write streaming,
// res.writeHead, events. A handler that touches them fails loudly (TypeError) instead of silently differing.
//
// Differences from @vercel/node's helpers that do not affect gated parity fields (SEO_PARITY.md §2.2):
// no ETag / Content-Length computation (the runtime sets Content-Length), no 304 freshness check.

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
  send(body?: string | Uint8Array | null): VercelResponseShim;
  end(body?: string | Uint8Array | null): VercelResponseShim;
}

// Handlers are plain JS (api/*.js); their parameter types are not known to TypeScript.
export type VercelHandler = (req: any, res: any) => unknown;

export interface ShimRequestInit {
  method: string;
  // Path and query the handler sees as req.url, e.g. '/api/sitemap?type=lang&lang=en'.
  url: string;
  headers: Headers;
}

// Statuses whose Response must not carry a body (Fetch spec "null body status").
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// Wait for res.end() after the handler's promise settled; Vercel waits up to the function timeout.
const END_TIMEOUT_MS = 30_000;

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
      // @vercel/node send(): a string body defaults Content-Type to text/html with charset utf-8.
      if (typeof payload === 'string' && !res.hasHeader('content-type')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      } else if (payload instanceof Uint8Array && !res.hasHeader('content-type')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      return res.end(payload);
    },
    end(payload) {
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

// Run a Vercel (req, res) handler and return what it wrote as a Response. A throw (or a rejected promise) from
// the handler propagates to the caller; a handler that never ends the response fails after END_TIMEOUT_MS.
export async function runVercelHandler(handler: VercelHandler, init: ShimRequestInit): Promise<Response> {
  const req = createRequest(init);
  const collected = createResponse();
  await handler(req, collected.res);
  if (!collected.isEnded()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`handler did not end the response within ${END_TIMEOUT_MS} ms`)), END_TIMEOUT_MS);
    });
    try {
      await Promise.race([collected.ended, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return collected.toResponse();
}
