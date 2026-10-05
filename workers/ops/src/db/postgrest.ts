// Database port of the agent layer: PostgREST of the Supabase project with the service role (Supabase stays the
// system of record). T1 tests use MemoryDb (test/helpers/memory-db.ts), T2 the mini-PostgREST of the harness.
//
// Rules
//   - Filters: eq, in, ov, cs, ilike, gte, lt, is. An ilike value is matched literally: %, _ and \ are escaped by
//     the Db, so ilike is an exact, case-insensitive match.
//   - insert with onConflict: ignoreDuplicates true sends resolution=ignore-duplicates (an existing row is left as
//     it is and not returned), false sends resolution=merge-duplicates. returning asks for the written rows.
//   - update always has at least one filter (never a table-wide write).
//   - rpc(name, args) calls /rest/v1/rpc/<name> with a JSON body.
//   - Request and response bodies are never logged; errors carry the HTTP status and the PostgREST code only.

export type Row = Record<string, unknown>;

export type Filter =
  | readonly [column: string, op: 'eq' | 'gte' | 'lt', value: string | number | boolean]
  | readonly [column: string, op: 'in' | 'ov' | 'cs', value: ReadonlyArray<string | number>]
  | readonly [column: string, op: 'ilike', value: string]
  | readonly [column: string, op: 'is', value: null | boolean];

export type FilterOp = Filter[1];

export interface SelectOptions {
  /** PostgREST select list; default '*'. */
  columns?: string;
  filters?: readonly Filter[];
  order?: ReadonlyArray<{ column: string; ascending?: boolean }>;
  limit?: number;
}

export interface InsertOptions {
  /** Columns of the unique constraint for on_conflict. */
  onConflict?: readonly string[];
  /** With onConflict: true = ignore-duplicates, false = merge-duplicates (default true). */
  ignoreDuplicates?: boolean;
  /** true = return=representation with every column; a string = that select list. Default: return=minimal. */
  returning?: boolean | string;
}

export interface UpdateOptions {
  /** At least one filter. */
  filters: readonly [Filter, ...Filter[]];
  returning?: boolean | string;
}

export interface Db {
  select<T extends Row = Row>(table: string, o?: SelectOptions): Promise<T[]>;
  insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o?: InsertOptions): Promise<T[]>;
  update<T extends Row = Row>(table: string, patch: Row, o: UpdateOptions): Promise<T[]>;
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** A failed PostgREST call: HTTP status and PostgREST error code (e.g. '23505', 'PGRST116'), no body text. */
export class DbError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'DbError';
    this.status = status;
    this.code = code;
  }
}

export interface PostgrestDbOptions {
  /** SUPABASE_URL (the Db appends /rest/v1). */
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
  /** Per-request timeout; default 10,000 ms. */
  timeoutMs?: number;
}

/** Filters whose value can never match through PostgREST (an ilike value containing '*', which PostgREST reads as a
 *  wildcard): the call answers no rows instead of matching more than the caller asked for. */
export function unmatchableFilter(filters: readonly Filter[] | undefined): boolean {
  return (filters ?? []).some((f) => f[1] === 'ilike' && String(f[2]).includes('*'));
}

