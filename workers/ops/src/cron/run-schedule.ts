// Dispatcher of the Phase 5 schedule table (src/cron/schedule.ts), called by the '* * * * *' tick in src/index.ts.
// Dispatch work only: it opens runs, creates Workflow instances and sends queue messages; every scan runs in a
// queue consumer or a Workflow step (the two marketing jobs run their own short database work inline).
//
// Rules
//   - Order per due entry: gate first (readFlag for a flag, plus the entry's `when`; the exact string "true" for a
//     var); a closed gate writes nothing and opens no run (outcome 'flag_off'). Then idempotency (openRun returned
//     created: false, or isAlreadyExists on a Workflow create) -> 'exists'. Then create ('created') or send
//     ('enqueued'); the marketing jobs run inline under their run ('created').
//   - Run keys and instance ids (PHASE5_SPEC §5.2, §5.5): 'growth.reddit:t<N>:<slot>', 'growth.hn:<slot>',
//     'growth.tenders:<date>' (children ':<CC>' are opened by the consumer), 'growth.xometry:<slot>',
//     'content-daily-<date>', 'sitemap-<date>', 'ops-digest-<YYYY>-W<ww>', 'marketing.followups:<slot>',
//     'marketing.warmup:<date>'. Every run the dispatcher opens has trigger 'cron'.
//   - Tenders: one PostgREST read of the active connectors; due = last_scan_at null or older than 6 h before the
//     tick, then filtered by flag value.countries when it is a non-empty list; one 'tender-scheduled' message per
//     due connector with the parent run id; the parent closes 'succeeded' with {due (by the 6 h rule), enqueued,
//     countries (the filter, or null)}.
//   - A send() that throws closes its run 'failed' with error 'enqueue_failed' (tenders keep the counts so far); no
//     retry in a later tick (the run exists).
//   - An inline job closes its run 'succeeded' with the counts it returns, or 'failed' with the error name
//     ('config_missing: <names>' for missing configuration; never a value).
//   - One flag read per flag key and tick. A per-isolate memo of slots that reached an outcome (created, enqueued,
//     exists, or a closed run) avoids repeated openRun calls during a catch-up window; a gate that was closed or an
//     error before a run existed is evaluated again on the next tick of the window.
//   - Never throws: every per-job error is caught, logged '[microns-ops] schedule <job> <slot> error <name>' and
//     returned as outcome 'error'.

import { formatLogLine, logLine } from '../../../shared/src/http/log';
import { isConfigMissing, need } from '../agents/config';
import { readFlag, type AgentFlag, type AgentFlagKey } from '../agents/flags';
import { closeRun, EMPTY_USAGE, isAlreadyExists, openRun, type AgentKey } from '../agents/runs';
import { DbError } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { enqueueDueFollowups } from '../marketing/followups';
import { runWarmup } from '../marketing/warmup';
import { makePorts, type Ports } from '../ports/index';
import type { P5Ports } from '../ports/p5';
import type { P5ScrapeKind, P5ScrapeMessage } from '../queues/messages';
import { sendP5Scrape } from '../queues/scrapes-p5';
import { dueJobs, SCHEDULE, type JobId, type ScheduleEntry } from './schedule';

export type ScheduleOutcome = 'created' | 'enqueued' | 'exists' | 'flag_off' | 'error';

export interface ScheduleTickResult {
  fired: Array<{ job: JobId; slot: string; outcome: ScheduleOutcome }>;
}

/** Connectors whose last scan is older than this are due (live tender-collector rule). */
export const TENDER_DUE_AFTER_MS = 6 * 60 * 60 * 1000;
/** Memo entries older than this (by slot) are dropped. */
const MEMO_KEEP_MS = 3 * 60 * 60 * 1000;
/** Process-wide memo of the slots that reached an outcome (per isolate). */
const ISOLATE_MEMO = new Set<string>();

const ENTRIES: ReadonlyMap<JobId, ScheduleEntry> = new Map(SCHEDULE.map((e) => [e.job, e]));

