// In-memory versions of the article-queue RPCs that the Phase 5 content job calls (PHASE5_SPEC §5.10, D-21), for
// T1 (MemoryDb({rpc: P5_MEMORY_RPCS}) of test/helpers/memory-db.ts) and T2 (the mini-PostgREST of
// workers/site/test/integration/stubs/postgrest.mjs). Same semantics as the SQL functions of
// supabase/migrations/20250103_create_article_queue_system.sql:
//
//   enqueue_next_article()                      oldest article_titles row with processed = false (by created_at) ->
//                                               a new article_generation_queue row {title_id, status 'pending',
//                                               retry_count 0, created_at now}; returns its id, or null without a title
//   get_next_queue_job()                        the next queue row with status pending or failed, retry_count < 3 and
//                                               an unprocessed title (pending first, then oldest created_at), marked
//                                               'processing' with started_at now; returns [] or one row
//                                               {queue_id, title_id, title, silo_category, retry_count}
//   mark_queue_job_completed(queue_job_id, article_id)   status 'completed', completed_at now; the title processed =
//                                               true, processed_at now; returns null
//   mark_queue_job_failed(queue_job_id, error_msg)        status 'failed', error_message, retry_count + 1,
//                                               completed_at now; returns null
//
// Self-contained (no runtime imports), so Node can load it with type stripping from the .mjs stub server.
// Nothing in the production code imports this folder.

export type P5MemoryRow = Record<string, unknown>;
export type P5MemoryTables = Record<string, P5MemoryRow[]>;
export type P5MemoryRpc = (tables: P5MemoryTables, args: Record<string, unknown>, now: Date) => unknown;

function rows(tables: P5MemoryTables, name: string): P5MemoryRow[] {
  if (!Array.isArray(tables[name])) tables[name] = [];
  return tables[name] as P5MemoryRow[];
}

function time(v: unknown): number {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function sameId(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function unprocessed(title: P5MemoryRow | undefined): boolean {
  return title !== undefined && title.processed !== true;
}

const enqueueNextArticle: P5MemoryRpc = (tables, _args, now) => {
  const next = rows(tables, 'article_titles')
    .filter((t) => t.processed === false)
    .sort((a, b) => time(a.created_at) - time(b.created_at))[0];
  if (!next) return null;
  const id = crypto.randomUUID();
  rows(tables, 'article_generation_queue').push({
    id,
    title_id: next.id,
    status: 'pending',
    error_message: null,
    retry_count: 0,
    started_at: null,
    completed_at: null,
    created_at: now.toISOString(),
  });
  return id;
};

const getNextQueueJob: P5MemoryRpc = (tables, _args, now) => {
  const titles = rows(tables, 'article_titles');
  const candidates = rows(tables, 'article_generation_queue')
    .filter((q) => (q.status === 'pending' || q.status === 'failed') && count(q.retry_count) < 3)
    .map((q) => ({ q, t: titles.find((t) => sameId(t.id, q.title_id)) }))
    .filter((c) => unprocessed(c.t))
    .sort((a, b) => (a.q.status === 'pending' ? 0 : 1) - (b.q.status === 'pending' ? 0 : 1) || time(a.q.created_at) - time(b.q.created_at));
  const job = candidates[0];
  if (!job || !job.t) return [];
  job.q.status = 'processing';
  job.q.started_at = now.toISOString();
  return [{ queue_id: job.q.id, title_id: job.q.title_id, title: job.t.title ?? null, silo_category: job.t.silo_category ?? null, retry_count: count(job.q.retry_count) }];
};

const markQueueJobCompleted: P5MemoryRpc = (tables, args, now) => {
  const queue = rows(tables, 'article_generation_queue').find((q) => sameId(q.id, args.queue_job_id));
  if (queue) {
    queue.status = 'completed';
    queue.completed_at = now.toISOString();
    const title = rows(tables, 'article_titles').find((t) => sameId(t.id, queue.title_id));
    if (title) {
      title.processed = true;
      title.processed_at = now.toISOString();
    }
  }
  return null;
};

const markQueueJobFailed: P5MemoryRpc = (tables, args, now) => {
  const queue = rows(tables, 'article_generation_queue').find((q) => sameId(q.id, args.queue_job_id));
  if (queue) {
    queue.status = 'failed';
    queue.error_message = typeof args.error_msg === 'string' ? args.error_msg : null;
    queue.retry_count = count(queue.retry_count) + 1;
    queue.completed_at = now.toISOString();
  }
  return null;
};

/** RPC name -> in-memory implementation (the four article-queue functions). */
export const P5_MEMORY_RPCS: Readonly<Record<string, P5MemoryRpc>> = Object.freeze({
  enqueue_next_article: enqueueNextArticle,
  get_next_queue_job: getNextQueueJob,
  mark_queue_job_completed: markQueueJobCompleted,
  mark_queue_job_failed: markQueueJobFailed,
});

/** Unique keys of the Phase 5 business tables (besides the primary key id) that inserts and upserts of the jobs rely
 *  on (live constraints: articles (slug, language); leads source_url and (source, external_id); gsc_monitored_urls
 *  url; xometry_offers code; tenders (country_code, tender_reference)). */
export const P5_UNIQUE_KEYS: Readonly<Record<string, ReadonlyArray<readonly string[]>>> = Object.freeze({
  articles: [['slug', 'language']],
  leads: [['source_url'], ['source', 'external_id']],
  gsc_monitored_urls: [['url']],
  xometry_offers: [['code']],
  tenders: [['country_code', 'tender_reference']],
  article_titles: [],
  article_generation_queue: [],
  article_generation_logs: [],
  monitored_subreddits: [],
  lead_keywords: [],
  tender_connectors: [],
  marketing_campaigns: [],
  marketing_settings: [],
  marketing_subscribers: [],
  marketing_campaign_recipients: [],
  marketing_events: [],
});

/** Columns filled with the write time when an insert leaves them out (the live column defaults now()). */
export const P5_TIME_DEFAULTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  articles: ['created_at', 'updated_at'],
  article_generation_logs: ['created_at'],
  article_generation_queue: ['created_at'],
  gsc_monitored_urls: ['created_at'],
  leads: ['created_at'],
  tenders: ['discovered_at', 'created_at'],
  xometry_offers: ['created_at', 'updated_at'],
  marketing_events: ['created_at'],
});

