// Stuck items of the ops digest (PHASE5_SPEC §6.6; AGENTS.md §3.6 step `stuck`; D-18).
//
// Rules
//   - Point in time (read when the digest runs): agent_runs 'running' or 'waiting_human' that started more than
//     48 h before `now`; quote_workflows in 'awaiting_approval'.
//   - Week-bound (the reported window, same rules as scripts/phase5/parity.sql Q12b): final failures of the queue
//     consumers = agent_runs with trigger 'queue' and status 'failed' (each consumer records its final failure
//     there, so no Cloudflare API credential is needed); cad_jobs enqueued in the week that ended 'failed',
//     'timed_out' or 'dead_letter'.
//   - Lists keep at most STUCK_LIST_MAX entries (oldest first) with ids and times only; counts cover every row.

import type { Db, Row } from '../db/postgrest';
import { readAll, type DigestWindow } from './collect';

export const STALE_AFTER_MS = 48 * 3_600_000;
export const STUCK_LIST_MAX = 20;
export const CAD_FAILED_STATUSES = ['failed', 'timed_out', 'dead_letter'] as const;

export interface StuckReport {
  as_of: string;
  stale_runs: { count: number; items: Array<{ run_id: string; agent: string; status: string; started_at: string }> };
  quotes_awaiting_approval: { count: number; items: Array<{ quote_workflow_id: string; rfq_id: string; since: string }> };
  queue_failures: Record<string, number>;
  cad_failed: number;
}

function byTime<T>(key: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => Date.parse(key(a)) - Date.parse(key(b));
}

export async function collectStuck(db: Db, w: DigestWindow, now: Date): Promise<StuckReport> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const stale = await readAll<Row>(db, 'agent_runs', 'id,agent,status,started_at', [
    ['status', 'in', ['running', 'waiting_human']],
    ['started_at', 'lt', staleBefore],
  ]);
  const staleItems = stale
    .map((r) => ({ run_id: String(r.id), agent: String(r.agent), status: String(r.status), started_at: String(r.started_at) }))
    .sort(byTime((x) => x.started_at));

  const awaiting = await readAll<Row>(db, 'quote_workflows', 'id,rfq_id,updated_at', [['status', 'eq', 'awaiting_approval']]);
  const awaitingItems = awaiting
    .map((r) => ({ quote_workflow_id: String(r.id), rfq_id: String(r.rfq_id), since: String(r.updated_at) }))
    .sort(byTime((x) => x.since));

  const failures = await readAll<Row>(db, 'agent_runs', 'id,agent', [
    ['status', 'eq', 'failed'],
    ['trigger', 'eq', 'queue'],
    ['started_at', 'gte', w.start],
    ['started_at', 'lt', w.end],
  ]);
  const queue_failures: Record<string, number> = {};
  for (const r of failures) queue_failures[String(r.agent)] = (queue_failures[String(r.agent)] ?? 0) + 1;

  const cad = await readAll<Row>(db, 'cad_jobs', 'id', [
    ['status', 'in', [...CAD_FAILED_STATUSES]],
    ['enqueued_at', 'gte', w.start],
    ['enqueued_at', 'lt', w.end],
  ]);

  return {
    as_of: now.toISOString(),
    stale_runs: { count: staleItems.length, items: staleItems.slice(0, STUCK_LIST_MAX) },
    quotes_awaiting_approval: { count: awaitingItems.length, items: awaitingItems.slice(0, STUCK_LIST_MAX) },
    queue_failures: Object.fromEntries(Object.entries(queue_failures).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    cad_failed: cad.length,
  };
}
