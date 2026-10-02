// Two-tier row cache of the SEO handler (ARCHITECTURE.md §17; PLAN.md P1-4).
//
//   1. Per-isolate Map, identical to the Map caches of middleware.ts:94-99 and :375 (same TTLs, same "expires"
//      epoch-ms semantics: an entry is valid while expires > Date.now()).
//   2. KV SEO_CACHE behind it, shared by all isolates. Key "seo:v1:<kind>:<parts joined by ':'>", value JSON
//      {"data": <row(s)>, "expires": <epoch ms>}. KV's expirationTtl has a 60 s minimum, so the logical expiry is
//      the "expires" field: a KV entry whose expires lies in the past is a miss, whatever KV still returns.
//
// Read order Map -> KV -> (caller fetches Supabase). A KV hit is copied into the Map with its own expires.
// KV errors are logged and treated as a miss; KV writes run through ctx.waitUntil and never delay or fail a
// request.
//
// Extension (documented in handler.ts): an entry written for a lookup that FAILED (non-2xx, network error,
// timeout, missing anon key) carries "failed": true. Readers ignore it except the strict-404 path, which never
// turns a failed lookup into a 404.

import { LOG_PREFIX } from '../env';

export type CacheKind = 'article' | 'translations' | 'list' | 'sp' | 'splist' | 'cp' | 'cpalt';

export const KV_KEY_PREFIX = 'seo:v1';
// Cloudflare KV: keys are at most 512 bytes; expirationTtl must be >= 60 s.
const KV_MAX_KEY_BYTES = 512;
const KV_MIN_TTL_S = 60;

export interface CacheEntry<T> {
  data: T;
  expires: number;
  failed?: true;
}

// What a request needs to talk to KV. `kv` is undefined when the binding is absent (local tests of other
// modules); the cache then behaves as the Map-only cache of middleware.ts.
export interface CacheIo {
  kv: KVNamespace | undefined;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface CacheHit<T> {
  data: T;
  failed: boolean;
}

const encoder = new TextEncoder();

export function kvKey(kind: CacheKind, parts: readonly string[]): string {
  return `${KV_KEY_PREFIX}:${kind}:${parts.join(':')}`;
}

export function kvTtlSeconds(ttlMs: number): number {
  return Math.max(KV_MIN_TTL_S, Math.ceil(ttlMs / 1000));
}

function logKvError(op: 'get' | 'put', key: string, err: unknown): void {
  console.error(`${LOG_PREFIX} ${JSON.stringify({ msg: 'seo_kv_error', op, key, error: String(err) })}`);
}

function isEntry(value: unknown): value is CacheEntry<unknown> {
  return typeof value === 'object' && value !== null
    && 'data' in value
    && typeof (value as { expires?: unknown }).expires === 'number';
}

export class TieredCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();

  constructor(readonly kind: CacheKind) {}

  // Map, then KV. Returns undefined on a miss in both tiers.
  async get(parts: readonly string[], io: CacheIo): Promise<CacheHit<T> | undefined> {
    const mapKey = parts.join(':');
    const cached = this.map.get(mapKey);
    if (cached && cached.expires > Date.now()) return { data: cached.data, failed: cached.failed === true };

    const key = kvKey(this.kind, parts);
    if (!io.kv || encoder.encode(key).byteLength > KV_MAX_KEY_BYTES) return undefined;
    let value: unknown;
    try {
      value = await io.kv.get(key, { type: 'json' });
    } catch (err) {
      logKvError('get', key, err);
      return undefined;
    }
    if (!isEntry(value) || !(value.expires > Date.now())) return undefined;
    const entry: CacheEntry<T> = { data: value.data as T, expires: value.expires };
    if (value.failed === true) entry.failed = true;
    this.map.set(mapKey, entry);
    return { data: entry.data, failed: entry.failed === true };
  }

  // Same place and TTL as the Map write of middleware.ts; the KV write is fire-and-forget.
  set(parts: readonly string[], data: T, ttlMs: number, io: CacheIo, failed = false): void {
    const entry: CacheEntry<T> = { data, expires: Date.now() + ttlMs };
    if (failed) entry.failed = true;
    this.map.set(parts.join(':'), entry);

    const key = kvKey(this.kind, parts);
    if (!io.kv || encoder.encode(key).byteLength > KV_MAX_KEY_BYTES) return;
    let put: Promise<unknown>;
    try {
      put = io.kv.put(key, JSON.stringify(entry), { expirationTtl: kvTtlSeconds(ttlMs) });
    } catch (err) {
      logKvError('put', key, err);
      return;
    }
    io.waitUntil(put.catch((err: unknown) => logKvError('put', key, err)));
  }

  // Tests only: drop the isolate tier (simulates a fresh isolate in front of a warm KV).
  clearIsolate(): void {
    this.map.clear();
  }
}