/** An error with a fixed, value-free name for the log line and the run. */
class ScheduleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ScheduleError';
  }
}

/** 'YYYY-MM-DD' of a slot. */
function dateOf(slot: string): string {
  return slot.slice(0, 10);
}

/** ISO 8601 week of a date: {year, week} (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** 'YYYY-Www' of a date. */
export function isoWeekKey(d: Date): string {
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Name of an error for logs and run rows: a fixed code, never a message that could carry a value. */
export function errorName(e: unknown): string {
  if (e instanceof ScheduleError) return e.code;
  if (isConfigMissing(e)) return 'config_missing';
  if (e instanceof DbError) return `db_error_${e.status}`;
  return e instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(e.name) ? e.name : 'error';
}

function logError(job: JobId, slot: string, e: unknown): void {
  console.error(formatLogLine(LOG_PREFIX, `schedule ${job} ${slot} error ${errorName(e)}`));
}

function memoKey(job: JobId, slot: string): string {
  return `${job}@${slot}`;
}

function pruneMemo(memo: Set<string>, now: number): void {
  for (const key of memo) {
    const slot = key.slice(key.indexOf('@') + 1);
    const t = Date.parse(slot.replace(/Z$/, ':00Z'));
    if (!Number.isFinite(t) || now - t > MEMO_KEEP_MS) memo.delete(key);
  }
}

const NO_USAGE = () => ({ ...EMPTY_USAGE, by_step: {} });

/** Closes a run; a failure of the close itself is logged and never thrown (the caller reports the first error). */
async function closeQuietly(db: Ports['db'], runId: string, outcome: Parameters<typeof closeRun>[2], job: JobId, slot: string): Promise<void> {
  try {
    await closeRun(db, runId, outcome, NO_USAGE());
  } catch (e) {
    console.error(formatLogLine(LOG_PREFIX, `schedule ${job} ${slot} close failed ${errorName(e)}`));
  }
}

interface TickContext {
  env: OpsEnv;
  scheduledTime: number;
  ports(): Ports;
  flag(key: AgentFlagKey): Promise<AgentFlag>;
}

/** The scrapes job of an entry: agent key, run key, message kind and params. */
function scrapeSpec(job: JobId, slot: string): { agent: AgentKey; key: string; kind: P5ScrapeKind; params: P5ScrapeMessage['params'] } | null {
  switch (job) {
    case 'reddit-t1':
    case 'reddit-t2':
    case 'reddit-t3': {
      const tier = Number(job.slice(-1)) as 1 | 2 | 3;
      return { agent: 'growth.reddit', key: `growth.reddit:t${tier}:${slot}`, kind: 'reddit-tier', params: { tier, max: 40, slot } };
    }
    case 'hn':
      return { agent: 'growth.hn', key: `growth.hn:${slot}`, kind: 'hn-scan', params: { slot } };
    case 'xometry':
      return { agent: 'growth.xometry', key: `growth.xometry:${slot}`, kind: 'xometry-scan', params: { slot } };
    default:
      return null;
  }
}

async function fireScrape(t: TickContext, job: JobId, slot: string): Promise<ScheduleOutcome> {
  const spec = scrapeSpec(job, slot);
  if (!spec) throw new ScheduleError('no_scrape_spec');
  const db = t.ports().db;
  const run = await openRun(db, { agent: spec.agent, trigger: 'cron', idempotency_key: spec.key });
  if (!run.created) return 'exists';
  try {
    await sendP5Scrape(t.env, { kind: spec.kind, params: spec.params, run_id: run.run_id });
  } catch {
    await closeQuietly(db, run.run_id, { status: 'failed', error: 'enqueue_failed' }, job, slot);
    throw new ScheduleError('enqueue_failed');
  }
  return 'enqueued';
}

/** value.countries as upper-case codes when it is a non-empty list of strings, else null. */
export function countryFilter(flag: AgentFlag): string[] | null {
  const list = flag.value.countries;
  if (!Array.isArray(list) || list.length === 0 || !list.every((c) => typeof c === 'string' && c.trim() !== '')) return null;
  return list.map((c) => (c as string).trim().toUpperCase());
}

interface ConnectorRow {
  country_code: string | null;
  last_scan_at: string | null;
}

async function fireTenders(t: TickContext, slot: string, flag: AgentFlag): Promise<ScheduleOutcome> {
  const date = dateOf(slot);
  const db = t.ports().db;
  const run = await openRun(db, { agent: 'growth.tenders', trigger: 'cron', idempotency_key: `growth.tenders:${date}` });
  if (!run.created) return 'exists';
  const countries = countryFilter(flag);
  let rows: ConnectorRow[];
  try {
    rows = await db.select<ConnectorRow & Record<string, unknown>>('tender_connectors', {
      columns: 'country_code,last_scan_at',
      filters: [['is_active', 'eq', true]],
      order: [{ column: 'country_code' }],
    });
  } catch (e) {
    await closeQuietly(db, run.run_id, { status: 'failed', error: 'connectors_read_failed', output: { due: 0, enqueued: 0, countries } }, 'tenders', slot);
    throw e;
  }
  const cutoff = t.scheduledTime - TENDER_DUE_AFTER_MS;
  const due = rows.filter((r) => typeof r.country_code === 'string' && r.country_code !== '' && (r.last_scan_at === null || !(Date.parse(r.last_scan_at) >= cutoff)));
  const selected = countries ? due.filter((r) => countries.includes(String(r.country_code).toUpperCase())) : due;
  let enqueued = 0;
  for (const connector of selected) {
    try {
      await sendP5Scrape(t.env, { kind: 'tender-scheduled', params: { country_code: String(connector.country_code), date }, run_id: run.run_id });
    } catch {
      await closeQuietly(db, run.run_id, { status: 'failed', error: 'enqueue_failed', output: { due: due.length, enqueued, countries } }, 'tenders', slot);
      throw new ScheduleError('enqueue_failed');
    }
    enqueued++;
  }
  await closeRun(db, run.run_id, { status: 'succeeded', output: { due: due.length, enqueued, countries } }, NO_USAGE());
  return 'enqueued';
}

async function createInstance<P>(wf: Workflow<P>, id: string, params: P): Promise<ScheduleOutcome> {
  try {
    await wf.create({ id, params });
    return 'created';
  } catch (e) {
    if (isAlreadyExists(e)) return 'exists';
    throw e;
  }
}

async function fireWorkflow(t: TickContext, job: JobId, slot: string): Promise<ScheduleOutcome> {
  const { env } = t;
  const date = dateOf(slot);
  switch (job) {
    case 'content-daily':
      need(env, 'CONTENT_DAILY');
      return createInstance(env.CONTENT_DAILY, `content-daily-${date}`, { date, trigger: 'cron' });
    case 'sitemap':
      need(env, 'SITEMAP');
      return createInstance(env.SITEMAP, `sitemap-${date}`, { date });
    case 'ops-digest': {
      need(env, 'OPS_DIGEST');
      const week = isoWeekKey(new Date(Date.parse(`${date}T00:00:00Z`)));
      return createInstance(env.OPS_DIGEST, `ops-digest-${week}`, { iso_week: week, trigger: 'cron' });
    }
    default:
      throw new ScheduleError('no_workflow');
  }
}

async function fireInline(t: TickContext, job: JobId, slot: string): Promise<ScheduleOutcome> {
  const ports = t.ports();
  const date = dateOf(slot);
  const spec = job === 'marketing-followups'
    ? { agent: 'marketing.followups' as const, key: `marketing.followups:${slot}`, run: (run_id: string) => enqueueDueFollowups(t.env, slot, { run_id, ports }) }
    : job === 'marketing-warmup'
      ? { agent: 'marketing.warmup' as const, key: `marketing.warmup:${date}`, run: (run_id: string) => runWarmup(t.env, date, { run_id, ports }) }
      : null;
  if (!spec) throw new ScheduleError('no_inline_job');
  const run = await openRun(ports.db, { agent: spec.agent, trigger: 'cron', idempotency_key: spec.key });
  if (!run.created) return 'exists';
  let counts: Record<string, number>;
  try {
    counts = await spec.run(run.run_id);
  } catch (e) {
    await closeQuietly(ports.db, run.run_id, { status: 'failed', error: isConfigMissing(e) ? e.message : errorName(e) }, job, slot);
    throw new ScheduleError(isConfigMissing(e) ? 'config_missing' : errorName(e));
  }
  await closeRun(ports.db, run.run_id, { status: 'succeeded', output: counts }, NO_USAGE());
  return 'created';
}

/** The flag of an open gate, or null when the gate is closed (no write happens for a closed gate). */
async function openGate(t: TickContext, entry: ScheduleEntry): Promise<{ flag: AgentFlag | null } | null> {
  if ('varName' in entry.gate) return t.env[entry.gate.varName] === 'true' ? { flag: null } : null;
  const flag = await t.flag(entry.gate.flag as AgentFlagKey);
  if (!flag.enabled) return null;
  if (entry.gate.when && !entry.gate.when(flag)) return null;
  return { flag };
}

async function fire(t: TickContext, entry: ScheduleEntry, slot: string, flag: AgentFlag | null): Promise<ScheduleOutcome> {
  if (entry.job === 'tenders') {
    if (!flag) throw new ScheduleError('no_flag');
    return fireTenders(t, slot, flag);
  }
  if (entry.action === 'scrape') return fireScrape(t, entry.job, slot);
  if (entry.action === 'workflow') return fireWorkflow(t, entry.job, slot);
  return fireInline(t, entry.job, slot);
}

/** Outcomes after which the slot is done for this isolate (a run or an instance exists). */
function settled(outcome: ScheduleOutcome, e?: unknown): boolean {
  if (outcome === 'created' || outcome === 'enqueued' || outcome === 'exists') return true;
  // The run was opened and closed 'failed' (enqueue or inline failure): a later tick finds it and skips.
  return outcome === 'error' && e instanceof ScheduleError && e.code !== 'no_flag';
}

export async function runSchedule(
  env: OpsEnv,
  scheduledTime: number,
  deps: { ports?: Ports; p5?: P5Ports; memo?: Set<string> } = {},
): Promise<ScheduleTickResult> {
  const fired: ScheduleTickResult['fired'] = [];
  let due: ReturnType<typeof dueJobs>;
  try {
    due = dueJobs(scheduledTime);
  } catch (e) {
    console.error(formatLogLine(LOG_PREFIX, `schedule tick error ${errorName(e)}`));
    return { fired };
  }
  const memo = deps.memo ?? ISOLATE_MEMO;
  pruneMemo(memo, scheduledTime);
  let ports = deps.ports;
  const flags = new Map<string, Promise<AgentFlag>>();
  const t: TickContext = {
    env,
    scheduledTime,
    ports: () => (ports ??= makePorts(env)),
    flag: (key) => {
      let read = flags.get(key);
      if (!read) flags.set(key, (read = readFlag(env, key)));
      return read;
    },
  };
  for (const { job, slot, catchUp } of due) {
    const key = memoKey(job, slot);
    if (memo.has(key)) continue;
    const entry = ENTRIES.get(job);
    if (!entry) continue;
    let outcome: ScheduleOutcome;
    let failure: unknown;
    try {
      const gate = await openGate(t, entry);
      outcome = gate ? await fire(t, entry, slot, gate.flag) : 'flag_off';
    } catch (e) {
      failure = e;
      outcome = 'error';
      logError(job, slot, e);
    }
    if (settled(outcome, failure)) memo.add(key);
    if (outcome === 'created' || outcome === 'enqueued') logLine(LOG_PREFIX, 'schedule fired', { job, slot, outcome, catch_up: catchUp });
    fired.push({ job, slot, outcome });
  }
  return { fired };
}
