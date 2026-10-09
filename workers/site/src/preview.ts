// Response finalisation for every answer of microns-site (PLAN.md P1-7; ARCHITECTURE.md §6.2 "Preview", "HEAD").
//   - The "headers" rules of vercel.json:162-185, replicated exactly (CORS on /api/*, Content-Type on /assets/*).
//   - X-Robots-Tag: noindex on preview hosts: *.workers.dev, localhost and PREVIEW_HOSTNAMES; never on a host in
//     the production zone (ARCHITECTURE.md §6.2), whatever PREVIEW_HOSTNAMES says.
//   - Strict-Transport-Security only when HSTS_VALUE is set and the host is the SITE_ORIGIN host (SEO_PARITY.md F8).
//   - HEAD: same status and headers as GET, empty body (H-28).
//   - API_CORS_MODE (PLAN.md P6-4): "parity" (default, also when the var is absent or unknown) keeps the vercel.json
//     CORS headers on /api/*; "allowlist" replaces them, after the parity rules, with the allow-list of
//     workers/shared/src/http/cors.ts: only listed origins are reflected, Vary: Origin, never credentials. Status
//     codes and bodies never change. Switching back is a deploy of the previous version or the var set to "parity".

import { applyAllowlistCors } from '../../shared/src/http/cors';
import type { Env } from './env';
import { LOG_PREFIX } from './env';

/** Env plus the P6-4 CORS switch (declared here: src/env.ts keeps the Phase 2 block that test/env-api.test.ts pins). */
export interface CorsModeEnv extends Env {
  API_CORS_MODE?: string; // var, "parity" (default) | "allowlist"
}

type HeaderList = ReadonlyArray<readonly [string, string]>;

interface HeaderRule {
  source: RegExp;
  headers: HeaderList;
}

// vercel.json:163-172
const API_CORS_HEADERS: HeaderList = [
  ['Access-Control-Allow-Credentials', 'true'],
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT'],
  ['Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'],
];

// The vercel.json "source" patterns as path-to-regexp compiles them: anchored, case-sensitive, matched on the
// pathname only. Rules apply to every response on a matching path, whatever its status, in file order.
const API_PATH = /^\/api\/(.*)$/;

export const HEADER_RULES: ReadonlyArray<HeaderRule> = [
  { source: API_PATH, headers: API_CORS_HEADERS },                                                 // vercel.json:163-172
  { source: /^\/assets\/(.*\.js)$/, headers: [['Content-Type', 'application/javascript; charset=utf-8']] }, // vercel.json:173-178
  { source: /^\/assets\/(.*\.css)$/, headers: [['Content-Type', 'text/css; charset=utf-8']] },      // vercel.json:179-184
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function normaliseHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function siteHost(env: Env): string {
  try {
    return normaliseHost(new URL(env.SITE_ORIGIN).hostname);
  } catch {
    return '';
  }
}

// The production zone apex, e.g. micronshub.eu for https://www.micronshub.eu.
function productionZone(env: Env): string {
  return siteHost(env).replace(/^www\./, '');
}

export function isPreviewHost(hostname: string, env: Env): boolean {
  const host = normaliseHost(hostname);
  if (!host) return false;
  const zone = productionZone(env);
  // Guard: www, the apex and tenant subdomains must never be de-indexed by a configuration mistake.
  if (zone && (host === zone || host.endsWith(`.${zone}`))) return false;
  if (LOCAL_HOSTS.has(host) || host.endsWith('.workers.dev')) return true;
  return (env.PREVIEW_HOSTNAMES || '')
    .split(',')
    .map(normaliseHost)
    .filter(Boolean)
    .includes(host);
}

export type CorsMode = 'parity' | 'allowlist';

const warnedCorsValues = new Set<string>();

/** CORS mode of /api/* answers from API_CORS_MODE; anything but "allowlist" keeps parity (an unknown value is logged once). */
export function corsMode(env: CorsModeEnv): CorsMode {
  const raw = env.API_CORS_MODE ?? '';
  const value = raw.trim().toLowerCase();
  if (value === 'allowlist') return 'allowlist';
  if (value !== '' && value !== 'parity' && !warnedCorsValues.has(raw)) {
    warnedCorsValues.add(raw);
    console.warn(`${LOG_PREFIX} API_CORS_MODE ${JSON.stringify(raw)} is neither "parity" nor "allowlist": parity CORS kept`);
  }
  return 'parity';
}

export function finalise(response: Response, request: Request, env: CorsModeEnv): Response {
  const url = new URL(request.url);
  const isHead = request.method === 'HEAD';
  if (isHead && response.body) {
    // The body is never sent; release the stream (asset, upstream or rendered HTML).
    response.body.cancel().catch(() => {});
  }
  // Copy: responses from fetch() and env.ASSETS.fetch() have immutable headers.
  const out = new Response(isHead ? null : response.body, response);

  for (const rule of HEADER_RULES) {
    if (!rule.source.test(url.pathname)) continue;
    for (const [name, value] of rule.headers) out.headers.set(name, value);
  }

  // After the parity rules, so that allow-list mode also replaces the grants a handler or the Vercel forward set.
  if (API_PATH.test(url.pathname) && corsMode(env) === 'allowlist') {
    applyAllowlistCors(out.headers, request.headers.get('Origin'), {
      siteOrigin: env.SITE_ORIGIN,
      requestHost: normaliseHost(url.hostname),
      requestIsPreview: isPreviewHost(url.hostname, env),
    });
  }

  if (isPreviewHost(url.hostname, env)) {
    out.headers.set('X-Robots-Tag', 'noindex');
  } else if (env.HSTS_VALUE && url.protocol === 'https:' && normaliseHost(url.hostname) === siteHost(env)) {
    out.headers.set('Strict-Transport-Security', env.HSTS_VALUE);
  }
  return out;
}
