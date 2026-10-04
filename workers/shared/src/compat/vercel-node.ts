/// <reference path="./ambient.d.ts" />
// Shim core: runs an unchanged Vercel Node.js Function (req, res) inside a Worker with the helper semantics of
// @vercel/node 17.0.0 (req.query, req.body, res.status/json/send/redirect …), not Express. Both Workers use it:
// microns-site for its local /api handlers, microns-ops (through its Hono adapter) for the others.
// The sitemap shim of microns-site (its src/compat/vercel-shim.ts) is separate and unchanged.

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

/** Exact @vercel/node getBodyParser semantics for this Content-Type and these bytes, evaluated once. */
export function parseVercelBody(contentType: string | null, bytes: Uint8Array): BodyView {
  throw new Error('not implemented: A');
}

/** Node querystring-style parse over URLSearchParams (a repeated key becomes an array, in order). */
export function parseQuery(search: string): Record<string, string | string[]> {
  throw new Error('not implemented: A');
}

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

/** Runs a Vercel (req, res) handler and resolves with its Response at res.end(). */
export function runNodeHandler(handler: VercelHandler, init: NodeHandlerInit): Promise<Response> {
  throw new Error('not implemented: A');
}
