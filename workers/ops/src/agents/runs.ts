// Run records (public.agent_runs): one row per Workflow run, consumer delivery, cron tick with an effect and MCP
// tool call, opened through rpc/agent_run_begin and closed with status, usage and cost.
//
// Rules
//   - openRun is the first action of every run; created = false with a final status means the work was done, and
//     the caller exits.
//   - closeRun writes status, finished_at, error, output, the usage columns and cost_cents in one PATCH and clears
//     approval_token_sha256 and parked_reason; cost_cents > 0 whenever llm_calls > 0.
//   - A waiting run (approval card or failure card) is 'waiting_human' with its token hash; a parked run is
//     'waiting_human' with parked_reason and no token.
//   - output is a summary of at most 8 KB: no e-mail bodies, addresses or tokens; a larger summary is replaced by
//     {truncated: true, bytes} before it is written.
//   - Usage columns: input_tokens = uncached input + cache-creation input, cached_input_tokens = cache-read input,
//     output_tokens, llm_calls (Anthropic calls that returned usage; embeddings count in Analytics Engine only) and
//     cost_cents = 100 x the run's USD (rounded up to 4 decimals). A run with llm_calls > 0 and no priced spend is
//     written with the smallest cost (0.0001) and output.price_missing, so exit gate 4 never sees an unpriced call.
//   - idempotency keys start with '<agent>:' or a fixed prefix (rfq_intake: the message_id_sha256; quote:
//     '<rfq_id>:v<n>'; post-order: the order id; cad: the cad_jobs id).
// Phase 5 extends AgentKey in this file and changes nothing else here.

import type { AgentFlag } from './flags';
import type { Db } from '../db/postgrest';
import { getRun, patchRun, runIdsSince, type AgentRunPatch, type AgentRunRow } from '../db/repos/agent-runs';
import type { OpsEnv } from '../env';
import type { EmbedUsage, LlmUsage, Ports } from '../ports/index';
import { formatLogLine } from '../../../shared/src/http/log';
import { LOG_PREFIX } from '../env';
import { request } from './approval';
import { failureCard } from './cards/failure';
import { costCents, PRICES_VERSION } from './prices';

export { isAlreadyExists } from './ids';

/** Values of agent_runs.agent written by Phase 4 (CHECK ^[a-z0-9_]+(\.[a-z0-9_]+)*$). */
export type AgentKey =
  | 'rfq_intake'
  | 'quote'
  | 'post_order'
  | 'quote.reply_poller'
  | 'cad'
  | 'eval'
  | 'mcp'
  | 'flags'
  | 'growth.scrapers';

/** = agent_runs_trigger_check. */
export type RunTrigger = 'email' | 'cron' | 'queue' | 'workflow' | 'dashboard' | 'telegram' | 'mcp' | 'manual';

/** = agent_runs_status_check. */
export type RunStatus = 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

/** = agent_runs.parked_reason CHECK; 'failed' marks a run waiting on a failure card. */
export type ParkReason = 'flag_off' | 'budget' | 'llm_unavailable' | 'failed';

export interface OpenRun {
  agent: AgentKey;
  trigger: RunTrigger;
  idempotency_key: string;
  workflow_name?: string;
  workflow_instance_id?: string;
  parent_run_id?: string;
  subject_type?: string;
  subject_id?: string;
  prompt_version?: string;
  tenant_id?: string;
}

/** Usage accumulated over the steps of one run (kept in step results, written at checkpoints and at close). */
export interface UsageAcc {
  /** Anthropic calls that returned usage. */
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  embed_calls: number;
  embed_input_tokens: number;
  /** USD sum of every successful call (LLM and embeddings). */
  cost_usd: number;
  /** USD per step name. */
  by_step: Record<string, number>;
}

export const EMPTY_USAGE: Readonly<UsageAcc> = Object.freeze({
  llm_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  embed_calls: 0,
  embed_input_tokens: 0,
  cost_usd: 0,
  by_step: Object.freeze({}) as Record<string, number>,
});

