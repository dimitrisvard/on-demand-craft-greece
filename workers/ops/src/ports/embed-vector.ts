// EmbedPort and VectorPort adapters.
//   WorkersAiEmbed        env.AI.run('@cf/baai/bge-m3', {text}, {gateway}) (production); payload logging off
//   HashEmbed             deterministic unit vectors of 1,024 dimensions from token hashes (T1, and T2 with the
//                         'embed' stub token); priced like bge-m3 so cost accounting runs the same path
//   VectorizeVectors      env.QUOTES_INDEX (production), namespace = tenant id
//   MemoryVectorIndex     cosine similarity in memory with the filter operators $eq, $in, $gte, $lte (T1)
//   R2PersistedVectors    MemoryVectorIndex kept as JSON in the local bucket under __stub/vectors/<ns>.json (T2 with
//                         the 'vector' stub token, so vectors survive between requests of the local Worker)
// Token counts of embedding calls are estimated (characters / 4, rounded up) when the model does not report them.

import { need } from '../agents/config';
import { EMBED_DIMENSIONS, EMBED_MODEL } from '../agents/gateway';
import { embedCostUsd } from '../agents/prices';
import type { OpsEnv } from '../env';
import type { EmbedPort, EmbedUsage, EventsPort, LlmMeta, QuoteVectorMeta, VectorPort } from './index';

export function estimateTokens(texts: readonly string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
}

function embedUsage(tokens: number): EmbedUsage {
  return { input_tokens: tokens, cost_usd: embedCostUsd(EMBED_MODEL, tokens) ?? 0 };
}

export class WorkersAiEmbed implements EmbedPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly events?: EventsPort,
  ) {}

  async embed(texts: string[], meta: LlmMeta): Promise<{ vectors: number[][]; usage: EmbedUsage }> {
    need(this.env, 'AI', 'AI_GATEWAY_ID');
    const started = Date.now();
    const result = (await this.env.AI.run(
      EMBED_MODEL as never,
      { text: texts } as never,
      { gateway: { id: this.env.AI_GATEWAY_ID, metadata: { agent: meta.agent, run_id: meta.run_id, tenant_id: meta.tenant_id, step: meta.step }, collectLog: false } } as never,
    )) as { data?: number[][] };
    const vectors = result?.data ?? [];
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBED_DIMENSIONS)) throw new Error('embedding answer has the wrong shape');
    const usage = embedUsage(estimateTokens(texts));
    this.events?.point({
      event: 'embed_call',
      run_id: meta.run_id,
      agent: meta.agent,
      step: meta.step,
      route: 'embed',
      model: EMBED_MODEL,
      outcome: 'ok',
      tenant_id: meta.tenant_id,
      input_tokens: usage.input_tokens,
      cost_usd: usage.cost_usd,
      latency_ms: Date.now() - started,
      attempt: 1,
    });
    return { vectors, usage };
  }
}

