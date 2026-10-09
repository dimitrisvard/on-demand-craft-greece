// Shared run lifecycle of the scheduled collectors (Phase 5, unit G5): the ports of a handler, the state of the run
// the dispatcher opened, value-free error codes, a close that never throws, and the log line.
//
// Rules
//   - Ports come from the handler's deps when given (tests), else from makePorts(env) / makeP5Ports(env).
//   - errorCode() names a fixed code or an error class, never the text of a provider or database answer.
//   - closeQuietly() logs a failed close (run id and code only) and never throws: the message is settled by the
//     handler either way.
//   - Log lines carry the job, run id, counts and codes only, never a URL with a query, a body or a lead's text.

import { formatLogLine } from '../../../shared/src/http/log';
import { isConfigMissing } from '../agents/config';
import { closeRun, EMPTY_USAGE, isFinal, type UsageAcc } from '../agents/runs';
import { DbError, type Db } from '../db/postgrest';
import { getRun } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import type { HnScanParams, RedditTierParams, TenderScheduledParams } from '../queues/messages';

/** Options of the collector handler factories (tests replace the waits). */
export interface CollectorOptions {
  /** Pause between source calls (default: a real timer). */
  sleep?: (ms: number) => Promise<void>;
}

export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Timeout of one source request (PullPush, Algolia). */
export const SOURCE_TIMEOUT_MS = 30_000;

export function portsOf(env: OpsEnv, deps?: { ports?: Ports; p5?: P5Ports }): { ports: Ports; p5: P5Ports } {
  return { ports: deps?.ports ?? makePorts(env), p5: deps?.p5 ?? makeP5Ports(env) };
}

export const noUsage = (): UsageAcc => ({ ...EMPTY_USAGE, by_step: {} });

/** An error whose name is a fixed code (for run rows and log lines). */
export class CollectorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CollectorError';
  }
}

/** Fixed code of a failure: never the message of a provider or database answer. */
export function errorCode(e: unknown): string {
  if (e instanceof CollectorError) return e.code;
  if (isConfigMissing(e)) return `config_missing: ${(Array.isArray(e.names) ? e.names : []).join(', ')}`.slice(0, 200);
  if (e instanceof DbError) return `db_error ${e.status}${e.code && /^[A-Za-z0-9_]{1,16}$/.test(e.code) ? ` ${e.code}` : ''}`;
  const name = e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) ? e.name : 'error';
  return name === 'Error' ? 'error' : name;
}

/** State of the run the dispatcher opened: 'running' (work to do), 'final' (a redelivery after the close), or
 *  'missing'. */
export async function runState(db: Db, runId: string): Promise<'running' | 'final' | 'missing'> {
  const row = await getRun(db, runId);
  if (!row) return 'missing';
  return isFinal(row.status) ? 'final' : 'running';
}

/** closeRun that never throws (a failed close is logged with the run id and the code). */
export async function closeQuietly(
  db: Db,
  runId: string,
  outcome: { status: 'succeeded' | 'failed' | 'skipped'; error?: string; output?: unknown },
  job: string,
): Promise<boolean> {
  try {
    await closeRun(db, runId, outcome, noUsage());
    return true;
  } catch (e) {
    console.error(formatLogLine(LOG_PREFIX, `collector ${job} close failed`, { run_id: runId, error: errorCode(e) }));
    return false;
  }
}

export function logCollector(job: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, `collector ${job}`, fields));
}

// Param checks of the three collector kinds (the same shapes src/queues/scrapes-p5.ts checks before sending). They
// live here because scrapes-p5.ts imports the handlers: a runtime import back from it would be circular.
const SLOT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** RedditTierParams: tier 1-3, max 40, slot YYYY-MM-DDTHH:MMZ. */
export function isRedditTierParams(x: unknown): x is RedditTierParams {
  const p = record(x);
  return p !== null && (p.tier === 1 || p.tier === 2 || p.tier === 3) && p.max === 40 && typeof p.slot === 'string' && SLOT.test(p.slot);
}

/** HnScanParams: slot YYYY-MM-DDTHH:MMZ. */
export function isHnScanParams(x: unknown): x is HnScanParams {
  const p = record(x);
  return p !== null && typeof p.slot === 'string' && SLOT.test(p.slot);
}

/** TenderScheduledParams: a 2-3 letter country code and a date YYYY-MM-DD. */
export function isTenderScheduledParams(x: unknown): x is TenderScheduledParams {
  const p = record(x);
  return p !== null && typeof p.country_code === 'string' && /^[A-Za-z]{2,3}$/.test(p.country_code) && typeof p.date === 'string' && DATE.test(p.date);
}

/** {<status>: n} counter of source answers ('error' for a request that threw). */
export function countStatus(map: Record<string, number>, status: number | 'error'): void {
  const key = String(status);
  map[key] = (map[key] ?? 0) + 1;
}
