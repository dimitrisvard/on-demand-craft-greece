// W-1: src/lib/agentDb.ts, the dashboard's reads of the agent tables.
//   - isMissingTable: PGRST205, 42P01, or 404 naming the schema cache; nothing else
//   - a missing table throws AgentNotInstalledError (the pages show "not installed" and stop); other errors throw
//     AgentDbError
//   - each query reads the documented table, columns, filters, order and bounds (recorded on a fake client)
//   - e-mail masking for lists
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agentRetry,
  AgentDbError,
  AgentNotInstalledError,
  isNotInstalled,
  pollAfterSuccess,
  APPROVALS_LIMIT,
  createAgentQueries,
  INBOX_PAGE_SIZE,
  isMissingTable,
  maskEmail,
  PENDING_COLUMNS,
  QUOTE_FINAL_STATUSES,
  rowsOf,
} from '@/lib/agentDb';

type Call = [string, ...unknown[]];

interface Answer {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
}

/** A supabase-js stand-in: records every builder call per from() and answers per table. */
function fakeClient(answers: Record<string, Answer | Answer[]>) {
  const queries: Array<{ table: string; calls: Call[] }> = [];
  const used: Record<string, number> = {};
  const client = {
    from(table: string) {
      const entry = { table, calls: [] as Call[] };
      queries.push(entry);
      const answerFor = (): Answer => {
        const a = answers[table] ?? { data: [], error: null, status: 200 };
        if (!Array.isArray(a)) return a;
        const i = used[table] ?? 0;
        used[table] = i + 1;
        return a[Math.min(i, a.length - 1)];
      };
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'in', 'not', 'order', 'range', 'limit']) {
        builder[name] = (...args: unknown[]) => {
          entry.calls.push([name, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => {
        entry.calls.push(['maybeSingle']);
        const a = answerFor();
        return Promise.resolve({ ...a, data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data });
      };
      builder.then = (ok: (v: Answer) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(answerFor()).then(ok, err);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

const MISSING: Answer = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.inbound_emails' in the schema cache" }, status: 404 };

describe('isMissingTable', () => {
  it('PGRST205, 42P01, or HTTP 404 with "schema cache" in the message', () => {
    expect(isMissingTable({ code: 'PGRST205', message: 'x' }, 404)).toBe(true);
    expect(isMissingTable({ code: '42P01', message: 'relation "public.agent_runs" does not exist' }, 404)).toBe(true);
    expect(isMissingTable({ code: '', message: 'Could not find the table in the Schema Cache' }, 404)).toBe(true);
  });

  it('anything else is not a missing table', () => {
    expect(isMissingTable(null, 404)).toBe(false);
    expect(isMissingTable({ code: '', message: 'Not Found' }, 404)).toBe(false);
    expect(isMissingTable({ code: '', message: 'schema cache' }, 500)).toBe(false);
    expect(isMissingTable({ code: '42501', message: 'permission denied for table agent_runs' }, 403)).toBe(false);
    expect(isMissingTable({ code: 'PGRST301', message: 'JWT expired' }, 401)).toBe(false);
  });

  it('rowsOf: rows, AgentNotInstalledError for a missing table, AgentDbError otherwise', () => {
    expect(rowsOf({ data: [{ id: 1 }], error: null })).toEqual([{ id: 1 }]);
    expect(rowsOf({ data: null, error: null })).toEqual([]);
    expect(() => rowsOf(MISSING)).toThrow(AgentNotInstalledError);
    expect(() => rowsOf({ data: null, error: { code: '42501', message: 'permission denied' }, status: 403 })).toThrow(AgentDbError);
    try {
      rowsOf({ data: null, error: { code: '42501', message: 'permission denied' }, status: 403 });
    } catch (e) {
      expect([(e as AgentDbError).code, (e as AgentDbError).status]).toEqual(['42501', 403]);
    }
  });
});

describe('queries', () => {
  it('listInbound: newest first, 50 per page, filters only when set', async () => {
    const { client, queries } = fakeClient({ inbound_emails: { data: [{ id: 'a' }], error: null, status: 200 } });
    const q = createAgentQueries(client);
    expect(await q.listInbound()).toEqual([{ id: 'a' }]);
    await q.listInbound({ status: 'needs_review', mailbox: 'rfq', kind: 'all', page: 1 });
    expect(queries[0].table).toBe('inbound_emails');
    const first = queries[0].calls;
    expect(first[0][0]).toBe('select');
    expect(String(first[0][1])).not.toContain('body_excerpt');
    expect(first.slice(1)).toEqual([
      ['order', 'received_at', { ascending: false }],
      ['range', 0, INBOX_PAGE_SIZE - 1],
    ]);
    expect(queries[1].calls.slice(1)).toEqual([
      ['eq', 'status', 'needs_review'],
      ['eq', 'mailbox', 'rfq'],
      ['order', 'received_at', { ascending: false }],
      ['range', 50, 99],
    ]);
  });

  it('getInbound reads the list columns of one message (no body)', async () => {
    const { client, queries } = fakeClient({ inbound_emails: { data: [{ id: 'm1' }], error: null } });
    expect(await createAgentQueries(client).getInbound('m1')).toEqual({ id: 'm1' });
    expect(queries[0].calls[0][0]).toBe('select');
    expect(String(queries[0].calls[0][1])).not.toContain('body_excerpt');
    expect(queries[0].calls.slice(1)).toEqual([['eq', 'id', 'm1'], ['maybeSingle']]);
  });

  it('inboundExcerpt reads body_excerpt of one message only', async () => {
    const { client, queries } = fakeClient({ inbound_emails: { data: [{ body_excerpt: 'Hello <b>there</b>' }], error: null } });
    expect(await createAgentQueries(client).inboundExcerpt('id-1')).toBe('Hello <b>there</b>');
    expect(queries[0].calls).toEqual([['select', 'body_excerpt'], ['eq', 'id', 'id-1'], ['maybeSingle']]);
  });

  it('pendingIntakeRun: the waiting run of the message with a token hash', async () => {
    const run = { id: 'r1', status: 'waiting_human', approval_token_sha256: 'a'.repeat(64) };
    const { client, queries } = fakeClient({ agent_runs: { data: [run], error: null } });
    expect(await createAgentQueries(client).pendingIntakeRun('mail-1')).toEqual(run);
    expect(queries[0].calls.slice(1)).toEqual([
      ['eq', 'subject_type', 'inbound_email'],
      ['eq', 'subject_id', 'mail-1'],
      ['eq', 'status', 'waiting_human'],
      ['not', 'approval_token_sha256', 'is', null],
      ['order', 'updated_at', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('listPendingApprovals: waiting runs with a token hash, oldest update first, bounded', async () => {
    const { client, queries } = fakeClient({ agent_runs: { data: [], error: null } });
    await createAgentQueries(client).listPendingApprovals();
    expect(queries[0].calls).toEqual([
      ['select', PENDING_COLUMNS],
      ['eq', 'status', 'waiting_human'],
      ['not', 'approval_token_sha256', 'is', null],
      ['order', 'updated_at', { ascending: true }],
      ['limit', APPROVALS_LIMIT],
    ]);
  });

  it('listRfqsWithoutQuote: draft/received RFQs minus those with an active quote', async () => {
    const rfqs = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const { client, queries } = fakeClient({ rfqs: { data: rfqs, error: null }, quote_workflows: { data: [{ rfq_id: 'r2' }], error: null } });
    expect(await createAgentQueries(client).listRfqsWithoutQuote()).toEqual([{ id: 'r1' }, { id: 'r3' }]);
    expect(queries[0].calls[1]).toEqual(['in', 'status', ['draft', 'received']]);
    expect(queries[1].calls.slice(1)).toEqual([
      ['in', 'rfq_id', ['r1', 'r2', 'r3']],
      ['not', 'status', 'in', `(${QUOTE_FINAL_STATUSES.join(',')})`],
    ]);
  });

  it('listRfqsWithoutQuote with no candidate RFQ reads no quotes', async () => {
    const { client, queries } = fakeClient({ rfqs: { data: [], error: null } });
    expect(await createAgentQueries(client).listRfqsWithoutQuote()).toEqual([]);
    expect(queries.map((q) => q.table)).toEqual(['rfqs']);
  });

  it('listFlags ordered by key; listAgentRuns newest 50, filtered by agent when given', async () => {
    const { client, queries } = fakeClient({});
    const q = createAgentQueries(client);
    await q.listFlags();
    await q.listAgentRuns();
    await q.listAgentRuns('mcp');
    expect(queries[0].calls.slice(1)).toEqual([['order', 'key', { ascending: true }]]);
    expect(queries[1].calls.slice(1)).toEqual([['order', 'started_at', { ascending: false }], ['limit', 50]]);
    expect(queries[2].calls.slice(1)).toEqual([['eq', 'agent', 'mcp'], ['order', 'started_at', { ascending: false }], ['limit', 50]]);
  });

  it('every query throws AgentNotInstalledError when its table is missing', async () => {
    const all = { inbound_emails: MISSING, agent_runs: MISSING, quote_workflows: MISSING, feature_flags: MISSING, rfqs: MISSING };
    const q = createAgentQueries(fakeClient(all).client);
    for (const call of [() => q.listInbound(), () => q.getInbound('x'), () => q.inboundExcerpt('x'), () => q.pendingIntakeRun('x'), () => q.listPendingApprovals(), () => q.getQuoteWorkflow('x'), () => q.listRfqsWithoutQuote(), () => q.listFlags(), () => q.listAgentRuns()]) {
      await expect(call()).rejects.toBeInstanceOf(AgentNotInstalledError);
    }
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('hans.mueller@example.de')).toBe('h***@example.de');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
    expect(maskEmail('no-at-sign')).toBe('');
    expect(maskEmail('@example.com')).toBe('');
    expect(maskEmail('x@')).toBe('');
    expect(maskEmail(null)).toBe('');
  });
});

describe('query policies', () => {
  it('a missing table is never retried and never polled; other errors retry once; polling only after success', () => {
    expect(agentRetry(0, new AgentNotInstalledError())).toBe(false);
    expect(agentRetry(0, new AgentDbError('x', null, 500))).toBe(true);
    expect(agentRetry(1, new AgentDbError('x', null, 500))).toBe(false);
    expect(isNotInstalled(new AgentNotInstalledError())).toBe(true);
    expect(isNotInstalled(new Error('x'))).toBe(false);
    const poll = pollAfterSuccess(30_000);
    expect(poll({ state: { status: 'success' } })).toBe(30_000);
    expect(poll({ state: { status: 'error' } })).toBe(false);
    expect(poll({ state: { status: 'pending' } })).toBe(false);
  });
});