/** A unique violation with the status and SQLSTATE PostgREST answers (409, 23505). */
export class P5UniqueViolation extends Error {
  readonly status = 409;
  readonly code = '23505';
  readonly details: string;
  constructor(table: string, columns: readonly string[], row: P5MemoryRow) {
    super(`duplicate key value violates unique constraint "${table}_${columns.join('_')}_key"`);
    this.name = 'P5UniqueViolation';
    this.details = `Key (${columns.join(', ')})=(${columns.map((c) => String(row[c] ?? '')).join(', ')}) already exists.`;
  }
}

/** A conflict target that matches no unique key (PostgREST 42P10, HTTP 400). */
export class P5ConflictTargetError extends Error {
  readonly status = 400;
  readonly code = '42P10';
  readonly details = null;
  constructor() {
    super('there is no unique or exclusion constraint matching the ON CONFLICT specification');
    this.name = 'P5ConflictTargetError';
  }
}

function keyOf(row: P5MemoryRow, columns: readonly string[]): string | null {
  const parts: string[] = [];
  for (const c of columns) {
    const v = row[c];
    if (v === null || v === undefined) return null; // NULLs never conflict
    parts.push(typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : JSON.stringify(v));
  }
  return parts.join('\u0000');
}

/** True for the tables whose writes go through p5WriteRow (P5_UNIQUE_KEYS). */
export function isP5Table(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(P5_UNIQUE_KEYS, table);
}

/**
 * INSERT of one row into a Phase 5 table with its unique keys (and the primary key id), or INSERT ... ON CONFLICT
 * (onConflict) DO NOTHING (merge false) / DO UPDATE SET <the given columns> (merge true), as PostgREST sends for
 * resolution=ignore-duplicates / merge-duplicates. Returns the written row, or null when a duplicate was ignored.
 * A conflict on another unique key is an error, as in PostgreSQL.
 */
export function p5WriteRow(tables: P5MemoryTables, table: string, input: P5MemoryRow, now: Date, o: { onConflict?: readonly string[]; merge?: boolean } = {}): P5MemoryRow | null {
  const list = rows(tables, table);
  const keys: ReadonlyArray<readonly string[]> = [['id'], ...(P5_UNIQUE_KEYS[table] ?? [])];
  const next: P5MemoryRow = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) next[k] = v;
  if (next.id === undefined || next.id === null) next.id = crypto.randomUUID();
  for (const c of P5_TIME_DEFAULTS[table] ?? []) if (next[c] === undefined) next[c] = now.toISOString();
  if (o.onConflict?.length) {
    const target = [...o.onConflict].sort().join(',');
    const arbiter = keys.find((k) => [...k].sort().join(',') === target);
    if (!arbiter) throw new P5ConflictTargetError();
    const k = keyOf(next, arbiter);
    const at = k === null ? -1 : list.findIndex((r) => keyOf(r, arbiter) === k);
    if (at >= 0) {
      if (!o.merge) return null;
      const existing = list[at] as P5MemoryRow;
      const merged: P5MemoryRow = { ...existing };
      for (const [c, v] of Object.entries(input)) if (v !== undefined && c !== 'id') merged[c] = v;
      for (const other of keys) {
        const ok = keyOf(merged, other);
        if (ok !== null && list.some((r, i) => i !== at && keyOf(r, other) === ok)) throw new P5UniqueViolation(table, other, merged);
      }
      list[at] = merged;
      return merged;
    }
  }
  for (const k of keys) {
    const key = keyOf(next, k);
    if (key !== null && list.some((r) => keyOf(r, k) === key)) throw new P5UniqueViolation(table, k, next);
  }
  list.push(next);
  return next;
}