/** An ilike value matched literally: %, _ and \ escaped. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A value inside an in.(…) list or an array literal {…}: always double-quoted, " and \ escaped. */
function quoted(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/** The PostgREST query value of one filter (operator and operand, before URL encoding). */
export function filterExpression(f: Filter): string {
  const [, op, value] = f;
  switch (op) {
    case 'eq':
    case 'gte':
    case 'lt':
      return `${op}.${String(value)}`;
    case 'is':
      return `is.${value === null ? 'null' : String(value)}`;
    case 'in':
      return `in.(${(value as ReadonlyArray<string | number>).map(quoted).join(',')})`;
    case 'ov':
    case 'cs':
      return `${op}.{${(value as ReadonlyArray<string | number>).map(quoted).join(',')}}`;
    case 'ilike':
      return `ilike.${escapeLike(String(value))}`;
  }
}

/** Query string of a request (filters, select, order, limit, on_conflict); URLSearchParams encodes every value. */
export function queryString(o: { filters?: readonly Filter[]; select?: string; order?: SelectOptions['order']; limit?: number; onConflict?: readonly string[] }): string {
  const params = new URLSearchParams();
  if (o.select) params.append('select', o.select);
  for (const f of o.filters ?? []) {
    if (!/^[a-z_][a-z0-9_]*$/.test(f[0])) throw new Error(`invalid filter column: ${f[0]}`);
    params.append(f[0], filterExpression(f));
  }
  if (o.order?.length) params.append('order', o.order.map((x) => `${x.column}.${x.ascending === false ? 'desc' : 'asc'}`).join(','));
  if (o.limit !== undefined) params.append('limit', String(o.limit));
  if (o.onConflict?.length) params.append('on_conflict', o.onConflict.join(','));
  const text = params.toString();
  return text ? `?${text}` : '';
}

function checkName(kind: string, name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid ${kind} name: ${name}`);
}

function returnPreference(returning: boolean | string | undefined): { prefer: string; select?: string } {
  if (returning === undefined || returning === false) return { prefer: 'return=minimal' };
  return { prefer: 'return=representation', select: typeof returning === 'string' ? returning : undefined };
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class PostgrestDb implements Db {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: PostgrestDbOptions) {
    if (!o.url || !o.serviceRoleKey) throw new Error('PostgrestDb needs url and serviceRoleKey');
    this.base = `${o.url.replace(/\/+$/, '')}/rest/v1`;
    this.key = o.serviceRoleKey;
    this.fetchImpl = o.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(method: 'GET' | 'POST' | 'PATCH', path: string, target: string, body?: unknown, prefer?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (prefer) headers.prefer = prefer;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new DbError(0, timeout ? 'timeout' : 'network', `postgrest ${method} ${target}: ${timeout ? 'timeout' : 'network error'}`);
    }
    const text = await response.text();
    if (!response.ok) {
      let code: string | null = null;
      try {
        const parsed = JSON.parse(text) as { code?: unknown };
        if (typeof parsed.code === 'string') code = parsed.code;
      } catch {
        // not JSON: the status alone is reported
      }
      throw new DbError(response.status, code, `postgrest ${method} ${target}: ${response.status}${code ? ` ${code}` : ''}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new DbError(response.status, 'invalid_json', `postgrest ${method} ${target}: unreadable answer`);
    }
  }

  async select<T extends Row = Row>(table: string, o: SelectOptions = {}): Promise<T[]> {
    checkName('table', table);
    if (unmatchableFilter(o.filters)) return [];
    const qs = queryString({ filters: o.filters, select: o.columns ?? '*', order: o.order, limit: o.limit });
    const rows = await this.request('GET', `/${table}${qs}`, table);
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  async insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o: InsertOptions = {}): Promise<T[]> {
    checkName('table', table);
    const ret = returnPreference(o.returning);
    const prefer = [ret.prefer];
    if (o.onConflict?.length) prefer.unshift(o.ignoreDuplicates === false ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates');
    const qs = queryString({ select: ret.select, onConflict: o.onConflict });
    const result = await this.request('POST', `/${table}${qs}`, table, rows, prefer.join(','));
    return Array.isArray(result) ? (result as T[]) : [];
  }

  async update<T extends Row = Row>(table: string, patch: Row, o: UpdateOptions): Promise<T[]> {
    checkName('table', table);
    if (!o?.filters?.length) throw new Error('update needs at least one filter');
    if (unmatchableFilter(o.filters)) return [];
    const ret = returnPreference(o.returning);
    const qs = queryString({ filters: o.filters, select: ret.select });
    const result = await this.request('PATCH', `/${table}${qs}`, table, patch, ret.prefer);
    return Array.isArray(result) ? (result as T[]) : [];
  }

  async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    checkName('rpc', name);
    return (await this.request('POST', `/rpc/${name}`, `rpc/${name}`, args)) as T;
  }
}
