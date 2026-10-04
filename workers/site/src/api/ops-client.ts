// Calls microns-ops over the service binding OPS (RPC to the named entrypoint OpsApi, method handle(request, call)).
//
// Request handed to ops:
//   URL      new URL(functionUrl, request.url): the function path + query the handler sees, on the host the client
//            asked for
//   method   as received
//   headers  the client's headers without: host, content-length, hop-by-hop headers and every name listed in
//            Connection (the body may have been rewritten by the gate, so its length is recomputed), cookie,
//            cf-access-client-id, cf-access-client-secret, cf-access-jwt-assertion and every x-microns-* header
//   body     the buffered (possibly gate-rewritten) bytes; none for GET/HEAD
// The verified principal, the function URL and the action travel only in `call` (OpsCall), never in headers.
// An RPC rejection answers 500 text/plain, except for `nest`, which answers 504 {"code":"TIMEOUT"} because a
// rejection there means the nesting run exceeded the ops CPU limit.

import { describeError } from '../../../shared/src/compat/vercel-node';
import { jsonResponse, textResponse } from '../../../shared/src/http/json';
import { formatLogLine } from '../../../shared/src/http/log';
import type { OpsApiRpc, OpsCall, Principal } from '../../../shared/src/http/rpc';
import type { Env } from '../env';
import { LOG_PREFIX } from '../env';
import { connectionTokens, HOP_BY_HOP } from './forward';
import { actionForLog, type ResolvedApi } from './resolve';

const STRIPPED: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'cookie',
  'cf-access-client-id',
  'cf-access-client-secret',
  'cf-access-jwt-assertion',
]);

/** Headers of the request handed to microns-ops (rules above). */
export function opsHeaders(incoming: Headers): Headers {
  const named = connectionTokens(incoming);
  const out = new Headers();
  for (const [name, value] of incoming) {
    const key = name.toLowerCase();
    if (STRIPPED.has(key) || HOP_BY_HOP.has(key) || named.has(key) || key.startsWith('x-microns-')) continue;
    out.append(name, value);
  }
  return out;
}

export const NEST_TIMEOUT_BODY = { success: false, error: 'Nesting exceeded the time limit', code: 'TIMEOUT' } as const;

export async function callOps(
  env: Env & { OPS: Fetcher & OpsApiRpc },
  request: Request,
  r: ResolvedApi,
  o: { functionUrl: string; body: Uint8Array | null; principal: Principal; requestId: string; openerOrigin?: string },
): Promise<Response> {
  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD' && o.body !== null;
  const inner = new Request(new URL(o.functionUrl, request.url), {
    method,
    headers: opsHeaders(request.headers),
    body: hasBody ? o.body : null,
    redirect: 'manual',
  });
  const call: OpsCall = {
    v: 1,
    requestId: o.requestId,
    endpoint: r.endpoint,
    action: r.action,
    functionUrl: o.functionUrl,
    principal: o.principal,
  };
  if (o.openerOrigin !== undefined) call.openerOrigin = o.openerOrigin;
  try {
    return await env.OPS.handle(inner, call);
  } catch (err) {
    const line = formatLogLine(LOG_PREFIX, 'api ops call failed', { endpoint: r.endpoint, action: actionForLog(r.action), requestId: o.requestId });
    console.error(line, describeError(err));
    if (r.action === 'nest') return jsonResponse(504, NEST_TIMEOUT_BODY);
    return textResponse(500, 'Internal Server Error');
  }
}
