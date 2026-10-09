// A minimal supabase-js stand-in for the oracles (test/oracles/*.ts): the query-builder calls the copied live code
// makes (select with columns or {count, head}, eq, neq, not(col, 'is', null), in, order, limit, single, update + eq,
// upsert) over in-memory tables, with no PostgREST row cap. Writes are recorded.

type Row = Record<string, unknown>;

export interface FakeSupabase {
  tables: Record<string, Row[]>;
  updates: Array<{ table: string; patch: Row; id: unknown }>;
  upserts: Array<{ table: string; rows: Row[]; options: unknown }>;
  from(table: string): Query;
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private filters: Array<(r: Row) => boolean> = [];
  private columns: string[] | null = null;
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private singleRow = false;
  private head = false;
  private patch: Row | null = null;

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(columns = '*', o?: { count?: string; head?: boolean }): this {
    this.columns = columns.trim() === '*' ? null : columns.split(',').map((c) => c.trim());
    this.head = o?.head === true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value && r[column] !== null && r[column] !== undefined);
    return this;
  }
  not(column: string, op: string, value: unknown): this {
    if (op !== 'is' || value !== null) throw new Error('fake supabase: unsupported not()');
    this.filters.push((r) => r[column] !== null && r[column] !== undefined);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
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
  single(): this {
    this.singleRow = true;
    return this;
  }
  update(patch: Row): this {
    this.patch = patch;
    return this;
  }
  async upsert(rows: Row[], options: unknown): Promise<{ error: null }> {
    this.db.upserts.push({ table: this.table, rows: structuredClone(rows), options });
    return { error: null };
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) {
      for (const r of rows) {
        Object.assign(r, this.patch);
        this.db.updates.push({ table: this.table, patch: structuredClone(this.patch), id: r.id });
      }
      return { data: null, error: null };
    }
    if (this.head) return { data: null, error: null, count: rows.length };
    for (const o of [...this.orderBy].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = String(a[o.column] ?? '');
        const y = String(b[o.column] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (o.ascending ? 1 : -1);
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    const projected = rows.map((r) => {
      if (!this.columns) return structuredClone(r);
      const out: Row = {};
      for (const c of this.columns) out[c] = r[c] ?? null;
      return out;
    });
    if (this.singleRow) {
      return projected.length === 1 ? { data: projected[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not exactly one row' } };
    }
    return { data: projected, error: null };
  }

  then<A = { data: unknown; error: unknown; count?: number }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(tables: Record<string, Row[]>): FakeSupabase {
  const db: FakeSupabase = {
    tables,
    updates: [],
    upserts: [],
    from: (table: string) => new Query(db, table),
  };
  return db;
}
