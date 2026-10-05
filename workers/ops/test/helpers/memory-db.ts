// MemoryDb: the Db port (src/db/postgrest.ts) over in-memory tables for T1 tests: the filters of the port, unique
// keys and on_conflict semantics of the agent-layer tables, and rpc() dispatch to the JavaScript RPCs of
// memory-rpc.ts (unit DB; self-contained so the SQL test package and the mini-PostgREST load the same code).
//
// Rules (the PostgREST behaviour PostgrestDb relies on)
//   - Writes go through memory-rpc's write path: column defaults, the BEFORE triggers, NOT NULL and CHECK
//     constraints and unique keys of the migration; a failed statement changes nothing and throws DbError with the
//     status and SQLSTATE PostgREST would answer.
//   - insert with onConflict: ignore-duplicates returns only the rows it inserted; merge-duplicates returns the
//     inserted or updated rows. returning false answers [] (return=minimal).
//   - Filters: eq/gte/lt compare timestamps as instants, numbers as numbers, everything else as text; in is
//     membership; ov/cs are array overlap/containment; ilike is an exact case-insensitive match (a value containing
//     '*' matches nothing, as PostgrestDb answers); is null/true/false.
//   - Rows are returned as copies; `columns` projects plain column lists ('*' = every column).

import { DbError, unmatchableFilter, type Db, type Filter, type InsertOptions, type Row, type SelectOptions, type UpdateOptions } from '../../src/db/postgrest';
import { MEMORY_RPCS, MemoryRpcError, atomically, insertRow, rowsOf, seedRows, updateRow, upsertRow, type MemoryRpcFn, type MemoryTableSet } from './memory-rpc';

export type MemoryTables = Record<string, Row[]>;

/** One RPC over the tables (mutating them as the SQL function would); `now` is the database clock. */
export type MemoryRpc = (tables: MemoryTables, args: Record<string, unknown>, now: Date) => unknown;

export interface MemoryDbOptions {
  /** Existing rows per table (defaults filled in, no trigger or check, as memory-rpc's seedRows). */
  seed?: MemoryTables;
  /** RPC name -> implementation (default: the RPCs of memory-rpc.ts); an entry here wins over the default. */
  rpc?: Record<string, MemoryRpc>;
  clock?: () => Date;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && (typeof b === 'number' || (typeof b === 'string' && b.trim() !== '' && Number.isFinite(Number(b))))) return a - Number(b);
  if (typeof a === 'string' && typeof b === 'string' && ISO_TIME.test(a) && ISO_TIME.test(b)) return Date.parse(a) - Date.parse(b);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function textOf(v: unknown): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

function eq(a: unknown, b: unknown): boolean {
  if (isNull(a)) return false;
  if (typeof a === 'string' && typeof b === 'string' && ISO_TIME.test(a) && ISO_TIME.test(b)) return Date.parse(a) === Date.parse(b);
  if (typeof a === 'number') return a === Number(b);
  return textOf(a) === textOf(b);
}

export function matches(row: Row, f: Filter): boolean {
  const [column, op, value] = f;
  const v = row[column];
  switch (op) {
    case 'eq':
      return eq(v, value);
    case 'gte':
      return !isNull(v) && compare(v, value) >= 0;
    case 'lt':
      return !isNull(v) && compare(v, value) < 0;
    case 'is':
      return value === null ? isNull(v) : v === value;
    case 'in':
      return !isNull(v) && (value as ReadonlyArray<string | number>).some((x) => eq(v, x));
    case 'ov':
      return Array.isArray(v) && (value as ReadonlyArray<string | number>).some((x) => v.some((y) => eq(y, x)));
    case 'cs':
      return Array.isArray(v) && (value as ReadonlyArray<string | number>).every((x) => v.some((y) => eq(y, x)));
    case 'ilike':
      return typeof v === 'string' && !String(value).includes('*') && v.toLowerCase() === String(value).toLowerCase();
  }
}

function project(row: Row, columns: string | undefined): Row {
  const copy = structuredClone(row);
  if (!columns || columns.trim() === '*') return copy;
  const out: Row = {};
  for (const raw of columns.split(',')) {
    const col = raw.trim();
    if (!col) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`MemoryDb: unsupported select item ${col}`);
    out[col] = copy[col] ?? null;
  }
  return out;
}

function returningColumns(returning: boolean | string | undefined): string | null {
  if (returning === undefined || returning === false) return null;
  return typeof returning === 'string' ? returning : '*';
}

function toDbError(e: unknown): unknown {
  if (e instanceof MemoryRpcError) return new DbError(e.status, e.code, `memory ${e.code}: ${e.message}`);
  return e;
}

