// Stand-in for src/integrations/supabase/client.ts in the frontend helper tests.
// Tests drive it through `supabaseMock` (session, table rows, storage listing).
// The state lives on globalThis so that every copy of this module (tests call
// vi.resetModules()) shares it.

type Row = Record<string, unknown>;

interface SupabaseMockState {
  accessToken: string | null;
  sessionError: Error | null;
  tableRows: Row[];
  storageList: Array<{ name: string }>;
  reset(): void;
}

const holder = globalThis as { __supabaseMockState?: SupabaseMockState };

export const supabaseMock: SupabaseMockState = (holder.__supabaseMockState ??= {
  accessToken: null,
  sessionError: null,
  tableRows: [],
  storageList: [],
  reset(): void {
    this.accessToken = null;
    this.sessionError = null;
    this.tableRows = [];
    this.storageList = [];
  },
});

function query(): Record<string, unknown> {
  const result = () => Promise.resolve({ data: supabaseMock.tableRows, error: null });
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'delete', 'upsert']) {
    chain[name] = () => chain;
  }
  chain.single = result;
  chain.maybeSingle = result;
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    result().then(onFulfilled, onRejected);
  return chain;
}

export const supabase = {
  auth: {
    getSession: async () => {
      if (supabaseMock.sessionError) throw supabaseMock.sessionError;
      return {
        data: { session: supabaseMock.accessToken ? { access_token: supabaseMock.accessToken } : null },
        error: null,
      };
    },
  },
  from: () => query(),
  storage: {
    from: () => ({
      list: async () => ({ data: supabaseMock.storageList, error: null }),
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.example/${path}` }, error: null }),
    }),
  },
};