/** Largest output summary written to agent_runs (bytes of JSON). */
export const OUTPUT_MAX_BYTES = 8192;
/** Smallest positive cost_cents (numeric(12,4)). */
export const MIN_COST_CENTS = 0.0001;

function nonNegativeInt(n: unknown): number {
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** rpc/agent_run_begin: inserts once per (agent, idempotency_key), else returns the existing run and its status. */
export async function openRun(db: Db, r: OpenRun): Promise<{ run_id: string; created: boolean; status: RunStatus }> {
  const fields: Record<string, string> = {};
  for (const key of ['workflow_name', 'workflow_instance_id', 'parent_run_id', 'subject_type', 'subject_id', 'prompt_version'] as const) {
    const value = r[key];
    if (value !== undefined && value !== null && value !== '') fields[key] = value;
  }
  const args: Record<string, unknown> = { p_agent: r.agent, p_trigger: r.trigger, p_idempotency_key: r.idempotency_key, p_fields: fields };
  if (r.tenant_id) args.p_tenant_id = r.tenant_id;
  const result = await db.rpc<unknown>('agent_run_begin', args);
  const row = (Array.isArray(result) ? result[0] : result) as { run_id?: unknown; created?: unknown; run_status?: unknown } | undefined;
  if (!row || typeof row.run_id !== 'string' || typeof row.created !== 'boolean' || typeof row.run_status !== 'string') {
    throw new Error('agent_run_begin returned no run');
  }
  return { run_id: row.run_id, created: row.created, status: row.run_status as RunStatus };
}

/** True for the final statuses (an existing run in one of them means the work is done). */
export function isFinal(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}

/** Pure: a new accumulator with one call added. */
export function addUsage(acc: UsageAcc, u: LlmUsage | EmbedUsage, step: string): UsageAcc {
  const cost = typeof u.cost_usd === 'number' && Number.isFinite(u.cost_usd) && u.cost_usd > 0 ? u.cost_usd : 0;
  const by_step = { ...acc.by_step, [step]: (acc.by_step[step] ?? 0) + cost };
  if ('output_tokens' in u) {
    return {
      ...acc,
      llm_calls: acc.llm_calls + 1,
      input_tokens: acc.input_tokens + nonNegativeInt(u.input_tokens),
      output_tokens: acc.output_tokens + nonNegativeInt(u.output_tokens),
      cache_read_tokens: acc.cache_read_tokens + nonNegativeInt(u.cache_read_input_tokens),
      cache_write_tokens: acc.cache_write_tokens + nonNegativeInt(u.cache_creation_input_tokens),
      cost_usd: acc.cost_usd + cost,
      by_step,
    };
  }
  return {
    ...acc,
    embed_calls: acc.embed_calls + 1,
    embed_input_tokens: acc.embed_input_tokens + nonNegativeInt(u.input_tokens),
    cost_usd: acc.cost_usd + cost,
    by_step,
  };
}

/** Pure: the sum of two accumulators (e.g. the usage of parallel steps). */
export function mergeUsage(a: UsageAcc, b: UsageAcc): UsageAcc {
  const by_step: Record<string, number> = { ...a.by_step };
  for (const [step, usd] of Object.entries(b.by_step)) by_step[step] = (by_step[step] ?? 0) + usd;
  return {
    llm_calls: a.llm_calls + b.llm_calls,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    embed_calls: a.embed_calls + b.embed_calls,
    embed_input_tokens: a.embed_input_tokens + b.embed_input_tokens,
    cost_usd: a.cost_usd + b.cost_usd,
    by_step,
  };
}

/** The accumulator a stored run already holds (for closing a run whose step results are gone, e.g. in decide()). */
export function usageFromRow(row: Pick<AgentRunRow, 'llm_calls' | 'input_tokens' | 'output_tokens' | 'cached_input_tokens' | 'cost_cents'>): UsageAcc {
  const cents = Number(row.cost_cents);
  return {
    ...EMPTY_USAGE,
    by_step: {},
    llm_calls: nonNegativeInt(row.llm_calls),
    input_tokens: nonNegativeInt(row.input_tokens),
    output_tokens: nonNegativeInt(row.output_tokens),
    cache_read_tokens: nonNegativeInt(row.cached_input_tokens),
    cost_usd: Number.isFinite(cents) && cents > 0 ? cents / 100 : 0,
  };
}

/** Pure: the usage columns of agent_runs for an accumulator (see the rules above). */
export function usageColumns(acc: UsageAcc): Required<Pick<AgentRunPatch, 'llm_calls' | 'input_tokens' | 'output_tokens' | 'cached_input_tokens' | 'cost_cents'>> & { price_missing: boolean } {
  let cents = costCents(acc.cost_usd);
  const price_missing = acc.llm_calls > 0 && cents === 0;
  if (price_missing) cents = MIN_COST_CENTS;
  return {
    llm_calls: acc.llm_calls,
    input_tokens: acc.input_tokens + acc.cache_write_tokens,
    output_tokens: acc.output_tokens,
    cached_input_tokens: acc.cache_read_tokens,
    cost_cents: cents,
    price_missing,
  };
}

/** Pure: an output summary as written (objects get prices_version when the run spent anything; capped at 8 KB). */
export function boundedOutput(output: unknown, acc?: UsageAcc, priceMissing = false): Record<string, unknown> | null {
  if (output === undefined || output === null) return null;
  let value: Record<string, unknown> = typeof output === 'object' && !Array.isArray(output) ? { ...(output as Record<string, unknown>) } : { value: output };
  if (acc && (acc.llm_calls > 0 || acc.embed_calls > 0)) value.prices_version = PRICES_VERSION;
  if (priceMissing) value.price_missing = true;
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > OUTPUT_MAX_BYTES) value = { truncated: true, bytes };
  return value;
}

