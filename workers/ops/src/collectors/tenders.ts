// Scheduled tender scan (Phase 5, unit G5): handler of the scrapes kind 'tender-scheduled' (one message per due
// connector, sent by the 06:00 dispatcher under the parent run growth.tenders:<date>). It opens the child run and
// runs api/tender-scan.js in-process, exactly as the Phase 2 scrapes consumer does for the kind 'tender-scan'
// (src/queues/scrapes.ts stays unchanged; same synthetic request, same 840 s deadline).
//
// Per message
//   1. child run growth.tenders:<date>:<CC> (CC upper-case), trigger 'queue', parent_run_id = the message's run_id;
//      an existing final child -> ack; an existing running child is this message's own retry -> continue under it
//   2. flag agent.growth.tenders re-read: off -> child 'skipped' {reason: 'flag_off'}, ack; shadow -> child
//      'skipped' {reason: 'shadow'}, ack (the handler writes tenders and sends alerts itself, so it never runs in
//      shadow)
//   3. POST /api/tender-scan with JSON {country_code} through runNodeHandler
//   4. 2xx -> child 'succeeded' with {status, country_code, tenders_found, tenders_new, tenders_relevant, errors
//      (the number of connector errors), duration_ms} from the handler's JSON; ack
//      3xx/4xx -> child 'failed' (error handler_<status>), ack (the scan can never succeed)
//      5xx (incl. the shim's 504 at the deadline) or a throw -> retry({delaySeconds: 300}) under the same child;
//      the final delivery (attempts > 3, the Phase 2 counting rule) closes the child 'failed' and retries into
//      scrapes-dlq
// The connector error texts of the handler's answer are never stored or logged, only their number.

import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { readFlag } from '../agents/flags';
import { isFinal, openRun } from '../agents/runs';
import { LOG_PREFIX } from '../env';
import { makePorts } from '../ports/index';
import type { P5ScrapeHandler } from '../queues/scrapes-p5';
import { closeQuietly, errorCode, isTenderScheduledParams, logCollector } from './common';

export const TENDERS_FLAG = 'agent.growth.tenders' as const;
/** The handler's own route (the Phase 2 SCRAPE_FUNCTION_PATHS entry of 'tender-scan'). */
export const TENDER_SCAN_PATH = '/api/tender-scan';
// The synthetic request never leaves the isolate; the host only gives the handler an absolute URL (as Phase 2).
const SYNTHETIC_ORIGIN = 'https://microns-ops.internal';
// The Phase 2 scrapes values (src/queues/scrapes.ts CONSUMER_TIMEOUT_MS, RETRY_DELAY_SECONDS, MAX_RETRIES; a test
// pins the equality). Kept here so this module does not load the Phase 2 consumer.
/** Deadline of one handler run, under the 15-minute consumer wall-time limit. */
export const CONSUMER_TIMEOUT_MS = 840_000;
/** Delay before a failed scan is delivered again. */
export const RETRY_DELAY_SECONDS = 300;
/** max_retries of the scrapes consumer: the delivery with attempts > 3 is the final one. */
export const MAX_RETRIES = 3;

export type TenderHandlerLoader = () => Promise<{ default: VercelHandler }>;

export interface TenderScheduledOptions {
  /** Loader of api/tender-scan.js (tests pass a fake handler). */
  load?: TenderHandlerLoader;
  /** Deadline of the handler (default the Phase 2 consumer deadline, 840 s). */
  timeoutMs?: number;
}

/** Child run key of a connector scan. */
export function tenderChildKey(date: string, countryCode: string): string {
  return `growth.tenders:${date}:${countryCode.toUpperCase()}`;
}

function count(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** The counts of the handler's JSON answer (never its error texts). */
export async function tenderCounts(response: Response): Promise<Record<string, number | string>> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return {};
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const d = data as Record<string, unknown>;
  const out: Record<string, number | string> = {};
  if (typeof d.country_code === 'string' && /^[A-Z]{2,3}$/.test(d.country_code)) out.country_code = d.country_code;
  for (const key of ['tenders_found', 'tenders_new', 'tenders_relevant', 'duration_ms'] as const) {
    const v = count(d[key]);
    if (v !== undefined) out[key] = v;
  }
  if (Array.isArray(d.errors)) out.errors = d.errors.length;
  return out;
}