export class MemoryDb implements Db {
  readonly tables: MemoryTables;
  /** Every call in order (table or rpc name, method), for assertions on the number of writes. */
  readonly calls: Array<{ method: 'select' | 'insert' | 'update' | 'rpc'; target: string; patch?: Row; args?: Record<string, unknown> }>;
  private readonly rpcs: Record<string, MemoryRpc>;
  private readonly clock: () => Date;

  constructor(o: MemoryDbOptions = {}) {
    this.tables = {};
    this.calls = [];
    this.clock = o.clock ?? (() => new Date());
    this.rpcs = { ...(MEMORY_RPCS as Record<string, MemoryRpcFn>), ...o.rpc } as Record<string, MemoryRpc>;
    for (const [table, rows] of Object.entries(o.seed ?? {})) this.seed(table, rows);
  }

  /** Adds existing rows (defaults filled in, no checks); returns the stored rows. */
  seed(table: string, rows: readonly Row[]): Row[] {
    return seedRows(this.tables as MemoryTableSet, table, rows, this.clock()).map((r) => structuredClone(r));
  }

  /** Copies of the rows of a table, optionally filtered. */
  rows(table: string, ...filters: Filter[]): Row[] {
    return rowsOf(this.tables as MemoryTableSet, table)
      .filter((r) => filters.every((f) => matches(r, f)))
      .map((r) => structuredClone(r));
  }

  async select<T extends Row = Row>(table: string, o: SelectOptions = {}): Promise<T[]> {
    this.calls.push({ method: 'select', target: table });
    if (unmatchableFilter(o.filters)) return [];
    let rows = rowsOf(this.tables as MemoryTableSet, table).filter((r) => (o.filters ?? []).every((f) => matches(r, f)));
    if (o.order?.length) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of o.order ?? []) {
          const av = a[column];
          const bv = b[column];
          if (isNull(av) && isNull(bv)) continue;
          // PostgreSQL default: NULLS LAST ascending, NULLS FIRST descending.
          if (isNull(av)) return ascending === false ? -1 : 1;
          if (isNull(bv)) return ascending === false ? 1 : -1;
          const c = compare(av, bv);
          if (c !== 0) return ascending === false ? -c : c;
        }
        return 0;
      });
    }
    if (o.limit !== undefined) rows = rows.slice(0, o.limit);
    return rows.map((r) => project(r, o.columns) as T);
  }

  async insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o: InsertOptions = {}): Promise<T[]> {
    const list = Array.isArray(rows) ? (rows as readonly Row[]) : [rows as Row];
    this.calls.push({ method: 'insert', target: table });
    const now = this.clock();
    const cols = returningColumns(o.returning);
    try {
      const written = atomically(this.tables as MemoryTableSet, () => {
        const out: Row[] = [];
        for (const row of list) {
          if (o.onConflict?.length) {
            const r = upsertRow(this.tables as MemoryTableSet, table, row, now, { onConflict: o.onConflict, merge: o.ignoreDuplicates === false });
            if (r.inserted || r.updated) out.push(r.row);
          } else {
            out.push(insertRow(this.tables as MemoryTableSet, table, row, now));
          }
        }
        return out;
      });
      return cols ? written.map((r) => project(r, cols) as T) : [];
    } catch (e) {
      throw toDbError(e);
    }
  }

  async update<T extends Row = Row>(table: string, patch: Row, o: UpdateOptions): Promise<T[]> {
    if (!o?.filters?.length) throw new Error('update needs at least one filter');
    this.calls.push({ method: 'update', target: table, patch: structuredClone(patch) });
    if (unmatchableFilter(o.filters)) return [];
    const now = this.clock();
    const cols = returningColumns(o.returning);
    try {
      const written = atomically(this.tables as MemoryTableSet, () => {
        const rows = rowsOf(this.tables as MemoryTableSet, table);
        const out: Row[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (o.filters.every((f) => matches(rows[i], f))) out.push(updateRow(this.tables as MemoryTableSet, table, i, patch, now));
        }
        return out;
      });
      return cols ? written.map((r) => project(r, cols) as T) : [];
    } catch (e) {
      throw toDbError(e);
    }
  }

  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ method: 'rpc', target: name, args: structuredClone(args) });
    const fn = this.rpcs[name];
    if (!fn) throw new DbError(404, 'PGRST202', `memory rpc ${name}: no such function`);
    try {
      return structuredClone(fn(this.tables, structuredClone(args), this.clock())) as T;
    } catch (e) {
      throw toDbError(e);
    }
  }
}
