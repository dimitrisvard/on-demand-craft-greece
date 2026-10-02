// Two-tier row cache of the SEO handler (ARCHITECTURE.md §17; PLAN.md P1-4).
//
//   1. Per-isolate Map, with the same TTLs and "expires" semantics as the Map caches of middleware.ts:94-99 and
//      :375: an entry is valid while expires > Date.now().
//   2. KV SEO_CACHE behind it, shared by all isolates. Key "seo:v1:<kind>:<parts joined by ':'>", value JSON
//      {"data": <row(s)>, "expires": <epoch ms>, "v": <shape>}. KV's expirationTtl has a 60 s minimum, so the
//      logical expiry is the "expires" field: a KV entry whose expires lies in the past is a miss, whatever KV
//      still returns.
//
// Read order Map -> KV -> (caller fetches Supabase). A KV hit is copied into the Map with its own expires. KV
// errors AND slow KV reads (KV_GET_TIMEOUT_MS) are logged and treated as a miss; KV writes run through
// ctx.waitUntil. Neither can delay a request by more than the read deadline or fail it.
//
// Differences from the plain Map of middleware.ts. None of them changes a byte that is served; they only change
// how often KV or Supabase is asked:
//   - Failed lookups (non-2xx, network error, timeout, missing anon key) are cached in THIS isolate's Map only,
//     tagged `failed`, exactly as middleware.ts caches them per isolate. They are never written to KV, so one
//     isolate's transient Supabase failure cannot change the document other isolates serve. The tag is read by
//     the strict-404 path, which never turns a failed lookup into a 404.
//   - "v" is a fingerprint of the query and normalisation that produced the data (supabase.ts cacheShape). A KV
//     value with another "v" (written by an older or newer deployed version, or a preview version sharing the
//     namespace) is a miss, so a deploy that changes a select list or the normaliser behaves as a cache flush,
//     as a Vercel deploy does today with its fresh Maps. The key format stays as specified so microns-ops can
//     delete keys on content publish.
//   - The Map is bounded (maxEntries per kind): when full, expired entries are dropped first, then the oldest
//     inserted. middleware.ts's Maps are unbounded; a Worker isolate has 128 MB and the keys are URL-derived.
//   - Keys longer than KV's 512-byte key limit (only possible with absurd URL segments) are not cached in either
//     tier.

import { LOG_PREFIX } from '../env';

export type CacheKind = 'article' | 'translations' | 'list' | 'sp' | 'splist' | 'cp' | 'cpalt';

export const KV_KEY_PREFIX = 'seo:v1';
// Cloudflare KV: keys are at most 512 bytes; expirationTtl must be >= 60 s.
export const KV_MAX_KEY_BYTES = 512;
const KV_MIN_TTL_S = 60;
// A KV read slower than this is a miss (logged). Keeps the 2.5 s budget of middleware.ts meaningful.
export const KV_GET_TIMEOUT_MS = 500;
export const MAP_MAX_ENTRIES = 1000;

export interface CacheEntry<T> {
  data: T;
  expires: number;
  failed?: true;
}

interface KvValue {
  data: unknown;
  expires: number;
  v?: string;
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

export interface TieredCacheOptions {
  // Fingerprint stored as "v" in KV values; a value with another "v" is a miss.
  shape?: string;
  maxEntries?: number;
}

const encoder = new TextEncoder();

export function kvKey(kind: CacheKind, parts: readonly string[]): string {
  return `${KV_KEY_PREFIX}:${kind}:${parts.join(':')}`;
}

export function kvTtlSeconds(ttlMs: number): number {
  return Math.max(KV_MIN_TTL_S, Math.ceil(ttlMs / 1000));
}

// FNV-1a 32-bit, hex. Synchronous and dependency-free; only used to fingerprint short constant strings.
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function logKvError(op: 'get' | 'get_timeout' | 'put', key: string, err?: unknown): void {
  const fields: Record<string, unknown> = { msg: 'seo_kv_error', op, key };
  if (err !== undefined) fields.error = String(err);
  console.error(`${LOG_PREFIX} ${JSON.stringify(fields)}`);
}

function isKvValue(value: unknown): value is KvValue {
  return typeof value === 'object' && value !== null
    && 'data' in value
    && typeof (value as { expires?: unknown }).expires === 'number';
}

type KvRead = { ok: true; value: unknown } | { ok: false; error: unknown } | { ok: false; timeout: true };

export class TieredCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  readonly shape: string;
  readonly maxEntries: number;

