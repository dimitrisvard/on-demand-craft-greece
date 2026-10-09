// Router step 3 entry (src/index.ts): every /api/* request except /api/sitemap (step 2) arrives in handleApi.
//
//   flag api.forward_to_vercel on  -> forwardToVercel(): the request goes unchanged to API_FORWARD_ORIGIN (the
//                                     Vercel deployment), ungated, every method incl. OPTIONS (rollback switch)
//   flag off                       -> routeApi() (src/api/router.ts): local handlers, microns-ops (OPS), or this
//                                     forward for paths the router does not serve
//
// Flag (KV FLAGS, key api.forward_to_vercel, read with a 60 s edge cache, src/flags.ts):
//   {"enabled": true}                                   forward every /api/* request
//   {"enabled": true, "value": {"paths": ["/api/gsc"]}}  only these public paths (exact match)
//   {"enabled": true, "value": {"hosts": ["preview"]}}   only on preview hosts ("production": only on the others);
//                                                        paths and hosts combine with AND
//   {"enabled": false}                                  forward nothing
// A missing key, a malformed value or a KV error falls back to the var API_FORWARD_TO_VERCEL: "true" forwards
// everything; "false", empty or absent forwards nothing; any other value forwards nothing and is logged.
// Paths that Vercel has no handler for are never forwarded, whatever the flag or the var says
// (NEVER_FORWARDED_PREFIXES, matched on the canonical spelling of the path): /api/agent/* (Phase 4) and /api/cad/*
// (Phase 5, the CAD compat path, whose path carries a credential).
//
// forwardToVercel keeps method, path, query, body and end-to-end headers. Stripped: hop-by-hop headers (RFC 9110
// §7.6.1), headers named in Connection, Host, Content-Length and every cf-* header (Cloudflare metadata, and the
// preview's CF-Access-Client-Id/-Secret, which must never leave Cloudflare). Added: X-Forwarded-Host with the host
// the client asked for. Redirects are passed back, not followed. Timeout 30 s; a network error or timeout answers
// 502 {"error":"upstream"}. The vercel.json CORS headers are applied afterwards by finalise(), as on Vercel.
//
// /api/cad/* (Phase 5): every error thrown before or inside routeApi (a failed body read included) is caught here
// and answered 500 text/plain "Internal Server Error", the router's answer to its other internal errors. Its one
// log line names the path as redactedCadPath() prints it and the error's name only, so the path segment that
// carries the compat token never reaches a log line. Every other /api path is handled exactly as before.

import { formatLogLine } from '../../../shared/src/http/log';
import { textResponse } from '../../../shared/src/http/json';
import type { Env } from '../env';
import { LOG_PREFIX } from '../env';
import { getFlagValue } from '../flags';
import { isPreviewHost } from '../preview';
import { AGENT_PATH_PREFIX, CAD_PATH_PREFIX, canonicalApiPath, isCadPath } from './resolve';
import { routeApi } from './router';

const UPSTREAM_TIMEOUT_MS = 30_000;

export const FORWARD_FLAG_KEY = 'api.forward_to_vercel';

/** Path prefixes that are never forwarded to Vercel (one list; a prefix ends with '/'). */
export const NEVER_FORWARDED_PREFIXES: readonly string[] = [AGENT_PATH_PREFIX];

/** Phase 5 prefixes that are never forwarded (kept apart from the Phase 4 list, which its tests pin). */
export const NEVER_FORWARDED_P5_PREFIXES: readonly string[] = [CAD_PATH_PREFIX];

/** True when the canonical spelling of the path is a never-forwarded prefix or lies under one. */
export function neverForwarded(pathname: string): boolean {
  const canonical = `${canonicalApiPath(pathname)}/`;
  return [...NEVER_FORWARDED_PREFIXES, ...NEVER_FORWARDED_P5_PREFIXES].some((prefix) => canonical.startsWith(prefix));
}

export const HOP_BY_HOP: ReadonlySet<string> = new Set([
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

/** Names listed in the Connection header (lower case); they are hop-by-hop for this message. */
export function connectionTokens(headers: Headers): Set<string> {
  return new Set(
    (headers.get('connection') || '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function forwardHeaders(incoming: Headers, clientHost: string): Headers {
  const named = connectionTokens(incoming);
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

/**
 * Proxies the request to API_FORWARD_ORIGIN. When `body` is passed (bytes the router already buffered; null for
 * none) it is sent as is and the request body is never read, because a body stream can be read only once;
 * otherwise the request body is read here.
 */
export async function forwardToVercel(request: Request, env: Env, body?: Uint8Array | null): Promise<Response> {
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
    let payload: BodyInit | undefined;
    if (hasBody) payload = body !== undefined ? (body ?? undefined) : await request.arrayBuffer();
    return await fetch(target.toString(), {
      method: request.method,
      headers: forwardHeaders(request.headers, url.host),
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} api forward failed: ${request.method} ${url.pathname}`, err);
    return upstreamError();
  }
}

function varSaysForward(env: Env): boolean {
  const value = env.API_FORWARD_TO_VERCEL;
  if (value === 'true') return true;
  if (value === undefined || value === '' || value === 'false') return false;
  console.error(`${LOG_PREFIX} api forward: API_FORWARD_TO_VERCEL is neither "true" nor "false", forwarding is off`);
  return false;
}

/** True when this /api request goes to Vercel (flag api.forward_to_vercel, else the var). */
export async function shouldForward(env: Env, url: URL): Promise<boolean> {
  if (neverForwarded(url.pathname)) return false;
  const flag = await getFlagValue(env, FORWARD_FLAG_KEY);
  if (flag === null) return varSaysForward(env);
  if (!flag.enabled) return false;
  const paths = flag.value?.paths;
  if (paths && !paths.includes(url.pathname)) return false;
  const hosts = flag.value?.hosts;
  if (hosts) {
    const kind = isPreviewHost(url.hostname, env) ? 'preview' : 'production';
    if (!hosts.includes(kind)) return false;
  }
  return true;
}

/** A last path segment that is printed as it is: shorter than any compat token (32 characters or more). */
const PRINTABLE_CAD_SEGMENT = /^[a-z0-9-]{1,31}$/;

/** A /api/cad/ path as a log line may name it: '/api/cad/<redacted>/<last segment>', the last segment itself
 *  replaced by '<redacted>' unless it is a short [a-z0-9-] literal. */
export function redactedCadPath(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  return `${CAD_PATH_PREFIX}<redacted>/${PRINTABLE_CAD_SEGMENT.test(last) ? last : '<redacted>'}`;
}

async function routeCadApi(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
  try {
    return await routeApi(request, env, ctx);
  } catch (err) {
    const error = err instanceof Error ? err.name : typeof err;
    console.error(formatLogLine(LOG_PREFIX, 'api cad compat failed', { method: request.method, path: redactedCadPath(pathname), error }));
    return textResponse(500, 'Internal Server Error');
  }
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // /api/cad/* is never forwarded (neverForwarded), so shouldForward is not consulted for it.
  if (isCadPath(url.pathname)) return routeCadApi(request, env, ctx, url.pathname);
  if (await shouldForward(env, url)) return forwardToVercel(request, env);
  return routeApi(request, env, ctx);
}
