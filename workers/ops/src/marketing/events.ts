// marketing_events of the campaign send path (service role, Phase 4 Db port): the one 'sent' event of a message, and
// the reads that tell which recipients of a campaign have a final outcome.
//
// Rules
//   - Every message has exactly one event row, whose id is derived from the message's idempotency key
//     (eventIdFor: SHA-256 of 'marketing_event:' + idem, written as a UUID with version 8). A retry or a redelivery
//     finds the same row (insert answers 23505), so the campaign's counts never see a message twice.
//   - The row is inserted as the repo function inserts it, before the send ({campaign_id, subscriber_id, event_type
//     'sent', metadata {} or, for a follow-up, {sequence_number, follow_up: true}}), so the tracking URLs carry its id.
//   - A 'sent' row is final once it carries the provider id (resend_email_id, set when the send succeeded); a
//     'bounced' row is final. Follow-up events (metadata.follow_up = true) never count for the campaign itself.
//   - Recipients of a campaign are counted once each (distinct subscriber): a subscriber with a final 'sent' row is
//     sent, any other subscriber with a final row bounced (a provider webhook may add a 'bounced' row to a sent mail).
//   - Reads are paged by id (the port has no count or offset); a page holds at most 1,000 rows.

import { DbError, type Db, type Row } from '../db/postgrest';
import { forEachPage } from './recipients';

export interface EventRow {
  id: string;
  campaign_id: string | null;
  subscriber_id: string | null;
  event_type: string;
  resend_email_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string;
}

export const EVENT_COLUMNS = 'id,campaign_id,subscriber_id,event_type,resend_email_id,metadata,created_at';

/** The event id of a message (rules above). */
export async function eventIdFor(idem: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`marketing_event:${idem}`)));
  const b = digest.slice(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x80; // version 8 (name-based, custom hash)
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isFollowUpEvent(e: Pick<EventRow, 'metadata'>): boolean {
  return typeof e.metadata === 'object' && e.metadata !== null && (e.metadata as { follow_up?: unknown }).follow_up === true;
}

/** True for a final event (rules above). */
export function isFinalEvent(e: Pick<EventRow, 'event_type' | 'resend_email_id'>): boolean {
  return e.event_type === 'bounced' || (e.event_type === 'sent' && typeof e.resend_email_id === 'string' && e.resend_email_id !== '');
}

export async function getEvent(db: Db, id: string): Promise<EventRow | null> {
  const rows = await db.select<EventRow & Row>('marketing_events', { columns: EVENT_COLUMNS, filters: [['id', 'eq', id]], limit: 1 });
  return (rows[0] as EventRow | undefined) ?? null;
}

/** Inserts the message's event (insert of the repo function); an existing row of that id is returned instead. */
export async function ensureEvent(db: Db, e: { id: string; campaign_id: string; subscriber_id: string; metadata: Record<string, unknown> }): Promise<{ created: boolean; event: EventRow }> {
  try {
    const rows = await db.insert<EventRow & Row>('marketing_events', { id: e.id, campaign_id: e.campaign_id, subscriber_id: e.subscriber_id, event_type: 'sent', metadata: e.metadata }, { returning: EVENT_COLUMNS });
    const row = rows[0] as EventRow | undefined;
    return { created: true, event: row ?? { id: e.id, campaign_id: e.campaign_id, subscriber_id: e.subscriber_id, event_type: 'sent', resend_email_id: null, metadata: e.metadata } };
  } catch (error) {
    if (!(error instanceof DbError) || error.code !== '23505') throw error;
    const existing = await getEvent(db, e.id);
    if (!existing) throw error;
    return { created: false, event: existing };
  }
}

/** Every 'sent' or 'bounced' event of a campaign (paged, id order). */
export async function campaignOutcomeEvents(db: Db, campaignId: string): Promise<EventRow[]> {
  const out: EventRow[] = [];
  await forEachPage<EventRow & Row & { id: string }>(
    db,
    'marketing_events',
    { columns: EVENT_COLUMNS, filters: [['campaign_id', 'eq', campaignId], ['event_type', 'in', ['sent', 'bounced']]] },
    (rows) => {
      for (const r of rows) out.push(r as EventRow);
    },
  );
  return out;
}

/** Subscribers of a campaign with any 'sent' or 'bounced' event of the campaign mail (not follow-ups). */
export function subscribersWithEvent(events: readonly EventRow[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (!isFollowUpEvent(e) && e.subscriber_id) out.add(e.subscriber_id.toLowerCase());
  return out;
}

/** Distinct recipients of the campaign mail with a final outcome: sent (a final 'sent' row) or bounced. */
export function finalCounts(events: readonly EventRow[]): { sent: number; bounced: number } {
  const sent = new Set<string>();
  const final = new Set<string>();
  for (const e of events) {
    if (isFollowUpEvent(e) || !e.subscriber_id || !isFinalEvent(e)) continue;
    const id = e.subscriber_id.toLowerCase();
    final.add(id);
    if (e.event_type === 'sent') sent.add(id);
  }
  return { sent: sent.size, bounced: final.size - sent.size };
}
