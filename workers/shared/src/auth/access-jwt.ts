// Cloudflare Access service-token assertion (header Cf-Access-Jwt-Assertion), verified against the team's
// certificates; machine callers are mapped from their Access client id to a machine name.
//   - RS256 only, against https://<team domain>/cdn-cgi/access/certs (cached 10 min, refetched once when a token
//     names an unknown key); iss = the team origin, aud one of the configured audiences, exp/nbf checked.
//   - A service-token assertion carries the token's client id in `common_name`; a human identity carries `email`.

import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from 'jose';

export interface AccessConfig {
  /** "x.cloudflareaccess.com" -> https://x.cloudflareaccess.com/cdn-cgi/access/certs; a value starting with
   *  "http://" or "https://" is used as the origin (local test stub only). */
  teamDomain: string;
  audiences: string[];
  fetchImpl?: typeof fetch;
  nowSec?: () => number;
}

export type AccessResult =
  | { ok: true; commonName: string | null; email: string | null }
  | { ok: false; reason: string };

export const ACCESS_ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';

const CERTS_TTL_MS = 600_000;
const REFETCH_COOLDOWN_MS = 30_000;
const CERTS_TIMEOUT_MS = 5_000;
const MACHINE_NAMES = new Set(['collector', 'mcp']);

interface CertsEntry {
  keys: JSONWebKeySet;
  fetchedMs: number;
}

const certsCache = new Map<string, CertsEntry>();

/** Empties the per-isolate certificate cache. */
export function resetAccessCertsCache(): void {
  certsCache.clear();
}

function teamOrigin(teamDomain: string): string | null {
  const value = teamDomain.trim().replace(/\/+$/, '');
  if (!value) return null;
  const origin = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

async function fetchCerts(url: string, doFetch: typeof fetch): Promise<JSONWebKeySet | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CERTS_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      return null;
    }
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) return null;
    // Only RSA public keys are used; RS256 is the only accepted algorithm.
    const keys = body.keys.filter((k): k is JSONWebKeySet['keys'][number] =>
      !!k && typeof k === 'object' && (k as { kty?: unknown }).kty === 'RSA');
    return { keys };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function certsFor(url: string, doFetch: typeof fetch, refresh: boolean): Promise<JSONWebKeySet | null> {
  const cached = certsCache.get(url);
  const now = Date.now();
  if (cached && !refresh && now - cached.fetchedMs < CERTS_TTL_MS) return cached.keys;
  if (cached && refresh && now - cached.fetchedMs < REFETCH_COOLDOWN_MS) return cached.keys;
  const keys = await fetchCerts(url, doFetch);
  if (!keys) return cached && now - cached.fetchedMs < CERTS_TTL_MS ? cached.keys : null;
  certsCache.set(url, { keys, fetchedMs: now });
  return keys;
}

export async function verifyAccessAssertion(headers: Headers, cfg: AccessConfig): Promise<AccessResult> {
  const token = headers.get(ACCESS_ASSERTION_HEADER);
  if (!token) return { ok: false, reason: 'missing_assertion' };
  const origin = teamOrigin(cfg.teamDomain);
  if (!origin) return { ok: false, reason: 'bad_team_domain' };
  const audiences = cfg.audiences.map((a) => a.trim()).filter(Boolean);
  if (audiences.length === 0) return { ok: false, reason: 'no_audience' };

  const certsUrl = `${origin}/cdn-cgi/access/certs`;
  const doFetch = cfg.fetchImpl ?? fetch;
  const options = {
    issuer: origin,
    audience: audiences,
    algorithms: ['RS256'],
    currentDate: cfg.nowSec ? new Date(cfg.nowSec() * 1000) : undefined,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const keys = await certsFor(certsUrl, doFetch, attempt > 0);
    if (!keys) return { ok: false, reason: 'certs_unavailable' };
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(keys), options);
      const commonName = typeof payload.common_name === 'string' && payload.common_name ? payload.common_name : null;
      const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
      return { ok: true, commonName, email };
    } catch (err) {
      if (attempt === 0 && err instanceof joseErrors.JWKSNoMatchingKey) continue;
      return { ok: false, reason: err instanceof joseErrors.JOSEError ? err.code : 'invalid' };
    }
  }
  return { ok: false, reason: 'invalid' };
}

/** "<client-id>=<name>,<client-id>=<name>" -> client id -> machine name. Unknown names are ignored. */
export function parseMachineMap(value: string | undefined): Map<string, 'collector' | 'mcp'> {
  const map = new Map<string, 'collector' | 'mcp'>();
  for (const entry of (value ?? '').split(',')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const clientId = entry.slice(0, eq).trim();
    const name = entry.slice(eq + 1).trim();
    if (!clientId || !MACHINE_NAMES.has(name)) continue;
    map.set(clientId, name as 'collector' | 'mcp');
  }
  return map;
}
