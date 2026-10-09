// Stand-in for https://esm.sh/@supabase/supabase-js@2.39.0: a recording fake of the parts leads-api uses.
// Tests set `fakeSupabase.users` (token -> user id or an error status) and `fakeSupabase.roles` (user id -> roles),
// and read `fakeSupabase.calls` (every table query, in order).
type Row = Record<string, unknown>;

interface FakeState {
  users: Record<string, string | { status: number }>;
  roles: Record<string, string[]>;
  rolesError: boolean;
  tableRows: Row[];
  calls: string[];
  reset(): void;
}

const holder = globalThis as { __fakeSupabase?: FakeState };
export const fakeSupabase: FakeState = (holder.__fakeSupabase ??= {
  users: {},
  roles: {},
  rolesError: false,
  tableRows: [],
  calls: [],
  reset() {
    this.users = {};
    this.roles = {};
    this.rolesError = false;
    this.tableRows = [];
    this.calls = [];
  },
});

function query(table: string) {
  const filters: string[] = [];
  const result = () => {
    fakeSupabase.calls.push(`${table}${filters.length ? ' ' + filters.join(' ') : ''}`);
    if (table === 'user_roles') {
      if (fakeSupabase.rolesError) return Promise.resolve({ data: null, error: { message: 'db down' } });
      const uid = filters.find((f) => f.startsWith('user_id='))?.slice('user_id='.length) ?? '';
      return Promise.resolve({ data: (fakeSupabase.roles[uid] ?? []).map((role) => ({ role })), error: null });
    }
    return Promise.resolve({ data: fakeSupabase.tableRows, error: null, count: fakeSupabase.tableRows.length });
  };
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'order', 'range', 'gte', 'contains', 'or', 'insert', 'update', 'delete', 'limit']) {
    chain[name] = () => chain;
  }
  chain.eq = (column: string, value: unknown) => {
    filters.push(`${column}=${String(value)}`);
    return chain;
  };
  chain.single = () => result();
  chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => result().then(ok, ko);
  return chain;
}

export function createClient(_url: string, _key: string) {
  return {
    auth: {
      async getUser(jwt: string) {
        const user = fakeSupabase.users[jwt];
        if (user === undefined) return { data: { user: null }, error: { status: 401, message: 'invalid JWT' } };
        if (typeof user !== 'string') return { data: { user: null }, error: { status: user.status, message: 'upstream' } };
        return { data: { user: { id: user } }, error: null };
      },
    },
    from: (table: string) => query(table),
  };
}
