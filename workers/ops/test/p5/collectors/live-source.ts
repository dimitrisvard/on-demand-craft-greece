// Test-only oracles of unit G5: the live edge functions reddit-collector (version 15) and hn-collector (version 7)
// run unchanged from their repository copies (supabase/functions/<name>/index.ts, equal to the deployed sources), so
// the Worker port is compared with the live code on the same inputs. Nothing is copied into this file: the source
// is read at test time, its TypeScript types are stripped by Node (module.stripTypeScriptTypes), the import lines are
// dropped, and the module body runs inside a function that supplies Deno, serve, createClient, fetch, console and
// setTimeout. The returned object exposes the live matchKeywords and sendTelegramNotification and the request
// handler the module registered with serve / Deno.serve.
//
// fakeSupabase(db) is a minimal supabase-js client over a P5MemoryDb (the same unique keys and conflict handling the
// port's Db sees): from(t).select(cols).eq().lte().order().limit().maybeSingle()/single(), upsert(row, {onConflict,
// ignoreDuplicates}), update(patch).eq(), rpc(name, args).maybeSingle(). An absent RPC answers an error, as
// PostgREST does for increment_keyword_match_count today.

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DbError, type Row } from '../../../src/db/postgrest';
import type { P5MemoryDb } from '../../../src/ports/p5-stub/index';

export const REPO_ROOT = new URL('../../../../../', import.meta.url);

export type LiveName = 'reddit-collector' | 'hn-collector';

export function liveSourcePath(name: LiveName): string {
  return new URL(`supabase/functions/${name}/index.ts`, REPO_ROOT).pathname;
}

export interface SupabaseCall {
  table: string;
  op: 'select' | 'upsert' | 'update' | 'rpc';
  args?: unknown;
}

type Pred = (r: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: SupabaseCall['op'] = 'select';
  private cols = '*';
  private preds: Pred[] = [];
  private eqs: Array<[string, unknown]> = [];
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private single: 'no' | 'maybe' | 'one' = 'no';
  private payload: unknown = null;
  private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(
    private readonly db: P5MemoryDb,
    private readonly table: string,
    private readonly calls: SupabaseCall[],
  ) {}

  select(cols = '*'): this {
    this.cols = cols;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.preds.push((r) => r[column] === value);
    this.eqs.push([column, value]);
    return this;
  }
  lte(column: string, value: number): this {
    this.preds.push((r) => r[column] !== null && r[column] !== undefined && (r[column] as number) <= value);
    return this;
  }
  order(column: string, o?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: o?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.single = 'maybe';
    return this;
  }
  upsert(row: unknown, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = 'upsert';
    this.payload = row;
    this.options = options;
    return this;
  }
  update(patch: unknown): this {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  rpcCall(args: unknown): this {
    this.op = 'rpc';
    this.payload = args;
    return this;
  }

  private async exec(): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ table: this.table, op: this.op, args: this.op === 'select' ? { cols: this.cols } : this.payload });
    if (this.op === 'rpc') return { data: null, error: { message: `Could not find the function public.${this.table}` } };
    if (this.op === 'upsert') {
      try {
        await this.db.insert(this.table, this.payload as Row, {
          onConflict: this.options.onConflict ? this.options.onConflict.split(',') : undefined,
          ignoreDuplicates: this.options.ignoreDuplicates !== false,
        });
        return { data: null, error: null };
      } catch (e) {
        if (e instanceof DbError) return { data: null, error: { message: e.message } };
        throw e;
      }
    }
    if (this.op === 'update') {
      const [first, ...rest] = this.eqs.map(([c, v]) => [c, 'eq', v as string] as const);
      if (!first) throw new Error('fake supabase: update without a filter');
      await this.db.update(this.table, this.payload as Row, { filters: [first, ...rest] });
      return { data: null, error: null };
    }
    let rows = this.db.rows(this.table).filter((r) => this.preds.every((p) => p(r)));
    if (this.orderBy.length) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of this.orderBy) {
          const x = a[column];
          const y = b[column];
          const xn = x === null || x === undefined;
          const yn = y === null || y === undefined;
          if (xn && yn) continue;
          // PostgreSQL defaults: NULLS LAST ascending, NULLS FIRST descending.
          if (xn) return ascending ? 1 : -1;
          if (yn) return ascending ? -1 : 1;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          if (c !== 0) return ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    const projected = this.cols.trim() === '*'
      ? rows
      : rows.map((r) => Object.fromEntries(this.cols.split(',').map((c) => c.trim()).filter(Boolean).map((c) => [c, r[c] ?? null])));
    if (this.single === 'maybe') return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export interface FakeSupabase {
  calls: SupabaseCall[];
  from(table: string): FakeQuery;
  rpc(name: string, args: unknown): FakeQuery;
}

export function fakeSupabase(db: P5MemoryDb): FakeSupabase {
  const calls: SupabaseCall[] = [];
  return {
    calls,
    from: (table) => new FakeQuery(db, table, calls),
    rpc: (name, args) => new FakeQuery(db, name, calls).rpcCall(args),
  };
}

export interface LiveRuntime {
  env: Record<string, string | undefined>;
  supabase: FakeSupabase;
  /** Every fetch of the live module (sources and Telegram). */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface LiveCollector {
  matchKeywords: (text: string, keywords: Array<{ keyword: string; category: string; weight: number | null }>) => {
    matched: string[];
    categories: string[];
    score: string;
    scoreValue?: number;
  };
  sendTelegramNotification: (post: unknown, match: { matched: string[]; categories: string[]; score: string }) => Promise<void>;
  /** The request handler registered with serve (reddit) or Deno.serve (hn). */
  handler: (req: Request) => Promise<Response>;
}

/** The live module's source with its types stripped and its import lines removed. */
export function liveModuleBody(name: LiveName): string {
  const source = readFileSync(liveSourcePath(name), 'utf8');
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  return stripped.replace(/^import [^\n]*;$/gm, '');
}

/** Runs the live module once in a fresh scope and returns its functions (see the header). */
export function loadLive(name: LiveName, rt: LiveRuntime): LiveCollector {
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const register = (h: (req: Request) => Promise<Response>) => {
    handler = h;
  };
  const Deno = { env: { get: (k: string) => rt.env[k] }, serve: register };
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  const immediate = (fn: () => void) => {
    fn();
    return 0;
  };
  const body = `${liveModuleBody(name)}\nreturn { matchKeywords, sendTelegramNotification };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('Deno', 'serve', 'createClient', 'fetch', 'console', 'setTimeout', body) as (...a: unknown[]) => Omit<LiveCollector, 'handler'>;
  const fns = factory(Deno, register, () => rt.supabase, rt.fetch, quiet, immediate);
  if (!handler) throw new Error(`${name}: the live module registered no handler`);
  return { ...fns, handler };
}
