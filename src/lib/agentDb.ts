// Reads of the agent tables for the dashboard pages (Phase 4): supabase-js with the signed-in user's session, so
// staff row-level security decides what is returned. The pages never write these tables (they have no client write
// grant); every action goes through /api/agent/* (src/utils/agentApi.ts).
//
// Rules
//   - The agent tables are created by supabase/migrations/*_agent_layer.sql and are not in
//     src/integrations/supabase/types.ts until it is regenerated after that migration is applied; `agentDb` below is
//     the one untyped accessor, and row types come from src/types/agent.ts.
//   - A missing table (PostgREST PGRST205, SQLSTATE 42P01, or HTTP 404 whose message names the schema cache) throws
//     AgentNotInstalledError, which the pages show as "not installed" and never retry or poll.
//   - Lists are bounded (the inbox pages by 50 rows, the other lists by fixed limits); e-mail bodies are read only for
//     the one message a user opens (body_excerpt), never in a list.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type {
  AgentRunRow,
  FeatureFlagRow,
  InboundEmailRow,
  InboundKind,
  InboundMailbox,
  InboundStatus,
  QuoteWorkflowRow,
  RfqStartRow,
} from '@/types/agent';

/** Untyped access to the agent tables until types.ts is regenerated after the agent-layer migration. */
export const agentDb = supabase as unknown as SupabaseClient;

export const INBOX_PAGE_SIZE = 50;
export const APPROVALS_LIMIT = 200;
export const ACTIVITY_LIMIT = 50;
export const RFQ_START_LIMIT = 50;

/** quote_workflows statuses that end a quote (an RFQ with any other status has an active quote). */
export const QUOTE_FINAL_STATUSES = ['won', 'lost', 'expired', 'rejected', 'failed', 'cancelled'] as const;
/** RFQ statuses for which the dashboard offers "Start quote". */
export const RFQ_STARTABLE_STATUSES = ['draft', 'received'] as const;

export const INBOX_COLUMNS =
  'id, received_at, mailbox, source, from_name, from_email, subject, kind, status, parse_confidence, classification, auth_results, attachments, parsed, raw_r2_key, rfq_id, agent_run_id, error';
export const PENDING_COLUMNS = 'id, agent, subject_type, subject_id, workflow_instance_id, started_at, updated_at, output, approval_token_sha256';
export const FLAG_COLUMNS = 'key, enabled, value, description, updated_at, updated_by, rev, kv_synced_rev, kv_seed_pending';
export const ACTIVITY_COLUMNS = 'id, agent, trigger, status, parked_reason, started_at, finished_at, cost_cents, llm_calls, error, human_action, output';

/** The agent layer's tables are not in the database yet (the migration has not been applied). */
export class AgentNotInstalledError extends Error {
  readonly code = 'not_installed';
  constructor() {
    super('The agent layer is not installed yet (database).');
    this.name = 'AgentNotInstalledError';
  }
}

/** A failed read of the agent tables (other than a missing table). */
export class AgentDbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'AgentDbError';
  }
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

/** True when a PostgREST answer means the table does not exist (rules in the header). */
export function isMissingTable(error: ErrorLike | null | undefined, status?: number | null): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === 'PGRST205' || code === '42P01') return true;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return status === 404 && message.includes('schema cache');
}

interface Answer<T> {
  data: T | null;
  error: ErrorLike | null;
  status?: number | null;
}

/** The rows of a PostgREST answer, or the error the pages handle (not installed vs. other failure). */
export function rowsOf<T>(answer: Answer<T[]>): T[] {
  if (answer.error) {
    if (isMissingTable(answer.error, answer.status)) throw new AgentNotInstalledError();
    const message = typeof answer.error.message === 'string' ? answer.error.message : 'Request failed';
    throw new AgentDbError(message, typeof answer.error.code === 'string' ? answer.error.code : null, answer.status ?? null);
  }
  return Array.isArray(answer.data) ? answer.data : [];
}

function oneOf<T>(answer: Answer<T>): T | null {
  if (answer.error) return rowsOf<T>({ data: null, error: answer.error, status: answer.status })[0] ?? null;
  return answer.data ?? null;
}

/** 'h***@example.de': first character of the local part, then '***', then the domain; '' for anything else. */
export function maskEmail(addr: string | null | undefined): string {
  if (typeof addr !== 'string') return '';
  const at = addr.lastIndexOf('@');
  if (at < 1 || at === addr.length - 1) return '';
  return `${addr[0]}***@${addr.slice(at + 1)}`;
}

export interface InboxFilter {
  status?: InboundStatus | 'all';
  mailbox?: InboundMailbox | 'all';
  kind?: InboundKind | 'all';
  /** 0-based page of INBOX_PAGE_SIZE rows. */
  page?: number;
}

export interface AgentQueries {
  /** inbound_emails, newest first, one page. */
  listInbound(filter?: InboxFilter): Promise<InboundEmailRow[]>;
  /** One message (list columns), e.g. for a deep link to a message outside the current page. */
  getInbound(id: string): Promise<InboundEmailRow | null>;
  /** The first 4,000 characters of the quote-stripped plain text of one message (shown as text only). */
  inboundExcerpt(id: string): Promise<string | null>;
  /** The intake run of a message that waits for a human decision, if any. */
  pendingIntakeRun(inboundEmailId: string): Promise<AgentRunRow | null>;
  /** Runs waiting on a card (a token hash is present), oldest update first. */
  listPendingApprovals(): Promise<AgentRunRow[]>;
  getQuoteWorkflow(id: string): Promise<QuoteWorkflowRow | null>;
  /** RFQs in draft or received without an active quote. */
  listRfqsWithoutQuote(): Promise<RfqStartRow[]>;
  listFlags(): Promise<FeatureFlagRow[]>;
  /** The newest runs, optionally of one agent. */
  listAgentRuns(agent?: string | null): Promise<AgentRunRow[]>;
}