function usagePatch(acc: UsageAcc): AgentRunPatch {
  const { price_missing: _ignored, ...columns } = usageColumns(acc);
  return columns;
}

/** Writes the usage so far (and an optional status/output change); status 'running' also clears parked_reason. */
export async function checkpointRun(db: Db, run_id: string, acc: UsageAcc, patch?: { status?: RunStatus; output?: unknown }): Promise<void> {
  const update: AgentRunPatch = usagePatch(acc);
  if (patch?.status) {
    if (isFinal(patch.status)) throw new Error('checkpointRun: use closeRun for a final status');
    update.status = patch.status;
    if (patch.status === 'running') {
      update.parked_reason = null;
      update.approval_token_sha256 = null;
    }
  }
  if (patch && 'output' in patch) update.output = boundedOutput(patch.output, acc);
  await patchRun(db, run_id, update);
}

/** One PATCH: final status, finished_at, error, output, usage columns, cost_cents; token and parked_reason cleared.
 *  error: the given text; when omitted, 'failed' keeps the stored error and every other status clears it.
 *  output: the given summary; when omitted, the stored summary is kept. */
export async function closeRun(
  db: Db,
  run_id: string,
  outcome: { status: 'succeeded' | 'failed' | 'cancelled' | 'skipped'; error?: string; output?: unknown },
  acc: UsageAcc,
): Promise<void> {
  const columns = usageColumns(acc);
  const { price_missing, ...usage } = columns;
  const update: AgentRunPatch = {
    ...usage,
    status: outcome.status,
    finished_at: new Date().toISOString(),
    approval_token_sha256: null,
    parked_reason: null,
  };
  if (outcome.error !== undefined) update.error = outcome.error.slice(0, 1000);
  else if (outcome.status !== 'failed') update.error = null;
  if (outcome.output !== undefined) update.output = boundedOutput(outcome.output, acc, price_missing);
  if (price_missing) console.error(formatLogLine(LOG_PREFIX, 'run closed without a priced llm call', { run_id }));
  await patchRun(db, run_id, update);
}

