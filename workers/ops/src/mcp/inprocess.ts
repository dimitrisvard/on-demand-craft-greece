// In-process calls from remote MCP tools into the ops routes (the handlers the local server reached over HTTP at
// /api/*): a synthetic Request goes straight into the ops Hono app with a registered OpsCall whose principal is the
// verified MCP staff principal, the way OpsApi.handle runs a call from the site.
//
// Rules
//   - Only the calls the tools need: GET /api/tenders (CSV export), POST /api/scrape-website, POST /api/agent/start.
//     Anything else throws.
//   - The site gate does not run in-process, so its data rules run here first, from the shared validators
//     (workers/shared/src/auth/scrape-rules.ts): a website scrape needs 1 to 25 URLs, each an http(s) URL of a
//     public web host (no IP literal, localhost, our own zone or platform hosts); a refused call answers 400
//     {"error":"url_not_allowed"} and no handler runs.
//   - The principal carries class, uid and roles only (no e-mail address).

import { scrapeUrlsAllowed } from '../../../shared/src/auth/scrape-rules';
import { jsonResponse } from '../../../shared/src/http/json';
import type { OpsCall } from '../../../shared/src/http/rpc';
import { app, registerCall } from '../app';
import type { InProcessCall, McpContext } from './context';

// The synthetic request never leaves the isolate; the host only gives the app an absolute URL.
const SYNTHETIC_ORIGIN = 'https://microns-ops.internal';

const ALLOWED: ReadonlyArray<{ endpoint: InProcessCall['endpoint']; method: InProcessCall['method']; path: string }> = [
  { endpoint: 'tenders', method: 'GET', path: '/api/tenders' },
  { endpoint: 'scrape-website', method: 'POST', path: '/api/scrape-website' },
  { endpoint: 'agent', method: 'POST', path: '/api/agent/start' },
];

/** The data-rule refusal for a call, or null when the call may run. */
export function inProcessRefusal(call: InProcessCall, siteOrigin: string): Response | null {
  if (call.endpoint === 'scrape-website') {
    const urls = (call.body as { urls?: unknown } | undefined)?.urls;
    if (!scrapeUrlsAllowed(urls, { siteOrigin })) return jsonResponse(400, { error: 'url_not_allowed' });
  }
  return null;
}

export async function callInProcess(ctx: McpContext, call: InProcessCall): Promise<Response> {
  const path = call.functionUrl.split('?')[0];
  if (!ALLOWED.some((a) => a.endpoint === call.endpoint && a.method === call.method && a.path === path)) {
    throw new Error(`in-process call not allowed: ${call.method} ${path}`);
  }
  const refusal = inProcessRefusal(call, ctx.env.SITE_ORIGIN);
  if (refusal) return refusal;
  const opsCall: OpsCall = {
    v: 1,
    requestId: crypto.randomUUID(),
    endpoint: call.endpoint,
    action: call.action,
    functionUrl: call.functionUrl,
    principal: { class: ctx.principal.class, uid: ctx.principal.uid, roles: [...ctx.principal.roles] },
  };
  const headers = new Headers(call.headers ?? {});
  let body: string | undefined;
  if (call.method === 'POST') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(call.body ?? {});
  }
  const request = new Request(new URL(call.functionUrl, SYNTHETIC_ORIGIN), { method: call.method, headers, body });
  registerCall(request, opsCall);
  return app.fetch(request, ctx.env, ctx.exec);
}
