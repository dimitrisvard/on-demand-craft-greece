// Every-10-minutes dispatcher: inbound rows left 'received' for more than 15 minutes; portal orders without a
// post-order run; parked runs whose flag is on again (flag_off) or older than 30 minutes (llm_unavailable);
// failure-card runs older than 14 days closed 'failed'; CAD jobs stuck for more than 30 minutes marked dead_letter;
// then the Gmail poller.
//
//   orphans       inbound_emails 'received' older than 15 minutes, oldest first: mailbox rfq without an rfq_intake
//                 run (key = message_id_sha256) -> the MailIngest startIntake logic in process; mailbox replies or
//                 gmail without a reply run, or with one left 'running' -> agent-events 'inbound-reply'. Skipped
//                 while the agent's flag is off (the row simply stays)
//   orders        orders in status 'new' created in the last 30 days, oldest first, without a post_order run
//                 (key = order id) -> agent-events 'order-created' (source 'quote' when the RFQ has a won quote, else
//                 'portal'); skipped while agent.post_order is off
//   parked        runs 'waiting_human' with parked_reason flag_off whose agent flag is on again, or llm_unavailable
//                 parked for more than 30 minutes, oldest first -> agent-events 'resume-parked'. budget parks wait
//                 for their Workflow's own timeout. Runs behind a failure card (parked_reason 'failed') are never
//                 resumed
//   failures      runs behind a failure card for more than 14 days -> closed 'failed' (error kept, token and
//                 parked_reason cleared, only while still waiting) and their Telegram card loses its buttons
//   stuck CAD     cad_jobs 'dispatched' or 'running' for more than 30 minutes -> 'dead_letter' (only while still in
//                 that status), RfqThread.cadJobFinal(job, 'dead_letter'), the job's 'cad' run closed 'failed'.
//                 Each CAD job is handled on its own: a failing RfqThread call is logged by job id and the next job
//                 still runs (the quote's own await-cad timeout covers a thread that missed the final state)
//   poller        cron/gmail-poller.ts (its own run row, agent quote.reply_poller), last, so every other job of the
//                 tick has finished before it reads mail
// Rules
//   - Each job runs on its own; a failing job is logged and the others still run.
//   - orphans, orders and parked page through their window (PAGE rows a page, at most SCAN_MAX rows a tick) until
//     BATCH rows were acted on: rows that are skipped (handled already, or their flag is off) never hide newer
//     rows. The runs of a page are read with one query.
//   - The dispatcher has no run row of its own: every effect is recorded on the run or row it acts on.
//   - Log lines carry counts and ids only.

import type { FlagKey } from '../../../shared/src/agent-types';
import { describeError } from '../../../shared/src/compat/vercel-node';
import { formatLogLine } from '../../../shared/src/http/log';
import { decidedCard, type CardV1 } from '../agents/cards/index';
import { DEFAULT_TENANT_ID, readFlag, type AgentFlagKey } from '../agents/flags';
import { closeRun, usageFromRow } from '../agents/runs';
import type { Db } from '../db/postgrest';
import { hasWonQuote, recentNewOrders } from '../db/repos/orders';
import { startIntakeFor } from '../entrypoints/mail-ingest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import type { AgentEventV1 } from '../queues/messages';
import { REPLY_AGENT, replyRunKey } from '../replies/inbound';
import { gmailPollerTick } from './gmail-poller';

const MINUTE = 60_000;
export const ORPHAN_AGE_MS = 15 * MINUTE;
export const ORDER_WINDOW_MS = 30 * 86_400_000;
export const LLM_PARK_AGE_MS = 30 * MINUTE;
export const FAILURE_CARD_MAX_AGE_MS = 14 * 86_400_000;
export const STUCK_CAD_AGE_MS = 30 * MINUTE;
/** Rows acted on per job and tick. */
export const BATCH = 50;
/** Rows read per page of a window. */
export const PAGE = 50;
/** Rows read per job and tick at most. */
export const SCAN_MAX = 1000;

export interface DispatcherReport {
  poller: string;
  intake_started: number;
  replies_requeued: number;
  orders_sent: number;
  resumed: number;
  failures_closed: number;
  cad_dead_lettered: number;
  errors: string[];
}

