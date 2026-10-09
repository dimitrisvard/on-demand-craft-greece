// The runs of a campaign send and the campaign close (PHASE5_SPEC §5.5, §5.9, §6.5; the repo function's finalise,
// supabase/functions/send-campaign/index.ts:440-448, done when the last recipient has an outcome instead of at the
// end of one long call).
//
// Rules
//   - The runs of a campaign are its agent_runs rows of agent 'marketing.send' with subject marketing_campaign/<id>
//     and an idempotency key 'marketing.send:<id>' or 'marketing.send:<id>:r<n>', newest first.
//   - closeCampaignIfDone runs after each final outcome of a campaign message: when the campaign's recipients with a
//     final outcome (src/marketing/events.ts finalCounts) reach `expected` of its newest run, one PATCH
//     marketing_campaigns?id=eq.<id>&status not 'sent' {status 'sent', sent_count, updated_at} with
//     return=representation; only the call that gets the row back closes that newest run 'succeeded' with
//     {expected, queued, sent, bounced, waiting: 0, mode}, and only while it is still 'running' (a message's own run may
//     be an earlier, failed run of a re-queued campaign).
//   - The status filter lists every other value of marketing_campaigns_status_check (draft, scheduled, sending,
//     cancelled): the same rows as status=neq.sent.

import { closeRun, EMPTY_USAGE } from '../agents/runs';
import type { Db, Row } from '../db/postgrest';
import { campaignOutcomeEvents, finalCounts } from './events';

export const SEND_AGENT = 'marketing.send';
export const CAMPAIGN_SUBJECT = 'marketing_campaign';
/** marketing_campaigns_status_check without 'sent'. */
export const NOT_SENT_STATUSES = ['draft', 'scheduled', 'sending', 'cancelled'] as const;

export interface CampaignRun {
  id: string;
  idempotency_key: string;
  status: string;
  started_at: string;
  output: Record<string, unknown> | null;
}

/** 'marketing.send:<id>' */
export function sendRunKey(campaignId: string, n: number): string {
  return n <= 1 ? `${SEND_AGENT}:${campaignId}` : `${SEND_AGENT}:${campaignId}:r${n}`;
}

function isCampaignKey(key: string, campaignId: string): boolean {
  const base = `${SEND_AGENT}:${campaignId}`;
  if (key === base) return true;
  return key.startsWith(`${base}:r`) && /^:r[0-9]+$/.test(key.slice(base.length));
}

/** The campaign's marketing.send runs, newest first. */
export async function campaignRuns(db: Db, campaignId: string): Promise<CampaignRun[]> {
  const rows = await db.select<CampaignRun & Row>('agent_runs', {
    columns: 'id,idempotency_key,status,started_at,output',
    filters: [
      ['agent', 'eq', SEND_AGENT],
      ['subject_type', 'eq', CAMPAIGN_SUBJECT],
      ['subject_id', 'eq', campaignId],
    ],
    order: [{ column: 'started_at', ascending: false }],
    limit: 100,
  });
  return (rows as CampaignRun[])
    .filter((r) => isCampaignKey(String(r.idempotency_key), campaignId))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || runNumber(b.idempotency_key) - runNumber(a.idempotency_key));
}

function runNumber(key: string): number {
  const m = /:r([0-9]+)$/.exec(key);
  return m ? Number(m[1]) : 1;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export type CloseOutcome =
  | { closed: true; sent: number; bounced: number; expected: number; run_closed: boolean }
  | { closed: false; reason: 'no_run' | 'no_expected' | 'not_done' | 'already_sent'; sent?: number; bounced?: number; expected?: number };

/** The campaign close (rules above). */
export async function closeCampaignIfDone(db: Db, campaignId: string, now: Date): Promise<CloseOutcome> {
  const runs = await campaignRuns(db, campaignId);
  const newest = runs[0];
  if (!newest) return { closed: false, reason: 'no_run' };
  const expected = num(newest.output?.expected);
  if (expected === null) return { closed: false, reason: 'no_expected' };
  const { sent, bounced } = finalCounts(await campaignOutcomeEvents(db, campaignId));
  if (sent + bounced < expected) return { closed: false, reason: 'not_done', sent, bounced, expected };
  const rows = await db.update(
    'marketing_campaigns',
    { status: 'sent', sent_count: sent, updated_at: now.toISOString() },
    { filters: [['id', 'eq', campaignId], ['status', 'in', [...NOT_SENT_STATUSES]]], returning: 'id' },
  );
  if (rows.length === 0) return { closed: false, reason: 'already_sent', sent, bounced, expected };
  let runClosed = false;
  if (newest.status === 'running') {
    const queued = num(newest.output?.queued) ?? 0;
    const mode = newest.output?.mode;
    const output: Record<string, unknown> = { expected, queued, sent, bounced, waiting: 0 };
    if (mode === 'csv' || mode === 'tags') output.mode = mode;
    await closeRun(db, newest.id, { status: 'succeeded', output }, { ...EMPTY_USAGE, by_step: {} });
    runClosed = true;
  }
  return { closed: true, sent, bounced, expected, run_closed: runClosed };
}
