// Hono adapter over the shared shim core (workers/shared/src/compat/vercel-node.ts): runs an unchanged Vercel
// (req, res) handler for an ops route, with the function URL from the registered OpsCall. The semantics are those
// of @vercel/node (req.query, req.body, res.status/json/send/redirect), not Express; the file keeps the name the
// migration plan gives it.
//
// Rules
//   - The handler module is loaded on the first request of its route (literal lazy import), so a module-scope
//     failure (for example a missing secret read at import) answers 500 on that route only.
//   - req.url is the function URL of the call (path + query, rewrite merged by the site), not the RPC request URL.
//   - The body is read once through Hono's cached reader, so a route that inspected it first can still run the
//     handler; GET and HEAD carry no body.
//   - Default deadline 300,000 ms (ops interactive routes); a handler that never ends answers 504.

import type { Context } from 'hono';
import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { LOG_PREFIX, type OpsHono } from '../env';

/** Deadline of an interactive ops route, from the call to res.end(). */
export const OPS_ROUTE_TIMEOUT_MS = 300_000;

function executionContext(c: Context<OpsHono>): { waitUntil(p: Promise<unknown>): void } | undefined {
  // Hono throws when the app was called without an ExecutionContext (unit tests); the shim then awaits nothing.
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/** The raw request bytes for the handler: null for GET and HEAD, otherwise the (cached) body. */
export async function requestBytes(c: Context<OpsHono>): Promise<Uint8Array | null> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  return new Uint8Array(await c.req.arrayBuffer());
}

/** Route handler that loads its module lazily on first use; timeout default 300,000 ms. */
export function vercelRoute(
  load: () => Promise<{ default: VercelHandler }>,
  o?: { timeoutMs?: number },
): (c: Context<OpsHono>) => Promise<Response> {
  return async (c) => {
    const { default: handler } = await load();
    return runVercel(c, handler, { timeoutMs: o?.timeoutMs });
  };
}

/** Runs `handler` for this request; `functionUrl` and `body` default to the call's function URL and the request body. */
export async function runVercel(
  c: Context<OpsHono>,
  handler: VercelHandler,
  o?: { functionUrl?: string; body?: Uint8Array | null; timeoutMs?: number },
): Promise<Response> {
  const call = c.var.call;
  const body = o?.body !== undefined ? o.body : await requestBytes(c);
  return runNodeHandler(handler, {
    request: c.req.raw,
    functionUrl: o?.functionUrl ?? call.functionUrl,
    body,
    ctx: executionContext(c),
    timeoutMs: o?.timeoutMs ?? OPS_ROUTE_TIMEOUT_MS,
    logPrefix: LOG_PREFIX,
  });
}