/** The flag that governs an agent's runs (null when no flag does). */
export function flagKeyFor(agent: string): AgentFlagKey | null {
  if (agent === 'quote.reply_poller') return 'agent.quote';
  const key = `agent.${agent}`;
  const known: readonly FlagKey[] = ['agent.rfq_intake', 'agent.quote', 'agent.post_order', 'agent.growth.reddit', 'agent.growth.hn', 'agent.growth.tenders', 'agent.growth.scrapers', 'agent.growth.xometry', 'agent.content_daily', 'agent.ops_digest'];
  return (known as readonly string[]).includes(key) ? (key as AgentFlagKey) : null;
}

/** Flag reads of one tick, cached per (key, tenant). */
function flagCache(env: OpsEnv): (key: AgentFlagKey, tenant: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return (key, tenant) => {
    const k = `${key}|${tenant}`;
    let p = seen.get(k);
    if (!p) {
      p = readFlag(env, key, tenant).then((f) => f.enabled);
      seen.set(k, p);
    }
    return p;
  };
}

/** Status of the runs of an agent by idempotency key (one query; keys without a run are absent). */
async function runsByKey(db: Db, agent: string, keys: readonly string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await db.select<{ idempotency_key: string; status: string }>('agent_runs', {
    columns: 'idempotency_key,status',
    filters: [['agent', 'eq', agent], ['idempotency_key', 'in', [...keys]]],
    limit: keys.length,
  });
  return new Map(rows.map((r) => [r.idempotency_key, r.status]));
}

/** The rows of a window, oldest first, a page at a time: page(since) answers the rows whose cursor column is at or
 *  after `since` (null: from the start), ordered by that column, at most PAGE rows. Rows seen on an earlier page are
 *  left out; stops at the end of the window or after SCAN_MAX rows. */
export async function* windowPages<T extends { id: string }>(page: (since: string | null) => Promise<T[]>, cursor: (row: T) => string): AsyncGenerator<T[]> {
  const seen = new Set<string>();
  let since: string | null = null;
  let scanned = 0;
  while (scanned < SCAN_MAX) {
    const rows = await page(since);
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) seen.add(r.id);
    scanned += fresh.length;
    yield fresh;
    if (rows.length < PAGE) return;
    since = cursor(rows[rows.length - 1]);
  }
}

async function send(env: OpsEnv, message: AgentEventV1): Promise<void> {
  if (!env.AGENT_EVENTS) throw new Error('AGENT_EVENTS binding missing');
  await env.AGENT_EVENTS.send(message, { contentType: 'json' });
}

interface OrphanRow {
  id: string;
  tenant_id: string;
  mailbox: string;
  message_id_sha256: string;
  created_at: string;
}

async function orphans(env: OpsEnv, ports: Ports, now: Date, enabled: ReturnType<typeof flagCache>, r: DispatcherReport): Promise<void> {
  const db = ports.db;
  const before = new Date(now.getTime() - ORPHAN_AGE_MS).toISOString();
  const page = (since: string | null) =>
    db.select<OrphanRow & Record<string, unknown>>('inbound_emails', {
      columns: 'id,tenant_id,mailbox,message_id_sha256,created_at',
      filters: [['status', 'eq', 'received'], ['created_at', 'lt', before], ...(since ? [['created_at', 'gte', since] as const] : [])],
      order: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
      limit: PAGE,
    });
  let acted = 0;
  for await (const rows of windowPages(page, (row) => row.created_at)) {
    const intakeRuns = await runsByKey(db, 'rfq_intake', rows.filter((row) => row.mailbox === 'rfq').map((row) => row.message_id_sha256));
    const replyRuns = await runsByKey(db, REPLY_AGENT, rows.filter((row) => row.mailbox !== 'rfq').map((row) => replyRunKey(row.id)));
    for (const row of rows) {
      if (acted >= BATCH) return;
      if (row.mailbox === 'rfq') {
        if (!(await enabled('agent.rfq_intake', row.tenant_id))) continue;
        if (intakeRuns.has(row.message_id_sha256)) continue;
        const started = await startIntakeFor(env, { v: 1, inbound_email_id: row.id, message_id_sha256: row.message_id_sha256, tenant_id: row.tenant_id }, { db });
        acted++;
        if (started.status === 'started') r.intake_started++;
        continue;
      }
      if (!(await enabled('agent.quote', row.tenant_id))) continue;
      const status = replyRuns.get(replyRunKey(row.id));
      if (status !== undefined && status !== 'running') continue;
      await send(env, { v: 1, type: 'inbound-reply', inbound_email_id: row.id, tenant_id: row.tenant_id });
      acted++;
      r.replies_requeued++;
    }
  }
}

