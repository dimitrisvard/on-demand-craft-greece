// Test-only oracles of unit M5: the repository's send-campaign, process-followups and process-warmup edge functions
// (supabase/functions/<name>/index.ts) run unchanged, so the Worker port is compared with them on the same inputs.
// Nothing is copied into this file: the source is read at test time, its TypeScript types are stripped by Node
// (module.stripTypeScriptTypes), the import lines are dropped, and the module body runs inside a function that
// supplies Deno, serve, createClient, Resend, fetch, console and a seeded Math.random. The returned object exposes
// the module's own functions and the request handler it registered with serve.
//
// oracleSupabase(tables) is a small supabase-js stand-in over plain arrays for exactly the query shapes these three
// functions use: select (column list, '*', and the embedded marketing_subscribers(...) / marketing_campaigns(...)
// resources), eq, gt, in, order, limit, single, maybeSingle, a direct await, insert(...).select('id').single(),
// update(patch).eq(). Every write is recorded.

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export const REPO_ROOT = new URL('../../../../../', import.meta.url);

export type RepoFunction = 'send-campaign' | 'process-followups' | 'process-warmup';

type Row = Record<string, unknown>;

export function repoSourcePath(name: RepoFunction): string {
  return new URL(`supabase/functions/${name}/index.ts`, REPO_ROOT).pathname;
}

/** A deterministic random source (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OracleWrite {
  table: string;
  op: 'insert' | 'update';
  row: Row;
  id?: unknown;
}

export interface OracleSupabase {
  tables: Record<string, Row[]>;
  writes: OracleWrite[];
  /** Id given to the next marketing_events insert (by the test), else a counter id. */
  nextEventId?: (row: Row) => string;
  from(table: string): OracleQuery;
}

function embedSpec(columns: string): { plain: string[] | null; embeds: Array<{ table: string; cols: string[] }> } {
  const embeds: Array<{ table: string; cols: string[] }> = [];
  const rest = columns.replace(/(\w+)\(([^)]*)\)/g, (_m, table: string, cols: string) => {
    embeds.push({ table, cols: cols.split(',').map((c) => c.trim()).filter(Boolean) });
    return '';
  });
  const plain = rest.split(',').map((c) => c.trim()).filter(Boolean);
  return { plain: plain.includes('*') ? null : plain, embeds };
}

const FK: Record<string, string> = { marketing_subscribers: 'subscriber_id', marketing_campaigns: 'campaign_id' };

class OracleQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private columns = '*';
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private patch: Row | null = null;
  private insertRow: Row | null = null;

  constructor(private readonly sb: OracleSupabase, private readonly table: string) {}

  select(columns = '*'): this {
    this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  gt(column: string, value: number): this {
    this.filters.push((r) => typeof r[column] === 'number' && (r[column] as number) > value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  order(column: string, o: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: o.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.mode = 'single';
    return this;
  }
  maybeSingle(): this {
    this.mode = 'maybe';
    return this;
  }
  insert(row: Row): this {
    this.insertRow = row;
    return this;
  }
  update(patch: Row): this {
    this.patch = patch;
    return this;
  }

  private rows(): Row[] {
    return (this.sb.tables[this.table] ??= []);
  }

  private run(): { data: unknown; error: unknown } {
    if (this.insertRow) {
      const id = this.sb.nextEventId ? this.sb.nextEventId(this.insertRow) : `ev-${this.rows().length + 1}`;
      const row = { id, created_at: new Date().toISOString(), ...this.insertRow };
      this.rows().push(row);
      this.sb.writes.push({ table: this.table, op: 'insert', row: structuredClone(this.insertRow), id });
      return { data: { id }, error: null };
    }
    let list = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) {
      for (const r of list) Object.assign(r, this.patch);
      for (const r of list) this.sb.writes.push({ table: this.table, op: 'update', row: structuredClone(this.patch), id: r.id });
      return { data: null, error: null };
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      list = [...list].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (this.limitN !== null) list = list.slice(0, this.limitN);
    const spec = embedSpec(this.columns);
    const shaped = list.map((r) => {
      const out: Row = spec.plain ? Object.fromEntries(spec.plain.map((c) => [c, r[c] ?? null])) : structuredClone(r);
      for (const e of spec.embeds) {
        const fk = FK[e.table] as string;
        const target = (this.sb.tables[e.table] ?? []).find((x) => x.id === r[fk]);
        out[e.table] = target ? Object.fromEntries(e.cols.map((c) => [c, target[c] ?? null])) : null;
      }
      return out;
    });
    if (this.mode === 'single') return shaped.length === 1 ? { data: shaped[0], error: null } : { data: null, error: { message: 'not exactly one row' } };
    if (this.mode === 'maybe') return shaped.length <= 1 ? { data: shaped[0] ?? null, error: null } : { data: null, error: { message: 'more than one row' } };
    return { data: shaped, error: null };
  }

  then<A = { data: unknown; error: unknown }, B = never>(onFulfilled?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, onRejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }
}

export function oracleSupabase(tables: Record<string, Row[]>): OracleSupabase {
  const sb: OracleSupabase = {
    tables,
    writes: [],
    from: (table: string) => new OracleQuery(sb, table),
  };
  return sb;
}

export interface OracleMail {
  via: 'resend' | 'gmail';
  apiKey?: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export interface RepoModule {
  fns: Record<string, (...args: never[]) => unknown>;
  handler: (req: Request) => Promise<Response>;
  mails: OracleMail[];
}

/** The repo module's body with its types stripped and its import lines removed. */
export function repoModuleBody(name: RepoFunction): string {
  const source = readFileSync(repoSourcePath(name), 'utf8');
  return stripTypeScriptTypes(source, { mode: 'strip' }).replace(/^import [^\n]*;$/gm, '');
}

/** Runs a repo function's module once in a fresh scope (see the header). */
export function loadRepo(name: RepoFunction, o: { env: Record<string, string>; supabase: OracleSupabase; random: () => number; resendId?: (n: number) => string; fetch?: typeof fetch; exportNames: string[] }): RepoModule {
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const mails: OracleMail[] = [];
  const Deno = { env: { get: (k: string) => o.env[k] } };
  const serve = (h: (req: Request) => Promise<Response>) => {
    handler = h;
  };
  class Resend {
    constructor(private readonly key: string | undefined) {}
    emails = {
      send: async (m: { from: string; to: string[]; subject: string; html: string }) => {
        mails.push({ via: 'resend', apiKey: this.key, from: m.from, to: m.to, subject: m.subject, html: m.html });
        return { data: { id: (o.resendId ?? ((n: number) => `resend-${n}`))(mails.length) }, error: null };
      },
    };
  }
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  const SeededMath = Object.create(Math) as Math;
  Object.defineProperty(SeededMath, 'random', { value: o.random });
  const body = `${repoModuleBody(name)}\nreturn { ${o.exportNames.join(', ')} };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('Deno', 'serve', 'createClient', 'Resend', 'fetch', 'console', 'Math', body) as (...a: unknown[]) => Record<string, (...args: never[]) => unknown>;
  const fns = factory(Deno, serve, () => o.supabase, Resend, o.fetch ?? (async () => new Response('{}', { status: 500 })), quiet, SeededMath);
  if (!handler) throw new Error(`${name}: the repo module registered no handler`);
  return { fns, handler, mails };
}