export function makeTenderScheduledHandler(o: TenderScheduledOptions = {}): P5ScrapeHandler {
  const load: TenderHandlerLoader = o.load ?? (() => import('../../../../api/tender-scan.js') as Promise<{ default: VercelHandler }>);
  const timeoutMs = o.timeoutMs ?? CONSUMER_TIMEOUT_MS;
  return async (msg, env, ctx, deps) => {
    const parentRunId = msg.body.run_id;
    if (msg.body.kind !== 'tender-scheduled' || !isTenderScheduledParams(msg.body.params)) {
      logCollector('tenders', { run_id: parentRunId, outcome: 'invalid_params' });
      msg.ack();
      return;
    }
    const { country_code: countryCode, date } = msg.body.params;
    const cc = countryCode.toUpperCase();
    const db = (deps?.ports ?? makePorts(env)).db;
    const final = msg.attempts > MAX_RETRIES;

    // 1 child run (a throw here leaves the message to the consumer's tender rule: retry after 300 s)
    const child = await openRun(db, {
      agent: 'growth.tenders',
      trigger: 'queue',
      idempotency_key: tenderChildKey(date, cc),
      parent_run_id: parentRunId,
    });
    const fields = { country_code: cc, run_id: child.run_id, attempts: msg.attempts };
    if (!child.created && isFinal(child.status)) {
      logCollector('tenders', { ...fields, outcome: 'already_closed' });
      msg.ack();
      return;
    }

    // 2 flag
    const flag = await readFlag(env, TENDERS_FLAG);
    if (!flag.enabled || flag.mode === 'shadow') {
      const reason = flag.enabled ? 'shadow' : 'flag_off';
      await closeQuietly(db, child.run_id, { status: 'skipped', output: { reason, country_code: cc } }, 'tenders');
      logCollector('tenders', { ...fields, outcome: reason });
      msg.ack();
      return;
    }

    // 3 the handler, in-process
    let response: Response;
    try {
      const { default: handler } = await load();
      const request = new Request(`${SYNTHETIC_ORIGIN}${TENDER_SCAN_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
      response = await runNodeHandler(handler, {
        request,
        functionUrl: TENDER_SCAN_PATH,
        body: new TextEncoder().encode(JSON.stringify({ country_code: countryCode })),
        ctx,
        timeoutMs,
        logPrefix: LOG_PREFIX,
      });
    } catch (e) {
      const code = errorCode(e);
      if (final) {
        await closeQuietly(db, child.run_id, { status: 'failed', error: 'handler_threw', output: { country_code: cc, attempts: msg.attempts } }, 'tenders');
        logCollector('tenders', { ...fields, status: 'threw', error: code, outcome: 'dead-letter' });
        msg.retry();
        return;
      }
      logCollector('tenders', { ...fields, status: 'threw', error: code, outcome: 'retry' });
      msg.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      return;
    }

    // 4 outcome by status
    const counts = await tenderCounts(response.clone());
    const output = { status: response.status, country_code: cc, ...counts };
    if (response.status >= 200 && response.status < 300) {
      await closeQuietly(db, child.run_id, { status: 'succeeded', output }, 'tenders');
      logCollector('tenders', { ...fields, status: response.status, found: counts.tenders_found, new: counts.tenders_new, outcome: 'ack' });
      msg.ack();
      return;
    }
    if (response.status < 500) {
      await closeQuietly(db, child.run_id, { status: 'failed', error: `handler_${response.status}`, output }, 'tenders');
      logCollector('tenders', { ...fields, status: response.status, outcome: 'ack' });
      msg.ack();
      return;
    }
    if (final) {
      await closeQuietly(db, child.run_id, { status: 'failed', error: `handler_${response.status}`, output: { ...output, attempts: msg.attempts } }, 'tenders');
      logCollector('tenders', { ...fields, status: response.status, outcome: 'dead-letter' });
      msg.retry();
      return;
    }
    logCollector('tenders', { ...fields, status: response.status, outcome: 'retry' });
    msg.retry({ delaySeconds: RETRY_DELAY_SECONDS });
  };
}

export const handleTenderScheduled: P5ScrapeHandler = makeTenderScheduledHandler();