/** The queries over a client (tests pass a fake). */
export function createAgentQueries(client: SupabaseClient = agentDb): AgentQueries {
  return {
    async listInbound(filter = {}) {
      const page = Math.max(0, Math.floor(filter.page ?? 0));
      let q = client.from('inbound_emails').select(INBOX_COLUMNS);
      if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status);
      if (filter.mailbox && filter.mailbox !== 'all') q = q.eq('mailbox', filter.mailbox);
      if (filter.kind && filter.kind !== 'all') q = q.eq('kind', filter.kind);
      const answer = await q.order('received_at', { ascending: false }).range(page * INBOX_PAGE_SIZE, page * INBOX_PAGE_SIZE + INBOX_PAGE_SIZE - 1);
      return rowsOf<InboundEmailRow>(answer as Answer<InboundEmailRow[]>);
    },

    async getInbound(id) {
      const answer = await client.from('inbound_emails').select(INBOX_COLUMNS).eq('id', id).maybeSingle();
      return oneOf(answer as Answer<InboundEmailRow>);
    },

    async inboundExcerpt(id) {
      const answer = await client.from('inbound_emails').select('body_excerpt').eq('id', id).maybeSingle();
      const row = oneOf(answer as Answer<{ body_excerpt: string | null }>);
      return typeof row?.body_excerpt === 'string' ? row.body_excerpt : null;
    },

    async pendingIntakeRun(inboundEmailId) {
      const answer = await client
        .from('agent_runs')
        .select('id, agent, status, output, approval_token_sha256, updated_at')
        .eq('subject_type', 'inbound_email')
        .eq('subject_id', inboundEmailId)
        .eq('status', 'waiting_human')
        .not('approval_token_sha256', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1);
      return rowsOf<AgentRunRow>(answer as Answer<AgentRunRow[]>)[0] ?? null;
    },

    async listPendingApprovals() {
      const answer = await client
        .from('agent_runs')
        .select(PENDING_COLUMNS)
        .eq('status', 'waiting_human')
        .not('approval_token_sha256', 'is', null)
        .order('updated_at', { ascending: true })
        .limit(APPROVALS_LIMIT);
      return rowsOf<AgentRunRow>(answer as Answer<AgentRunRow[]>);
    },

    async getQuoteWorkflow(id) {
      const answer = await client.from('quote_workflows').select('*').eq('id', id).maybeSingle();
      return oneOf(answer as Answer<QuoteWorkflowRow>);
    },

    async listRfqsWithoutQuote() {
      const rfqAnswer = await client
        .from('rfqs')
        .select('id, rfq_number, status, company_name, created_at')
        .in('status', [...RFQ_STARTABLE_STATUSES])
        .order('created_at', { ascending: false })
        .limit(RFQ_START_LIMIT);
      const rfqs = rowsOf<RfqStartRow>(rfqAnswer as Answer<RfqStartRow[]>);
      if (rfqs.length === 0) return [];
      const quoteAnswer = await client
        .from('quote_workflows')
        .select('rfq_id, status')
        .in(
          'rfq_id',
          rfqs.map((r) => r.id),
        )
        .not('status', 'in', `(${QUOTE_FINAL_STATUSES.join(',')})`);
      const active = new Set(rowsOf<{ rfq_id: string }>(quoteAnswer as Answer<Array<{ rfq_id: string }>>).map((q) => q.rfq_id));
      return rfqs.filter((r) => !active.has(r.id));
    },

    async listFlags() {
      const answer = await client.from('feature_flags').select(FLAG_COLUMNS).order('key', { ascending: true });
      return rowsOf<FeatureFlagRow>(answer as Answer<FeatureFlagRow[]>);
    },

    async listAgentRuns(agent) {
      let q = client.from('agent_runs').select(ACTIVITY_COLUMNS);
      if (agent) q = q.eq('agent', agent);
      const answer = await q.order('started_at', { ascending: false }).limit(ACTIVITY_LIMIT);
      return rowsOf<AgentRunRow>(answer as Answer<AgentRunRow[]>);
    },
  };
}

/** The queries over the app's client. */
export const agentQueries: AgentQueries = createAgentQueries();

// ----- React Query policies of the agent pages -----

/** Retry once, except for a missing table (shown as "not installed", never retried). */
export function agentRetry(failureCount: number, error: unknown): boolean {
  return !(error instanceof AgentNotInstalledError) && failureCount < 1;
}

/** Poll every `ms` only while the last read succeeded (never while the tables are missing or a read fails). */
export function pollAfterSuccess(ms: number): (query: { state: { status: string } }) => number | false {
  return (query) => (query.state.status === 'success' ? ms : false);
}

/** True when a query error means the agent tables are missing. */
export function isNotInstalled(error: unknown): boolean {
  return error instanceof AgentNotInstalledError;
}