  constructor(readonly kind: CacheKind, options: TieredCacheOptions = {}) {
    this.shape = options.shape ?? '';
    this.maxEntries = Math.max(1, options.maxEntries ?? MAP_MAX_ENTRIES);
  }

  // Isolate tier only (synchronous, like middleware.ts's Map check). Expired entries are dropped on read.
  peek(parts: readonly string[]): CacheHit<T> | undefined {
    const mapKey = parts.join(':');
    const cached = this.map.get(mapKey);
    if (!cached) return undefined;
    if (!(cached.expires > Date.now())) {
      this.map.delete(mapKey);
      return undefined;
    }
    return { data: cached.data, failed: cached.failed === true };
  }

  // KV tier only, under KV_GET_TIMEOUT_MS. A hit is copied into the Map.
  async getShared(parts: readonly string[], io: CacheIo): Promise<CacheHit<T> | undefined> {
    const key = this.cacheableKey(parts);
    if (!io.kv || key === null) return undefined;
    const read = await this.readKv(io.kv, key);
    if (!read.ok) {
      if ('timeout' in read) logKvError('get_timeout', key);
      else logKvError('get', key, read.error);
      return undefined;
    }
    const value = read.value;
    if (!isKvValue(value) || !(value.expires > Date.now()) || (value.v ?? '') !== this.shape) return undefined;
    const entry: CacheEntry<T> = { data: value.data as T, expires: value.expires };
    this.store(parts.join(':'), entry);
    return { data: entry.data, failed: false };
  }

  // Map, then KV. Returns undefined on a miss in both tiers.
  async get(parts: readonly string[], io: CacheIo): Promise<CacheHit<T> | undefined> {
    return this.peek(parts) ?? this.getShared(parts, io);
  }

  // Same place and TTL as the Map write of middleware.ts. The KV write is fire-and-forget and skipped for a
  // failed lookup (per-isolate only, as in middleware.ts).
  set(parts: readonly string[], data: T, ttlMs: number, io: CacheIo, failed = false): void {
    const key = this.cacheableKey(parts);
    if (key === null) return;
    const entry: CacheEntry<T> = { data, expires: Date.now() + ttlMs };
    if (failed) entry.failed = true;
    this.store(parts.join(':'), entry);

    if (failed || !io.kv) return;
    const value: KvValue = { data, expires: entry.expires };
    if (this.shape) value.v = this.shape;
    let put: Promise<unknown>;
    try {
      put = io.kv.put(key, JSON.stringify(value), { expirationTtl: kvTtlSeconds(ttlMs) });
    } catch (err) {
      logKvError('put', key, err);
      return;
    }
    io.waitUntil(put.catch((err: unknown) => logKvError('put', key, err)));
  }

  // Tests only.
  get isolateSize(): number {
    return this.map.size;
  }

  // Tests only: drop the isolate tier (simulates a fresh isolate in front of a warm KV).
  clearIsolate(): void {
    this.map.clear();
  }

  private cacheableKey(parts: readonly string[]): string | null {
    const key = kvKey(this.kind, parts);
    return encoder.encode(key).byteLength > KV_MAX_KEY_BYTES ? null : key;
  }

  private store(mapKey: string, entry: CacheEntry<T>): void {
    this.map.delete(mapKey); // re-insert at the end: eviction order is "oldest written first"
    if (this.map.size >= this.maxEntries) {
      const now = Date.now();
      for (const [k, e] of this.map) {
        if (!(e.expires > now)) this.map.delete(k);
      }
      while (this.map.size >= this.maxEntries) {
        const oldest = this.map.keys().next();
        if (oldest.done) break;
        this.map.delete(oldest.value);
      }
    }
    this.map.set(mapKey, entry);
  }

  private async readKv(kv: KVNamespace, key: string): Promise<KvRead> {
    let read: Promise<KvRead>;
    try {
      read = kv.get(key, { type: 'json' }).then(
        (value): KvRead => ({ ok: true, value }),
        (error: unknown): KvRead => ({ ok: false, error }),
      );
    } catch (error) {
      return { ok: false, error };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<KvRead>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, timeout: true }), KV_GET_TIMEOUT_MS);
    });
    try {
      return await Promise.race([read, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
