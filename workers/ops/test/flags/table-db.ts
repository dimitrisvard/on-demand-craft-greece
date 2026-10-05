// A small Db (src/db/postgrest.ts) over in-memory tables for the flags tests: reads with the port's filters, writes
// through the write path of test/helpers/memory-rpc.ts (defaults, triggers, CHECK and unique constraints), rpc()
// through MEMORY_RPCS. It records every call, so a test can assert the order of database writes and KV puts.
// A fake KV namespace with bulk reads, a write log and injected put failures is here too.

import { DbError, type Db, type Filter, type InsertOptions, type Row, type SelectOptions, type UpdateOptions } from '../../src/db/postgrest';
import { callRpc, MemoryRpcError, rowsOf, upsertRow, insertRow, updateRow, type MemoryTableSet } from '../helpers/memory-rpc';

export type CallLog = string[];

const isTs = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v);

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  if (isTs(a) && isTs(b)) return Date.parse(a) - Date.parse(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(row: Row, [column, op, value]: Filter): boolean {
  const v = row[column];
  switch (op) {
    case 'eq': return v !== null && v !== undefined && compare(v, value) === 0 && (typeof v !== 'boolean' || v === value);
    case 'gte': return v !== null && v !== undefined && compare(v, value) >= 0;
    case 'lt': return v !== null && v !== undefined && compare(v, value) < 0;
    case 'in': return (value as ReadonlyArray<string | number>).some((x) => v !== null && v !== undefined && compare(v, x) === 0);
    case 'is': return value === null ? v === null || v === undefined : v === value;
    case 'ilike': return typeof v === 'string' && v.toLowerCase() === String(value).toLowerCase();
    case 'ov': return Array.isArray(v) && (value as ReadonlyArray<string | number>).some((x) => v.includes(x));
    case 'cs': return Array.isArray(v) && (value as ReadonlyArray<string | number>).every((x) => v.includes(x));
    default: return false;
  }
}

function project<T extends Row>(row: Row, columns: string | undefined): T {
  if (!columns || columns.trim() === '*') return { ...row } as T;
  const out: Row = {};
  for (const c of columns.split(',').map((x) => x.trim()).filter(Boolean)) out[c] = row[c] ?? null;
  return out as T;
}

function asDbError(e: unknown): unknown {
  return e instanceof MemoryRpcError ? new DbError(e.status, e.code, e.message) : e;
}

export class TableDb implements Db {
  readonly tables: MemoryTableSet;
  readonly log: CallLog;
  clock: () => Date;
  /** Throws this error on the next call whose target matches (then clears it). */
  failNext: { target: string; error: Error } | null = null;

  constructor(tables: MemoryTableSet, log: CallLog, clock: () => Date) {
    this.tables = tables;
    this.log = log;
    this.clock = clock;
  }

  private enter(method: string, target: string, detail?: unknown): void {
    this.log.push(`db.${method} ${target}${typeof detail === 'string' ? ` ${detail}` : ''}`);
    if (this.failNext && this.failNext.target === target) {
      const e = this.failNext.error;
      this.failNext = null;
      throw e;
    }
  }

  async select<T extends Row = Row>(table: string, o: SelectOptions = {}): Promise<T[]> {
    this.enter('select', table);
    let rows = rowsOf(this.tables, table).filter((r) => (o.filters ?? []).every((f) => matches(r, f)));
    for (const ord of [...(o.order ?? [])].reverse()) {
      rows = [...rows].sort((a, b) => (ord.ascending === false ? -1 : 1) * compare(a[ord.column], b[ord.column]));
    }
    if (o.limit !== undefined) rows = rows.slice(0, o.limit);
    return rows.map((r) => project<T>(r, o.columns));
  }

  async insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o: InsertOptions = {}): Promise<T[]> {
    this.enter('insert', table);
    const list = Array.isArray(rows) ? rows : [rows as Row];
    const now = this.clock();
    const out: Row[] = [];
    try {
      for (const r of list) {
        if (o.onConflict) {
          const res = upsertRow(this.tables, table, r, now, { onConflict: o.onConflict, merge: o.ignoreDuplicates === false });
          if (res.inserted || res.updated) out.push(res.row);
        } else {
          out.push(insertRow(this.tables, table, r, now));
        }
      }
    } catch (e) {
      throw asDbError(e);
    }
    if (!o.returning) return [];
    return out.map((r) => project<T>(r, typeof o.returning === 'string' ? o.returning : undefined));
  }

  async update<T extends Row = Row>(table: string, patch: Row, o: UpdateOptions): Promise<T[]> {
    this.enter('update', table);
    const now = this.clock();
    const all = rowsOf(this.tables, table);
    const hits = all.flatMap((r, i) => (o.filters.every((f) => matches(r, f)) ? [i] : []));
    const out: Row[] = [];
    try {
      for (const i of hits) out.push(updateRow(this.tables, table, i, patch, now));
    } catch (e) {
      throw asDbError(e);
    }
    if (!o.returning) return [];
    return out.map((r) => project<T>(r, typeof o.returning === 'string' ? o.returning : undefined));
  }

  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    this.enter('rpc', name, args.p_key);
    try {
      return JSON.parse(JSON.stringify(callRpc(this.tables, name, args, this.clock()))) as T;
    } catch (e) {
      throw asDbError(e);
    }
  }
}

/** KV namespace fake: get (single or bulk text), put; records puts and bulk reads; can fail the next put of a key. */
export class FakeKv {
  readonly map: Map<string, string>;
  readonly log: CallLog;
  readonly failNext = new Set<string>();
  bulkReads = 0;

  constructor(initial: Record<string, string> = {}, log: CallLog = []) {
    this.map = new Map(Object.entries(initial));
    this.log = log;
  }

  async get(key: string | string[], _type?: unknown): Promise<unknown> {
    if (Array.isArray(key)) {
      if (key.length > 100) throw new Error('KV bulk get: at most 100 keys');
      this.bulkReads++;
      this.log.push(`kv.get [${key.length}]`);
      return new Map(key.map((k) => [k, this.map.get(k) ?? null]));
    }
    this.log.push(`kv.get ${key}`);
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failNext.has(key)) {
      this.failNext.delete(key);
      this.log.push(`kv.put ${key} failed`);
      throw new Error('KV PUT failed: 429');
    }
    this.log.push(`kv.put ${key}`);
    this.map.set(key, value);
  }

  asBinding(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
