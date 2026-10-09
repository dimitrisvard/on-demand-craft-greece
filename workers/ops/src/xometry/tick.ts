// One Xometry scan per scheduled slot (Phase 5, unit X5; PHASE5_SPEC §6.4, X-1…X-3, CD5-3). The dispatcher opened
// the run 'growth.xometry:<slot>' (trigger cron) and sent one 'xometry-scan' message; xometry/queue.ts calls
// runXometryTick for it and acks afterwards. Replaces the scheduled GitHub Action (python -m xometry_bot.pipeline).
//
// Steps
//   0. run      the run must exist, still be 'running', belong to growth.xometry and carry the key
//               'growth.xometry:<slot>' of the message's slot; anything else does nothing. The tick then claims the
//               run with one conditional PATCH (output {slot, claimed_at} while the status is 'running' and the
//               output is empty), so of two deliveries of one message only the first scans and alerts.
//   1. flag     readFlag('agent.growth.xometry'); off -> close 'skipped' {reason: 'flag_off'}
//   2. overlap  another 'running' growth.xometry run that started earlier and less than 15 min ago -> 'skipped'
//               {reason: 'overlap'}. An earlier run still 'running' whose claim is 15 min old or older (a consumer
//               invocation never lasts that long) is closed 'failed' {reason: 'interrupted'}; the next slot is its
//               retry.
//   3. token    neither XOMETRY_TOKEN nor XOMETRY_COOKIE -> 'skipped' {reason: 'not_configured'}. Fingerprint = first
//               12 hex of SHA-256(token ‖ '\n' ‖ cookie); when the latest earlier run that reached the partner API
//               (output.auth 'ok' or 'rejected') was rejected with this fingerprint -> 'skipped'
//               {reason: 'token_rejected'} without any call. Alert: the rejection text when no earlier run of this
//               fingerprint sent the rejection or a reminder (a rejection seen in shadow mode sent nothing), else the
//               reminder at the 06:00 slot
//   4. expiry   a token that decodes as a JWT whose exp is within value.token_reminder_hours (default 24) -> one
//               hint per fingerprint (local decode only, no verification)
//   5. scan     PartnerClient over P5Ports.sources ('xometry'); store = PostgrestOfferStore over the Phase 4 Db
//               (assist, auto) or DryRunOfferStore (shadow: nothing written to xometry_offers, no Telegram)
//   6. compute  runComputePass for the slot's date (skipped after a failed or stopped scan)
//   7. close    'succeeded', or 'failed' when the scan threw, the compute pass failed or any offer failed (parity
//               with the Action's exit 1); output {mode, slot, auth, token_fp, scanned, preset_rejected,
//               excluded_secondary, upserted, inserted_new, needs_manual, computed, pages, page_cap_hit, partial,
//               errors (first 20, 200 characters each), alerts}
//   8. alerts   texts of xometry/alerts.ts through telegramText, after the close (kinds recorded in output.alerts
//               drive the repeat rules; shadow records them in output.alerts_shadow and sends nothing)
//   9. event    Analytics Engine point 'xometry_tick'
// Budget: the scan stops writing at 9,000 counted subrequests (PostgREST, partner and Telegram calls of this
// invocation) or after 10 min of wall time, and the run records partial: true.
// Never logged or stored: the token, the cookie, request headers or bodies; the run holds only the fingerprint.

import { formatLogLine, logLine } from '../../../shared/src/http/log';
import type { AgentEventName } from '../agents/events';
import { readFlag, type AgentFlag } from '../agents/flags';
import { closeRun, EMPTY_USAGE } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import type { Db, InsertOptions, Row, SelectOptions, UpdateOptions } from '../db/postgrest';
import { DbError } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { Ports } from '../ports/index';
import type { P5Ports } from '../ports/p5';
import { sentAlertKinds, xometryAlerts, type ScanFailureKind, type XometryAlert } from './alerts';
import { PARTNER_GRAPHQL_PATH, USER_AGENT } from './config';
import { PartnerApiError, PartnerAuthError, PartnerClient, PartnerHttpError, PartnerNetworkError } from './partner-client';
import { newScanStats, runComputePass, runScan } from './pipeline';
import { DryRunOfferStore, PostgrestOfferStore, type OfferStore } from './store';
import { XometrySchemaError } from './types';

