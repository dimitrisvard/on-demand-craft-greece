// Supabase user JWT verification: a local pre-check, then GET {SUPABASE_URL}/auth/v1/user; roles are read as an
// array from user_roles with the caller's JWT. No JWT secret is held by any Worker.
//   - Pre-check (no network): payload role and aud 'authenticated', exp in the future, sub a UUID. Project API
//     keys used as a bearer fail here.
//   - Verification: Supabase Auth must accept the token (it also refuses tokens of signed-out sessions) and
//     return the same user id as `sub`.
//   - Per-isolate cache keyed by SHA-256 of the token, TTL min(60 s, exp - now); concurrent requests with the same
//     token share one verification.
//   - Missing, malformed or refused token: 401 unauthorized. Auth or PostgREST unreachable: 503 auth_unavailable.
// A local JWKS verifier (verifySupabaseJwtWithJwks) is provided for projects with asymmetric signing keys; the
// gate does not use it while the project's JWKS is empty.

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { restRequest } from './postgrest';

/** Roles that make a user staff (api/_lib/admin-auth.js). */
export const STAFF_ROLES: readonly ['admin', 'sales_rep', 'production_manager', 'accountant'] =
  ['admin', 'sales_rep', 'production_manager', 'accountant'];

const PARTNER_ROLES: readonly string[] = ['partner_seller', 'supplier'];