async function orders(env: OpsEnv, ports: Ports, now: Date, enabled: ReturnType<typeof flagCache>, r: DispatcherReport): Promise<void> {
  const db = ports.db;
  const windowStart = new Date(now.getTime() - ORDER_WINDOW_MS).toISOString();
  const page = (since: string | null) => recentNewOrders(db, new Date(since ?? windowStart), PAGE);
  for await (const rows of windowPages(page, (order) => order.created_at ?? windowStart)) {
    const handled = await runsByKey(db, 'post_order', rows.map((order) => order.id));
    for (const order of rows) {
      if (r.orders_sent >= BATCH) return;
      const tenant = order.tenant_id ?? env.AGENT_TENANT_ID ?? DEFAULT_TENANT_ID;
      if (!(await enabled('agent.post_order', tenant))) continue;
      if (handled.has(order.id)) continue;
      const source = order.rfq_id && (await hasWonQuote(db, order.rfq_id)) ? 'quote' : 'portal';
      await send(env, { v: 1, type: 'order-created', order_id: order.id, tenant_id: tenant, source });
      r.orders_sent++;
    }
  }
}

interface ParkedRow {
  id: string;
  agent: string;
  parked_reason: string;
  updated_at: string;
  tenant_id: string;
}

async function parked(env: OpsEnv, ports: Ports, now: Date, enabled: ReturnType<typeof flagCache>, r: DispatcherReport): Promise<void> {
  const page = (since: string | null) =>
    ports.db.select<ParkedRow & Record<string, unknown>>('agent_runs', {
      columns: 'id,agent,parked_reason,updated_at,tenant_id',
      filters: [['status', 'eq', 'waiting_human'], ['parked_reason', 'in', ['flag_off', 'llm_unavailable']], ...(since ? [['updated_at', 'gte', since] as const] : [])],
      order: [{ column: 'updated_at', ascending: true }, { column: 'id', ascending: true }],
      limit: PAGE,
    });
  for await (const rows of windowPages(page, (run) => run.updated_at)) {
    for (const run of rows) {
      if (r.resumed >= BATCH) return;
      let resume = false;
      if (run.parked_reason === 'llm_unavailable') resume = Date.parse(run.updated_at) < now.getTime() - LLM_PARK_AGE_MS;
      else {
        const key = flagKeyFor(run.agent);
        resume = key !== null && (await enabled(key, run.tenant_id ?? DEFAULT_TENANT_ID));
      }
      if (!resume) continue;
      await send(env, { v: 1, type: 'resume-parked', run_id: run.id });
      r.resumed++;
    }
  }
}

async function failures(ports: Ports, now: Date, r: DispatcherReport): Promise<void> {
  const db = ports.db;
  const rows = await db.select<{ id: string; output: Record<string, unknown> | null }>('agent_runs', {
    columns: 'id,output',
    filters: [
      ['status', 'eq', 'waiting_human'],
      ['parked_reason', 'eq', 'failed'],
      ['updated_at', 'lt', new Date(now.getTime() - FAILURE_CARD_MAX_AGE_MS).toISOString()],
    ],
    limit: 100,
  });
  for (const run of rows) {
    // Only while the run still waits (a decision taken meanwhile wins); the usage columns stay as written.
    const closed = await db.update('agent_runs', { status: 'failed', finished_at: now.toISOString(), approval_token_sha256: null, parked_reason: null }, {
      filters: [
        ['id', 'eq', run.id],
        ['status', 'eq', 'waiting_human'],
        ['parked_reason', 'eq', 'failed'],
      ],
      returning: 'id',
    });
    if (closed.length === 0) continue;
    r.failures_closed++;
    const messageId = run.output?.telegram_message_id;
    const card = run.output?.card as CardV1 | undefined;
    if (typeof messageId === 'number' && card && typeof card === 'object') {
      try {
        await ports.telegram.editCard(messageId, decidedCard(card, { label: 'Closed after 14 days without a decision', actor: 'system', at: now }));
      } catch {
        console.error(formatLogLine(LOG_PREFIX, 'card edit failed', { run_id: run.id }));
      }
    }
  }
}