export const XOMETRY_AGENT = 'growth.xometry';
export const XOMETRY_FLAG = 'agent.growth.xometry';
export const OVERLAP_WINDOW_MS = 15 * 60_000;
/** Age of a claim after which its tick has ended (the queue consumer's wall-time limit is 15 min). */
export const CLAIM_STALE_MS = 15 * 60_000;
/** Counted subrequests after which the scan stops writing (the platform default allows 10,000 per invocation). */
export const SUBREQUEST_STOP = 9_000;
export const WALL_STOP_MS = 10 * 60_000;
export const ERRORS_KEPT = 20;
export const ERROR_TEXT_MAX = 200;
/** Earlier runs read for the token gate and the repeat rules of the alerts. */
export const HISTORY_RUNS = 30;
export const DEFAULT_TOKEN_REMINDER_HOURS = 24;
/** Slot of the daily reminder while a token stays rejected. */
export const REMINDER_SLOT_TIME = '06:00';
/** Name of the Analytics Engine point. */
export const TICK_EVENT: AgentEventName = 'xometry_tick';

const SLOT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

export interface XometryTickInput {
  slot: string;
  run_id: string;
  /** Delivery attempt of the queue message (Analytics Engine only). */
  attempt?: number;
}

/** Budget limits (tests lower them; production uses the defaults). */
export interface XometryTickLimits {
  subrequestStop?: number;
  wallStopMs?: number;
}

export interface XometryTickResult {
  /** 'none': the run was missing or already closed, nothing was written. */
  status: 'succeeded' | 'failed' | 'skipped' | 'none';
  reason?: string;
  output?: Record<string, unknown>;
  /** Alert kinds sent (or, in shadow, the kinds that would have been sent). */
  alerts: string[];
}

interface HistoryRow {
  id: string;
  status: string;
  started_at: string;
  output: Record<string, unknown> | null;
}

/** Subrequests of one invocation, counted at the adapters this module calls. */
export class SubrequestBudget {
  used = 0;
  constructor(readonly stopAt: number = SUBREQUEST_STOP) {}
  count(n = 1): void {
    this.used += n;
  }
  get exhausted(): boolean {
    return this.used >= this.stopAt;
  }
}

/** A Db whose every request is counted. */
export function countingDb(db: Db, budget: SubrequestBudget): Db {
  return {
    select: <T extends Row = Row>(table: string, o?: SelectOptions) => {
      budget.count();
      return db.select<T>(table, o);
    },
    insert: <T extends Row = Row>(table: string, rows: Row | readonly Row[], o?: InsertOptions) => {
      budget.count();
      return db.insert<T>(table, rows, o);
    },
    update: <T extends Row = Row>(table: string, patch: Row, o: UpdateOptions) => {
      budget.count();
      return db.update<T>(table, patch, o);
    },
    rpc: <T = unknown>(name: string, args: Record<string, unknown>) => {
      budget.count();
      return db.rpc<T>(name, args);
    },
  };
}

/** A fetch whose every call is counted. */
export function countingFetch(f: typeof fetch, budget: SubrequestBudget): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    budget.count();
    return f(input, init);
  }) as typeof fetch;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First 12 hex of SHA-256(token ‖ '\n' ‖ cookie); a missing value counts as ''. */
export async function tokenFingerprint(token: string | undefined, cookie: string | undefined): Promise<string> {
  return (await sha256Hex(`${token ?? ''}\n${cookie ?? ''}`)).slice(0, 12);
}

