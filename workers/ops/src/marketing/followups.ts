// Marketing follow-ups (Phase 5, unit M5; off unless MARKETING_FOLLOWUPS_ENABLED is "true"): enqueues the due
// follow-up mails of the slot as 'followup' messages on "outbound-mail", ported from
// supabase/functions/process-followups/index.ts:61-215. The dispatcher (src/cron/run-schedule.ts) opens the run
// 'marketing.followups:<slot>' and closes it with the returned counts.
//
// Rules (as the repo function, with the send moved to the outbound-mail consumer)
//   - Candidates: marketing_campaign_recipients with status 'pending' and sequence_number > 1 (paged by id).
//   - Subscriber not active, or one who has replied (replied_at set) -> the row becomes 'skipped' (:96-114).
//   - Base time: sent_at of the same subscriber's row of the previous sequence; for sequence 2 without such a row,
//     the first 'sent' event of the campaign and subscriber (:116-146). No base yet -> not due.
//   - Due when base + delay_days days <= the slot time (:153-157).
//   - A due row whose message already has its event (src/marketing/events.ts; the mail is being or was sent) is not
//     queued again.
//   - Message: kind 'followup', sequence = the row's sequence_number, subject = custom_subject or "Following up"
//     (personalised by the consumer), preferred_account_id null (the repo sends follow-ups from the default identity,
//     :187-192), idem 'camp:<campaign>:<subscriber>:<sequence>', run_id = the dispatcher's run.
//   - With OUTBOUND_MAIL_STOPPED or OUTBOUND_MAIL_PAUSED = "true" nothing is queued (held mail would pile up hour
//     after hour); the counts say so.
//   - Returns counts only (no address, subject or body).

import { need } from '../agents/config';
import type { Db, Row } from '../db/postgrest';
import type { OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import type { OutboundMailV1 } from '../queues/messages';
import { eventIdFor, getEvent } from './events';
import { forEachPage } from './recipients';

/** Counts written to the run output (no addresses). */
export type MarketingJobCounts = Record<string, number>;

export const DEFAULT_FOLLOWUP_SUBJECT = 'Following up';
const DAY_MS = 86_400_000;
const SEND_BATCH_MAX = 100;

interface FollowUpRow {
  id: string;
  campaign_id: string | null;
  subscriber_id: string | null;
  sequence_number: number | null;
  delay_days: number | null;
  custom_subject: string | null;
}

interface SubscriberRow {
  id: string;
  status: string | null;
  replied_at: string | null;
}

/** Slot 'YYYY-MM-DDTHH:MMZ' as epoch ms. */
export function slotTime(slot: string): number {
  const t = Date.parse(slot.replace(/Z$/, ':00Z'));
  if (!Number.isFinite(t)) throw new Error('enqueueDueFollowups: invalid slot');
  return t;
}

async function subscriberOf(db: Db, id: string): Promise<SubscriberRow | null> {
  const rows = await db.select<SubscriberRow & Row>('marketing_subscribers', { columns: 'id,status,replied_at', filters: [['id', 'eq', id]], limit: 1 });
  return (rows[0] as SubscriberRow | undefined) ?? null;
}

async function baseTime(db: Db, row: FollowUpRow, campaignId: string, subscriberId: string): Promise<number | null> {
  const prevSeq = (row.sequence_number as number) - 1;
  const prev = await db.select<{ sent_at: string | null; status: string | null }>('marketing_campaign_recipients', {
    columns: 'sent_at,status',
    filters: [['campaign_id', 'eq', campaignId], ['subscriber_id', 'eq', subscriberId], ['sequence_number', 'eq', prevSeq]],
    limit: 1,
  });
  const sentAt = prev[0]?.sent_at;
  if (sentAt) {
    const t = Date.parse(sentAt);
    return Number.isFinite(t) ? t : null;
  }
  if (prevSeq !== 1) return null;
  const events = await db.select<{ created_at: string }>('marketing_events', {
    columns: 'created_at',
    filters: [['campaign_id', 'eq', campaignId], ['subscriber_id', 'eq', subscriberId], ['event_type', 'eq', 'sent']],
    order: [{ column: 'created_at', ascending: true }],
    limit: 1,
  });
  const created = events[0]?.created_at;
  const t = created ? Date.parse(created) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

export async function enqueueDueFollowups(
  env: OpsEnv,
  slot: string,
  o?: { run_id?: string; ports?: Ports },
): Promise<MarketingJobCounts> {
  need(env, 'OUTBOUND_MAIL');
  const queue = env.OUTBOUND_MAIL;
  const now = slotTime(slot);
  const counts = { candidates: 0, enqueued: 0, skipped: 0, not_due: 0, in_flight: 0, held: 0 };
  if (env.OUTBOUND_MAIL_STOPPED === 'true' || env.OUTBOUND_MAIL_PAUSED === 'true') {
    counts.held = 1;
    return counts;
  }
  const db = (o?.ports ?? makePorts(env)).db;
  const runId = o?.run_id ?? `marketing.followups:${slot}`;
  const due: OutboundMailV1[] = [];
  const rows: FollowUpRow[] = [];
  await forEachPage<FollowUpRow & Row>(
    db,
    'marketing_campaign_recipients',
    { columns: 'id,campaign_id,subscriber_id,sequence_number,delay_days,custom_subject', filters: [['status', 'eq', 'pending'], ['sequence_number', 'gte', 2]] },
    (page) => {
      rows.push(...(page as FollowUpRow[]));
    },
  );
  // The repo walks the rows by sequence_number (ascending); the id order breaks ties.
  rows.sort((a, b) => Number(a.sequence_number) - Number(b.sequence_number));
  for (const row of rows) {
    const campaignId = row.campaign_id;
    const subscriberId = row.subscriber_id;
    const sequence = row.sequence_number;
    if (!campaignId || !subscriberId || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 2) continue;
    counts.candidates += 1;
    const sub = await subscriberOf(db, subscriberId);
    if (!sub || sub.status !== 'active' || sub.replied_at) {
      await db.update('marketing_campaign_recipients', { status: 'skipped' }, { filters: [['id', 'eq', row.id], ['status', 'eq', 'pending']] });
      counts.skipped += 1;
      continue;
    }
    const base = await baseTime(db, row, campaignId, subscriberId);
    const delayDays = typeof row.delay_days === 'number' && Number.isFinite(row.delay_days) ? row.delay_days : 0;
    if (base === null || now < base + delayDays * DAY_MS) {
      counts.not_due += 1;
      continue;
    }
    const idem = `camp:${campaignId}:${subscriberId}:${sequence}`;
    if (await getEvent(db, await eventIdFor(idem))) {
      counts.in_flight += 1;
      continue;
    }
    due.push({
      v: 1,
      kind: 'followup',
      campaign_id: campaignId,
      subscriber_id: subscriberId,
      recipient_record_id: row.id,
      sequence,
      subject: row.custom_subject || DEFAULT_FOLLOWUP_SUBJECT,
      preferred_account_id: null,
      idem,
      run_id: runId,
      deferrals: 0,
    });
  }
  for (let i = 0; i < due.length; i += SEND_BATCH_MAX) {
    const chunk = due.slice(i, i + SEND_BATCH_MAX);
    await queue.sendBatch(chunk.map((body) => ({ body })));
    counts.enqueued += chunk.length;
  }
  return counts;
}