/** status 'waiting_human' + parked_reason; no token (the dispatcher resumes parked runs). */
export async function parkRun(db: Db, run_id: string, reason: Exclude<ParkReason, 'failed'>): Promise<void> {
  await patchRun(db, run_id, { status: 'waiting_human', parked_reason: reason, approval_token_sha256: null, finished_at: null });
}

/**
 * A failed Workflow run waits on a failure card: one PATCH through approval.request() with status 'waiting_human',
 * parked_reason 'failed', error, usage, the token hash and output.{card_kind: 'failure', allowed_verbs
 * (['retry', 'dismiss'] when restartable and failed_step is set, else ['dismiss']), failed_step, card,
 * telegram_message_id}. The run's agent is read for the card title.
 */
export async function failRun(
  env: OpsEnv,
  ports: Ports,
  run_id: string,
  f: { error: string; failed_step: string | null; restartable: boolean },
  acc: UsageAcc,
): Promise<void> {
  let agent = 'agent';
  try {
    agent = (await getRun(ports.db, run_id))?.agent ?? agent;
  } catch {
    // the card still goes out with a generic title
  }
  const error = f.error.slice(0, 500);
  const card = failureCard({ run_id, agent, failed_step: f.failed_step, error, restartable: f.restartable, site_origin: env.SITE_ORIGIN });
  const { price_missing, ...usage } = usageColumns(acc);
  await request(env, ports, { run_id, card }, {
    patch: { ...usage, parked_reason: 'failed', error },
    output: boundedOutput({ failed_step: f.failed_step, error }, acc, price_missing) ?? {},
  });
}

/** Start of the UTC day of `now`. */
export function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** flag.value.max_runs_per_day when it is a positive integer, else the default. */
export function dailyCap(flag: AgentFlag): number {
  const cap = flag.value.max_runs_per_day;
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? cap : DEFAULT_MAX_RUNS_PER_DAY;
}

/** reached: today's runs (this one included) exceed the cap; first: this run is the first one above it. */
export async function checkDailyCap(db: Db, agent: AgentKey, flag: AgentFlag, now: Date): Promise<{ reached: boolean; first: boolean; cap: number }> {
  const cap = dailyCap(flag);
  const ids = await runIdsSince(db, agent, utcMidnight(now), cap + 2);
  return { reached: ids.length > cap, first: ids.length === cap + 1, cap };
}

/**
 * Flood control: true when today's (UTC) runs of the agent, this one included, exceed the cap
 * (flag.value.max_runs_per_day, default 200). One select of `id` with agent=eq, started_at=gte.<UTC midnight>,
 * limit cap + 1 (cap + 2 in checkDailyCap, which also tells the first run above the cap).
 */
export async function dailyCapReached(db: Db, agent: AgentKey, flag: AgentFlag, now: Date): Promise<boolean> {
  return (await checkDailyCap(db, agent, flag, now)).reached;
}

/**
 * The open-run check of an LLM-using agent: when the daily cap is reached the run closes 'skipped' with error
 * 'daily_cap' (no LLM call follows) and the first run above the cap sends one plain Telegram notice for the agent
 * and UTC day. Returns true when the caller must stop.
 */
export async function applyDailyCap(env: OpsEnv, ports: Ports, r: { run_id: string; agent: AgentKey; flag: AgentFlag }): Promise<boolean> {
  const now = ports.clock.now();
  const cap = await checkDailyCap(ports.db, r.agent, r.flag, now);
  if (!cap.reached) return false;
  await closeRun(ports.db, r.run_id, { status: 'skipped', error: 'daily_cap', output: { daily_cap: cap.cap } }, { ...EMPTY_USAGE, by_step: {} });
  if (cap.first) {
    try {
      await ports.telegram.sendText(`Agent ${r.agent}: daily run cap of ${cap.cap} reached for ${now.toISOString().slice(0, 10)} (UTC). Further runs today are skipped.`);
    } catch {
      console.error(formatLogLine(LOG_PREFIX, 'daily cap notice failed', { agent: r.agent }));
    }
  }
  return true;
}

/** Default of flag.value.max_runs_per_day. */
export const DEFAULT_MAX_RUNS_PER_DAY = 200;