/** exp (epoch seconds) of a token that decodes as a JWT, else null. Local decode only; nothing is verified. */
export function jwtExp(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as unknown;
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** value.borderline_exclude as Settings.from_env reads XB_BORDERLINE_EXCLUDE: trimmed, lower-cased, non-empty. */
export function borderlineExcludeOf(flag: AgentFlag): string[] {
  const list = flag.value.borderline_exclude;
  if (!Array.isArray(list)) return [];
  return list.filter((k): k is string => typeof k === 'string').map((k) => k.trim().toLowerCase()).filter((k) => k !== '');
}

function reminderHours(flag: AgentFlag): number {
  const h = flag.value.token_reminder_hours;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : DEFAULT_TOKEN_REMINDER_HOURS;
}

function cut(text: string): string {
  return text.length > ERROR_TEXT_MAX ? `${text.slice(0, ERROR_TEXT_MAX - 1)}…` : text;
}

/** Kind, HTTP status and a short message of an exception that ended the scan. */
function scanFailure(e: unknown): { kind: ScanFailureKind; status: number | null; message: string } {
  if (e instanceof PartnerApiError) return { kind: 'graphql', status: 200, message: e.message };
  if (e instanceof XometrySchemaError) return { kind: 'schema', status: 200, message: e.message };
  if (e instanceof PartnerHttpError) return { kind: 'http', status: e.status, message: e.message };
  if (e instanceof PartnerNetworkError) return { kind: e.kind, status: null, message: e.message };
  if (e instanceof DbError) return { kind: 'internal', status: e.status || null, message: `database ${e.code ?? e.status}` };
  return { kind: 'internal', status: null, message: e instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(e.name) ? e.name : 'error' };
}

/** A fixed, value-free name of an unexpected error for the run's error column and the log. */
function errorName(e: unknown): string {
  if (e instanceof DbError) return `db_error_${e.status}`;
  return e instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(e.name) ? e.name : 'error';
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** True when an earlier run of the same UTC day recorded the alert kind as sent. */
function sentToday(history: readonly HistoryRow[], kind: string, today: string): boolean {
  return history.some((r) => utcDay(String(r.started_at)) === today && sentAlertKinds(r.output).includes(kind));
}

interface Outcome {
  status: 'succeeded' | 'failed' | 'skipped';
  error?: string;
  output: Record<string, unknown>;
  alerts: XometryAlert[];
}

/** One tick for a run the dispatcher opened (see the steps above). Throws only when the run cannot be closed. */
export async function runXometryTick(env: OpsEnv, ports: Ports, p5: P5Ports, input: XometryTickInput, limits: XometryTickLimits = {}): Promise<XometryTickResult> {
  const startedAt = ports.clock.now();
  const budget = new SubrequestBudget(limits.subrequestStop ?? SUBREQUEST_STOP);
  const db = countingDb(ports.db, budget);
  const { slot, run_id } = input;
  if (!SLOT.test(slot)) throw new Error('invalid slot');

  const run = await getRun(db, run_id);
  if (!run || run.status !== 'running') {
    logLine(LOG_PREFIX, 'xometry tick ignored', { run_id, slot, run: run ? run.status : 'missing' });
    return { status: 'none', reason: run ? 'not_running' : 'run_missing', alerts: [] };
  }
  if (run.agent !== XOMETRY_AGENT || run.idempotency_key !== `${XOMETRY_AGENT}:${slot}`) {
    logLine(LOG_PREFIX, 'xometry tick ignored', { run_id, slot, run: 'not_this_slot' });
    return { status: 'none', reason: 'not_this_slot', alerts: [] };
  }
  const claimed = await db.update<{ id: string }>(
    'agent_runs',
    { output: { slot, claimed_at: startedAt.toISOString() } },
    {
      filters: [
        ['id', 'eq', run_id],
        ['status', 'eq', 'running'],
        ['output', 'is', null],
      ],
      returning: 'id',
    },
  );
  if (claimed.length === 0) {
    logLine(LOG_PREFIX, 'xometry tick ignored', { run_id, slot, run: 'claimed' });
    return { status: 'none', reason: 'claimed', alerts: [] };
  }

  let outcome: Outcome;
  let shadow = false;
  try {
    const flag = await readFlag(env, XOMETRY_FLAG);
    shadow = flag.enabled && flag.mode === 'shadow';
    outcome = flag.enabled
      ? await tick(env, ports, p5, { db, budget, flag, slot, run_id, ownStartedAt: run.started_at, startedAt, wallStopMs: limits.wallStopMs ?? WALL_STOP_MS })
      : { status: 'skipped', output: { slot, reason: 'flag_off' }, alerts: [] };
  } catch (e) {
    const name = errorName(e);
    console.error(formatLogLine(LOG_PREFIX, 'xometry tick error', { run_id, slot, error: name }));
    outcome = { status: 'failed', error: name, output: { slot, error_kind: 'internal' }, alerts: [] };
  }

  const kinds = outcome.alerts.map((a) => a.kind);
  const output: Record<string, unknown> = { ...outcome.output, ...(shadow ? { alerts_shadow: kinds } : { alerts: kinds }) };
  let closeError: unknown;
  try {
    await closeRun(db, run_id, { status: outcome.status, output, ...(outcome.error !== undefined ? { error: outcome.error } : {}) }, { ...EMPTY_USAGE, by_step: {} });
  } catch (e) {
    closeError = e;
  }
  if (!shadow) {
    for (const alert of outcome.alerts) {
      budget.count();
      await p5.telegramText.send(alert.text);
    }
  }
  ports.events.point({
    event: TICK_EVENT,
    run_id,
    agent: XOMETRY_AGENT,
    step: slot,
    outcome: typeof output.reason === 'string' ? `${outcome.status}:${output.reason}` : outcome.status,
    latency_ms: ports.clock.now().getTime() - startedAt.getTime(),
    ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
  });
  logLine(LOG_PREFIX, 'xometry tick', {
    run_id,
    slot,
    status: outcome.status,
    reason: typeof output.reason === 'string' ? output.reason : undefined,
    auth: typeof output.auth === 'string' ? output.auth : undefined,
    scanned: typeof output.scanned === 'number' ? output.scanned : undefined,
    alerts: kinds.length,
  });
  if (closeError) throw closeError;
  return { status: outcome.status, ...(typeof output.reason === 'string' ? { reason: output.reason } : {}), output, alerts: kinds };
}

interface TickContext {
  db: Db;
  budget: SubrequestBudget;
  flag: AgentFlag;
  slot: string;
  run_id: string;
  ownStartedAt: string;
  startedAt: Date;
  wallStopMs: number;
}

async function tick(env: OpsEnv, ports: Ports, p5: P5Ports, t: TickContext): Promise<Outcome> {
  const { db, budget, flag, slot, run_id } = t;
  const mode = flag.mode;
  const now = ports.clock.now();
  const today = now.toISOString().slice(0, 10);
  const base = { mode, slot };

  // 2. overlap guard and history (one read)
  const rows = await db.select<HistoryRow & Row>('agent_runs', {
    columns: 'id,status,started_at,output',
    filters: [['agent', 'eq', XOMETRY_AGENT]],
    order: [{ column: 'started_at', ascending: false }],
    limit: HISTORY_RUNS + 1,
  });
  const history = rows.filter((r) => r.id !== run_id);
  const own = Date.parse(t.ownStartedAt);
  const overlap = history.some((r) => {
    if (r.status !== 'running') return false;
    const started = Date.parse(String(r.started_at));
    if (!(now.getTime() - started < OVERLAP_WINDOW_MS)) return false;
    return started < own || (started === own && String(r.id) < run_id);
  });
  if (overlap) return { status: 'skipped', output: { ...base, reason: 'overlap' }, alerts: [] };
  for (const r of history) {
    const claimedAt = r.status === 'running' && typeof r.output?.claimed_at === 'string' ? Date.parse(r.output.claimed_at) : NaN;
    if (!(now.getTime() - claimedAt >= CLAIM_STALE_MS)) continue;
    try {
      await closeRun(db, String(r.id), { status: 'failed', error: 'interrupted', output: { ...r.output, reason: 'interrupted' } }, { ...EMPTY_USAGE, by_step: {} });
      r.status = 'failed';
    } catch (e) {
      console.error(formatLogLine(LOG_PREFIX, 'xometry interrupted run not closed', { run_id: String(r.id), error: errorName(e) }));
    }
  }

  // 3. token gate
  const token = env.XOMETRY_TOKEN || undefined;
  const cookie = env.XOMETRY_COOKIE || undefined;
  if (!token && !cookie) {
    const alerts = sentToday(history, 'not_configured', today) ? [] : [xometryAlerts.notConfigured()];
    return { status: 'skipped', output: { ...base, reason: 'not_configured', auth: 'not_configured' }, alerts };
  }
  const fp = await tokenFingerprint(token, cookie);
  const decided = history.find((r) => r.output?.auth === 'ok' || r.output?.auth === 'rejected');
  if (decided?.output?.auth === 'rejected' && decided.output.token_fp === fp) {
    const status = typeof decided.output.http_status === 'number' ? decided.output.http_status : 401;
    const rejectedAt = typeof decided.output.rejected_at === 'string' ? decided.output.rejected_at : String(decided.started_at);
    const alerted = history.some((r) => r.output?.token_fp === fp && sentAlertKinds(r.output).some((k) => k === 'token_rejected' || k === 'token_reminder'));
    const alerts = !alerted
      ? [xometryAlerts.tokenRejected(status, new Date(rejectedAt))]
      : slot.slice(11, 16) === REMINDER_SLOT_TIME
        ? [xometryAlerts.tokenReminder(status, new Date(rejectedAt))]
        : [];
    return { status: 'skipped', output: { ...base, reason: 'token_rejected', auth: 'rejected', token_fp: fp, http_status: status, rejected_at: rejectedAt }, alerts };
  }

  const alerts: XometryAlert[] = [];
  // 4. expiry hint
  const exp = jwtExp(token);
  if (exp !== null && exp * 1000 - now.getTime() < reminderHours(flag) * 3_600_000) {
    const hinted = history.some((r) => r.output?.token_fp === fp && sentAlertKinds(r.output).includes('token_expiry'));
    if (!hinted) alerts.push(xometryAlerts.tokenExpiry(new Date(exp * 1000), now));
  }

  // 5. scan
  const store: OfferStore = mode === 'shadow' ? new DryRunOfferStore() : new PostgrestOfferStore(db, ports.clock);
  const client = new PartnerClient({
    token,
    cookie,
    fetcher: countingFetch(p5.sources.fetch, budget),
    url: `${p5.sources.base('xometry')}${PARTNER_GRAPHQL_PATH}`,
    userAgent: USER_AGENT,
  });
  const deadline = t.startedAt.getTime() + t.wallStopMs;
  const shouldStop = () => budget.exhausted || ports.clock.now().getTime() >= deadline;
  const stats = newScanStats();
  let scanError: unknown;
  try {
    await runScan(store, client, { borderlineExclude: borderlineExcludeOf(flag), shouldStop }, stats);
  } catch (e) {
    scanError = e;
  }

  // 6. compute pass
  let computed = 0;
  let computeError: unknown;
  if (scanError === undefined && !stats.stopped) {
    try {
      computed = await runComputePass(store, slot.slice(0, 10), { shouldStop });
    } catch (e) {
      computeError = e;
    }
  }

  // 7. outcome
  const rejected = scanError instanceof PartnerAuthError && scanError.status !== null ? scanError : null;
  const auth = rejected ? 'rejected' : client.okAnswers > 0 ? 'ok' : 'unknown';
  const errors = stats.errors.map(cut);
  const output: Record<string, unknown> = {
    ...base,
    auth,
    token_fp: fp,
    scanned: stats.scanned,
    preset_rejected: stats.preset_rejected,
    excluded_secondary: stats.excluded_secondary,
    upserted: stats.upserted,
    inserted_new: store.insertedCount,
    needs_manual: stats.needs_manual,
    computed,
    pages: client.pagesFetched,
    page_cap_hit: client.capHit,
    partial: stats.stopped,
    errors: errors.slice(0, ERRORS_KEPT),
  };
  if (store instanceof DryRunOfferStore) output.would_write = store.writes.length;
  let error: string | undefined;
  if (rejected) {
    output.http_status = rejected.status;
    output.rejected_at = now.toISOString();
    error = 'token_rejected';
    alerts.push(xometryAlerts.tokenRejected(rejected.status as number, now));
  } else if (scanError !== undefined) {
    const f = scanFailure(scanError);
    output.error_kind = f.kind;
    if (f.status !== null) output.http_status = f.status;
    errors.unshift(cut(`scan: ${f.message}`));
    output.errors = errors.slice(0, ERRORS_KEPT);
    error = `scan_failed:${f.kind}`;
    if (!sentToday(history, `scan_failed:${f.kind}`, today)) alerts.push(xometryAlerts.scanFailed(f.kind, f.status, f.message));
  } else if (computeError !== undefined) {
    output.error_kind = 'compute';
    error = `compute_failed:${errorName(computeError)}`;
  }
  if (stats.errors.length > 0) {
    error ??= 'offer_errors';
    alerts.push(xometryAlerts.offerErrors(stats.errors.length, stats.errors[0]));
  }
  if (client.capHit && !sentToday(history, 'page_cap', today)) alerts.push(xometryAlerts.pageCap());
  if (flag.value.notify_new === true && store.insertedCount > 0) alerts.push(xometryAlerts.newOffers(store.insertedCount, stats.needs_manual));
  return { status: error === undefined ? 'succeeded' : 'failed', ...(error !== undefined ? { error } : {}), output, alerts };
}