async function stuckCad(env: OpsEnv, ports: Ports, now: Date, r: DispatcherReport): Promise<void> {
  const db = ports.db;
  const rows = await db.select<{ id: string; rfq_id: string | null }>('cad_jobs', {
    columns: 'id,rfq_id',
    filters: [
      ['status', 'in', ['dispatched', 'running']],
      ['updated_at', 'lt', new Date(now.getTime() - STUCK_CAD_AGE_MS).toISOString()],
    ],
    order: [{ column: 'updated_at', ascending: true }],
    limit: BATCH,
  });
  for (const job of rows) {
    const moved = await db.update('cad_jobs', { status: 'dead_letter', finished_at: now.toISOString(), error: 'stuck' }, {
      filters: [
        ['id', 'eq', job.id],
        ['status', 'in', ['dispatched', 'running']],
      ],
      returning: 'id',
    });
    if (moved.length === 0) continue;
    r.cad_dead_lettered++;
    if (job.rfq_id && env.RFQ_THREAD) {
      try {
        await env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(job.rfq_id)).cadJobFinal(job.id, 'dead_letter');
      } catch (error) {
        r.errors.push(`stuck_cad:${job.id}`);
        console.error(formatLogLine(LOG_PREFIX, 'dispatcher cad thread failed', { job_id: job.id }), describeError(error));
      }
    }
    const runs = await db.select<{ id: string; status: string; llm_calls: number; input_tokens: number; output_tokens: number; cached_input_tokens: number; cost_cents: number | string }>('agent_runs', {
      columns: 'id,status,llm_calls,input_tokens,output_tokens,cached_input_tokens,cost_cents',
      filters: [['agent', 'eq', 'cad'], ['idempotency_key', 'eq', job.id]],
      limit: 1,
    });
    const run = runs[0];
    if (run && run.status === 'running') await closeRun(db, run.id, { status: 'failed', error: 'stuck' }, usageFromRow(run));
  }
}

export async function dispatcherTick(env: OpsEnv, controller: ScheduledController, deps?: { ports?: Ports }): Promise<DispatcherReport> {
  const ports = deps?.ports ?? makePorts(env);
  const now = ports.clock.now();
  const enabled = flagCache(env);
  const report: DispatcherReport = { poller: 'not_run', intake_started: 0, replies_requeued: 0, orders_sent: 0, resumed: 0, failures_closed: 0, cad_dead_lettered: 0, errors: [] };
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ['orphans', () => orphans(env, ports, now, enabled, report)],
    ['orders', () => orders(env, ports, now, enabled, report)],
    ['parked', () => parked(env, ports, now, enabled, report)],
    ['failures', () => failures(ports, now, report)],
    ['stuck_cad', () => stuckCad(env, ports, now, report)],
    ['poller', async () => {
      const p = await gmailPollerTick(env, controller, { ports });
      report.poller = p.ran ? 'ran' : p.reason;
    }],
  ];
  for (const [name, job] of jobs) {
    try {
      await job();
    } catch (error) {
      report.errors.push(name);
      console.error(formatLogLine(LOG_PREFIX, 'dispatcher job failed', { job: name }), describeError(error));
    }
  }
  const { errors, poller, ...counts } = report;
  console.log(formatLogLine(LOG_PREFIX, 'dispatcher', { poller, ...counts, errors: errors.join(',') || 'none' }));
  return report;
}
