// Router step 3, Phase 1 (PLAN.md P1-3, §5.2 last row): every /api/* request is proxied unchanged to
// API_FORWARD_ORIGIN (Vercel production), keeping method, path, query, body and end-to-end headers.
// Stripped: hop-by-hop headers (RFC 9110 §7.6.1), headers named in Connection, Host and every cf-* header
// (Cloudflare metadata, and the preview's CF-Access-Client-Id/-Secret, which must never leave Cloudflare).
// Added: X-Forwarded-Host with the host the client asked for. Redirects are passed back, not followed.
// The request body is buffered (Vercel Functions accept at most 4.5 MB anyway), so Content-Length is recomputed.
// Timeout 30 s; a network error or timeout answers 502 {"error":"upstream"}. The vercel.json:163-172 CORS
// headers are applied afterwards by finalise(), as on Vercel.
// Phase 2 replaces this with the /api router (local handlers, OPS, and this forward behind api.forward_to_vercel).

import type { Env } from '../env';
import { LOG_PREFIX } from '../env';

const UPSTREAM_TIMEOUT_MS = 30_000;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function forwardHeaders(incoming: Headers, clientHost: string): Headers {
  const named = new Set(
    (incoming.get('connection') || '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = new Headers();
  for (const [name, value] of incoming) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || named.has(key) || key === 'host' || key === 'content-length' || key.startsWith('cf-')) continue;
    out.append(name, value);
  }
  out.set('X-Forwarded-Host', clientHost);
  return out;
}

function upstreamError(): Response {
  return new Response(JSON.stringify({ error: 'upstream' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApi(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  let target: URL;
  try {
    target = new URL(url.pathname + url.search, env.API_FORWARD_ORIGIN);
  } catch (err) {
    console.error(`${LOG_PREFIX} api forward: invalid API_FORWARD_ORIGIN`, err);
    return upstreamError();
  }
  // Once www routes to this Worker (Phase 3), forwarding to www would call the Worker again.
  if (target.host === url.host) {
    console.error(`${LOG_PREFIX} api forward: API_FORWARD_ORIGIN is this Worker's own host (${url.host}), refusing to loop`);
    return upstreamError();
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    return await fetch(target.toString(), {
      method: request.method,
      headers: forwardHeaders(request.headers, url.host),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} api forward failed: ${request.method} ${url.pathname}`, err);
    return upstreamError();
  }
}