/** FNV-1a 32-bit hash of a string. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic unit vector of a text: every lower-case token adds ±1 at a hashed position. */
export function hashVector(text: string, dims = EMBED_DIMENSIONS): number[] {
  const v = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
  for (const token of tokens) {
    const h = fnv1a(token);
    v[h % dims] += h & 0x80000000 ? -1 : 1;
  }
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

export class HashEmbed implements EmbedPort {
  readonly calls: Array<{ texts: string[]; meta: LlmMeta }> = [];

  async embed(texts: string[], meta: LlmMeta): Promise<{ vectors: number[][]; usage: EmbedUsage }> {
    this.calls.push({ texts: [...texts], meta });
    return { vectors: texts.map((t) => hashVector(t)), usage: embedUsage(estimateTokens(texts)) };
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** True when metadata satisfies a Vectorize-style filter ({field: value} or {field: {$eq|$in|$gte|$lte}}). */
export function matchesFilter(meta: Record<string, unknown>, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true;
  for (const [field, condition] of Object.entries(filter)) {
    const value = meta[field];
    if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
      if (value !== condition) return false;
      continue;
    }
    for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
      if (op === '$eq' && value !== operand) return false;
      if (op === '$in' && !(Array.isArray(operand) && operand.includes(value))) return false;
      if (op === '$gte' && !(typeof value === 'number' && typeof operand === 'number' && value >= operand)) return false;
      if (op === '$lte' && !(typeof value === 'number' && typeof operand === 'number' && value <= operand)) return false;
      if (!['$eq', '$in', '$gte', '$lte'].includes(op)) throw new Error(`unsupported filter operator ${op}`);
    }
  }
  return true;
}

type Stored = { values: number[]; metadata: QuoteVectorMeta };

export class MemoryVectorIndex implements VectorPort {
  readonly namespaces = new Map<string, Map<string, Stored>>();

  async upsert(ns: string, items: Array<{ id: string; values: number[]; metadata: QuoteVectorMeta }>): Promise<void> {
    const space = this.namespaces.get(ns) ?? new Map<string, Stored>();
    for (const item of items) {
      if (item.values.length !== EMBED_DIMENSIONS) throw new Error('vector has the wrong dimensions');
      space.set(item.id, { values: [...item.values], metadata: { ...item.metadata } });
    }
    this.namespaces.set(ns, space);
  }

  async query(ns: string, values: number[], o: { topK: number; filter?: Record<string, unknown> }) {
    const space = this.namespaces.get(ns) ?? new Map<string, Stored>();
    return [...space.entries()]
      .filter(([, s]) => matchesFilter(s.metadata as unknown as Record<string, unknown>, o.filter))
      .map(([id, s]) => ({ id, score: cosine(values, s.values), metadata: s.metadata }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, o.topK);
  }
}

export const STUB_VECTOR_PREFIX = '__stub/vectors/';

export class R2PersistedVectors implements VectorPort {
  constructor(private readonly bucket: R2Bucket) {}

  private key(ns: string): string {
    return `${STUB_VECTOR_PREFIX}${encodeURIComponent(ns)}.json`;
  }

  private async load(ns: string): Promise<MemoryVectorIndex> {
    const index = new MemoryVectorIndex();
    const object = await this.bucket.get(this.key(ns));
    if (object) {
      const entries = (await object.json()) as Array<[string, Stored]>;
      index.namespaces.set(ns, new Map(entries));
    }
    return index;
  }

  async upsert(ns: string, items: Array<{ id: string; values: number[]; metadata: QuoteVectorMeta }>): Promise<void> {
    const index = await this.load(ns);
    await index.upsert(ns, items);
    await this.bucket.put(this.key(ns), JSON.stringify([...(index.namespaces.get(ns) ?? new Map()).entries()]), { httpMetadata: { contentType: 'application/json' } });
  }

  async query(ns: string, values: number[], o: { topK: number; filter?: Record<string, unknown> }) {
    return (await this.load(ns)).query(ns, values, o);
  }
}

export class VectorizeVectors implements VectorPort {
  constructor(private readonly env: OpsEnv) {}

  async upsert(ns: string, items: Array<{ id: string; values: number[]; metadata: QuoteVectorMeta }>): Promise<void> {
    need(this.env, 'QUOTES_INDEX');
    await this.env.QUOTES_INDEX.upsert(items.map((i) => ({ id: i.id, values: i.values, namespace: ns, metadata: i.metadata as unknown as Record<string, VectorizeVectorMetadata> })));
  }

  async query(ns: string, values: number[], o: { topK: number; filter?: Record<string, unknown> }) {
    need(this.env, 'QUOTES_INDEX');
    const result = await this.env.QUOTES_INDEX.query(values, { topK: o.topK, namespace: ns, returnMetadata: 'all', ...(o.filter ? { filter: o.filter as VectorizeVectorMetadataFilter } : {}) });
    return result.matches.map((m) => ({ id: m.id, score: m.score, metadata: (m.metadata ?? {}) as unknown as QuoteVectorMeta }));
  }
}
