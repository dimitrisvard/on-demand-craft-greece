// public.agent_runs reads and writes through the Db port (service role). Column names and CHECK lists follow the
// agent-layer migration; runs are opened only through rpc/agent_run_begin (src/agents/runs.ts openRun).
// updated_at is maintained by the table's trigger.

import type { ParkReason, RunStatus, RunTrigger } from '../../agents/runs';
import type { Db } from '../postgrest';

export interface AgentRunRow {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  agent: string;
  trigger: RunTrigger;
  idempotency_key: string;
  workflow_name: string | null;
  workflow_instance_id: string | null;
  parent_run_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  status: RunStatus;
  parked_reason: ParkReason | null;
  prompt_version: string | null;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  /** numeric(12,4), USD cents (PostgREST may answer it as a string). */
  cost_cents: number | string;
  approval_token_sha256: string | null;
  /** {channel, actor, verb, note?, decided_at}. */
  human_action: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** Columns a PATCH may set (never id, agent, idempotency_key or the timestamps the database owns). */
export type AgentRunPatch = Partial<
  Pick<
    AgentRunRow,
    | 'status'
    | 'parked_reason'
    | 'prompt_version'
    | 'llm_calls'
    | 'input_tokens'
    | 'output_tokens'
    | 'cached_input_tokens'
    | 'cost_cents'
    | 'approval_token_sha256'
    | 'output'
    | 'error'
    | 'finished_at'
  >
>;

/** Columns of the waiting run behind an approval token hash that decide() needs. */
export const WAITING_RUN_COLUMNS =
  'id,agent,workflow_name,workflow_instance_id,subject_type,subject_id,output,error,llm_calls,input_tokens,output_tokens,cached_input_tokens,cost_cents';

/** The waiting run behind an approval token hash (the fields decide() needs), or null. */
export type WaitingRun = Pick<
  AgentRunRow,
  | 'id'
  | 'agent'
  | 'workflow_name'
  | 'workflow_instance_id'
  | 'subject_type'
  | 'subject_id'
  | 'output'
  | 'error'
  | 'llm_calls'
  | 'input_tokens'
  | 'output_tokens'
  | 'cached_input_tokens'
  | 'cost_cents'
>;

export async function getRun(db: Db, runId: string): Promise<AgentRunRow | null> {
  const rows = await db.select<AgentRunRow & Record<string, unknown>>('agent_runs', { filters: [['id', 'eq', runId]], limit: 1 });
  return rows[0] ?? null;
}

/** agent_runs?approval_token_sha256=eq.<h>&status=eq.waiting_human. */
export async function findWaitingRunByTokenHash(db: Db, tokenSha256: string): Promise<WaitingRun | null> {
  const rows = await db.select<WaitingRun & Record<string, unknown>>('agent_runs', {
    columns: WAITING_RUN_COLUMNS,
    filters: [
      ['approval_token_sha256', 'eq', tokenSha256],
      ['status', 'eq', 'waiting_human'],
    ],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function patchRun(db: Db, runId: string, patch: AgentRunPatch): Promise<void> {
  await db.update('agent_runs', patch as Record<string, unknown>, { filters: [['id', 'eq', runId]] });
}

/** Ids of the agent's runs started at or after `since`, at most `limit`. */
export async function runIdsSince(db: Db, agent: string, since: Date, limit: number): Promise<string[]> {
  const rows = await db.select<{ id: string }>('agent_runs', {
    columns: 'id',
    filters: [
      ['agent', 'eq', agent],
      ['started_at', 'gte', since.toISOString()],
    ],
    limit,
  });
  return rows.map((r) => r.id);
}