export interface SupabaseAuthConfig {
  supabaseUrl: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface VerifiedUser {
  uid: string;
  email: string | null;
  roles: string[];
}

export type JwtResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; status: 401 | 503; code: 'unauthorized' | 'auth_unavailable' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;
const AUTH_TIMEOUT_MS = 5_000;

const UNAUTHORIZED: JwtResult = { ok: false, status: 401, code: 'unauthorized' };
const UNAVAILABLE: JwtResult = { ok: false, status: 503, code: 'auth_unavailable' };

interface CacheEntry {
  user: VerifiedUser;
  expiresMs: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<JwtResult>>();

/** Empties the per-isolate verification cache. */
export function resetSupabaseJwtCache(): void {
  cache.clear();
  inflight.clear();
}

/** `Authorization: Bearer <token>` only (no cookie, no query parameter). */
export function bearerToken(headers: Headers): string | null {
  const value = headers.get('authorization');
  if (!value) return null;
  const match = /^Bearer[ \t]+([^\s]+)[ \t]*$/i.exec(value);
  return match ? match[1] : null;
}

function base64UrlDecode(segment: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return null;
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function hasAudience(aud: unknown, wanted: string): boolean {
  return aud === wanted || (Array.isArray(aud) && aud.includes(wanted));
}

export function precheckSupabaseJwt(token: string, nowSec: number): { ok: true; sub: string; exp: number } | { ok: false } {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false };
  const json = base64UrlDecode(parts[1]);
  if (json === null) return { ok: false };
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false };
  const claims = payload as Record<string, unknown>;
  if (claims.role !== 'authenticated') return { ok: false };
  if (!hasAudience(claims.aud, 'authenticated')) return { ok: false };
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSec) return { ok: false };
  if (typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) return { ok: false };
  return { ok: true, sub: claims.sub.toLowerCase(), exp: claims.exp };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function fetchWithTimeout(doFetch: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([doFetch(url, { ...init, signal: controller.signal }).catch(() => null), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function verifyRemotely(token: string, sub: string, cfg: SupabaseAuthConfig): Promise<JwtResult> {
  const base = cfg.supabaseUrl.replace(/\/+$/, '');
  const doFetch = cfg.fetchImpl ?? fetch;

  const userResponse = await fetchWithTimeout(doFetch, `${base}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, accept: 'application/json' },
  }, AUTH_TIMEOUT_MS);
  if (!userResponse) return UNAVAILABLE;
  if (userResponse.status >= 500 || userResponse.status === 429) {
    userResponse.body?.cancel().catch(() => {});
    return UNAVAILABLE;
  }
  if (userResponse.status !== 200) {
    userResponse.body?.cancel().catch(() => {});
    return UNAUTHORIZED;
  }
  let user: unknown;
  try {
    user = await userResponse.json();
  } catch {
    return UNAVAILABLE;
  }
  const record = (user && typeof user === 'object' ? user : {}) as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.toLowerCase() !== sub) return UNAUTHORIZED;
  const email = typeof record.email === 'string' && record.email ? record.email : null;

  const roles = await restRequest(
    { supabaseUrl: cfg.supabaseUrl, apiKey: cfg.anonKey, bearer: token, fetchImpl: cfg.fetchImpl, timeoutMs: AUTH_TIMEOUT_MS },
    `user_roles?select=role&user_id=eq.${sub}`,
  );
  if (roles.kind === 'unavailable') return UNAVAILABLE;
  if (roles.kind === 'client_error') return roles.status === 401 || roles.status === 403 ? UNAUTHORIZED : UNAVAILABLE;
  if (!Array.isArray(roles.body)) return UNAVAILABLE;
  const roleNames = roles.body
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>).role : undefined))
    .filter((role): role is string => typeof role === 'string');

  return { ok: true, user: { uid: sub, email, roles: roleNames } };
}

export async function verifySupabaseJwt(token: string, cfg: SupabaseAuthConfig): Promise<JwtResult> {
  const nowMs = cfg.nowMs ? cfg.nowMs() : Date.now();
  const pre = precheckSupabaseJwt(token, Math.floor(nowMs / 1000));
  if (!pre.ok) return UNAUTHORIZED;

  const key = await sha256Hex(`${cfg.supabaseUrl}\n${token}`);
  const cached = cache.get(key);
  if (cached) {
    if (cached.expiresMs > nowMs) return { ok: true, user: { ...cached.user, roles: [...cached.user.roles] } };
    cache.delete(key);
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = verifyRemotely(token, pre.sub, cfg).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const result = await pending;
  if (result.ok && !cache.has(key)) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { user: result.user, expiresMs: Math.min(nowMs + CACHE_TTL_MS, pre.exp * 1000) });
  }
  return result.ok ? { ok: true, user: { ...result.user, roles: [...result.user.roles] } } : result;
}

export function classOfRoles(roles: string[]): 'ADMIN' | 'STAFF' | 'PARTNER' | 'CUSTOMER' {
  if (roles.includes('admin')) return 'ADMIN';
  if (roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role))) return 'STAFF';
  if (roles.some((role) => PARTNER_ROLES.includes(role))) return 'PARTNER';
  return 'CUSTOMER';
}

// ----- Local verification against the project's JWKS (asymmetric signing keys) -----

export interface SupabaseJwksConfig {
  supabaseUrl: string;
  fetchImpl?: typeof fetch;
  nowSec?: () => number;
}

export type JwksResult =
  | { ok: true; sub: string; email: string | null; exp: number }
  | { ok: false; reason: 'no_keys' | 'invalid' | 'unavailable' };

const JWKS_TTL_MS = 600_000;
const ASYMMETRIC_ALGORITHMS = ['ES256', 'RS256', 'EdDSA'];
let jwksCache: { url: string; keys: JSONWebKeySet; fetchedMs: number } | null = null;

async function loadJwks(cfg: SupabaseJwksConfig): Promise<JSONWebKeySet | null> {
  const base = cfg.supabaseUrl.replace(/\/+$/, '');
  const url = `${base}/auth/v1/.well-known/jwks.json`;
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedMs < JWKS_TTL_MS) return jwksCache.keys;
  const response = await fetchWithTimeout(cfg.fetchImpl ?? fetch, url, { headers: { accept: 'application/json' } }, AUTH_TIMEOUT_MS);
  if (!response || !response.ok) return null;
  try {
    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    // Only asymmetric public keys are accepted; the algorithm comes from the key, never from the token header.
    const usable = keys.filter((k): k is JSONWebKeySet['keys'][number] =>
      !!k && typeof k === 'object' && typeof (k as { kty?: unknown }).kty === 'string' && (k as { kty: string }).kty !== 'oct');
    jwksCache = { url, keys: { keys: usable }, fetchedMs: Date.now() };
    return jwksCache.keys;
  } catch {
    return null;
  }
}

/** Verifies a Supabase user JWT locally with the project's published asymmetric keys. */
export async function verifySupabaseJwtWithJwks(token: string, cfg: SupabaseJwksConfig): Promise<JwksResult> {
  const nowSec = cfg.nowSec ? cfg.nowSec() : Math.floor(Date.now() / 1000);
  const pre = precheckSupabaseJwt(token, nowSec);
  if (!pre.ok) return { ok: false, reason: 'invalid' };
  const keys = await loadJwks(cfg);
  if (!keys) return { ok: false, reason: 'unavailable' };
  if (keys.keys.length === 0) return { ok: false, reason: 'no_keys' };
  const algorithms = [...new Set(keys.keys.map((k) => (typeof k.alg === 'string' ? k.alg : '')).filter((a) => ASYMMETRIC_ALGORITHMS.includes(a)))];
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: `${cfg.supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
      audience: 'authenticated',
      algorithms: algorithms.length ? algorithms : ASYMMETRIC_ALGORITHMS,
      currentDate: new Date(nowSec * 1000),
    });
    const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
    return { ok: true, sub: pre.sub, email, exp: pre.exp };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Empties the JWKS cache. */
export function resetSupabaseJwksCache(): void {
  jwksCache = null;
}
