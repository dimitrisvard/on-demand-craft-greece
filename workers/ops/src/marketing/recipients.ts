// Campaign rows and the recipient selection of a campaign send, ported from
// supabase/functions/send-campaign/index.ts:191-285 (service role, Phase 4 Db port).
//
// Rules
//   - Mode 'csv' when the campaign has marketing_campaign_recipients rows with sequence_number = 1 and status
//     'pending' (the repo's test, :222-240); recipients are those rows whose subscriber is active, subject
//     custom_subject or subject_a, body read later from the row (custom_body or the campaign body).
//   - Mode 'tags' otherwise: active subscribers, narrowed to those with at least one of target_tags when the campaign
//     has any (:255-270); subject_a, or subject_b for a draw above 0.5 when ab_test_config.enabled and subject_b is
//     set (:272-276); the draw comes from the injectable random source.
//   - A re-queue (a later run of the same campaign) keeps the mode of the campaign's first run, so it never widens a
//     CSV campaign to every tagged subscriber.
//   - Reads are paged (1,000 rows per request, the PostgREST row cap) and ordered by id; a subscriber is selected
//     once (the first row wins). The selection holds ids and the chosen subject only, never an address or a body.

import type { Db, Filter, Row } from '../db/postgrest';
import { defaultRandom, type RandomSource } from './personalise';

export const PAGE_ROWS = 1000;
/** Ids per in.(…) list of a subscriber lookup (keeps the request line short). */
const ID_CHUNK = 100;

export interface CampaignRow {
  id: string;
  name: string | null;
  subject_a: string;
  subject_b: string | null;
  body: string;
  status: string | null;
  target_tags: string[] | null;
  ab_test_config: { enabled?: unknown } | null;
  sender_account_ids: string[] | null;
}

export const CAMPAIGN_COLUMNS = 'id,name,subject_a,subject_b,body,status,target_tags,ab_test_config,sender_account_ids';

export type RecipientMode = 'csv' | 'tags';

export interface SelectedRecipient {
  subscriber_id: string;
  recipient_record_id: string | null;
  subject: string;
}

function withId(columns: string): string {
  const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
  return cols.includes('id') || cols.includes('*') ? cols.join(',') : ['id', ...cols].join(',');
}

/** Calls onPage for every page of rows matching the filters, in id order (keyed by the last id read). */
export async function forEachPage<T extends Row & { id: string }>(
  db: Db,
  table: string,
  o: { columns: string; filters?: readonly Filter[]; pageSize?: number },
  onPage: (rows: T[]) => Promise<void> | void,
): Promise<number> {
  const pageSize = Math.max(2, o.pageSize ?? PAGE_ROWS);
  const columns = withId(o.columns);
  let last: string | null = null;
  let total = 0;
  for (;;) {
    const filters: Filter[] = [...(o.filters ?? [])];
    if (last !== null) filters.push(['id', 'gte', last]);
    const rows = await db.select<T>(table, { columns, filters, order: [{ column: 'id', ascending: true }], limit: pageSize });
    const fresh = last !== null && rows.length > 0 && String(rows[0]?.id) === last ? rows.slice(1) : rows;
    if (fresh.length > 0) {
      await onPage(fresh);
      total += fresh.length;
    }
    if (rows.length < pageSize || fresh.length === 0) break;
    last = String(rows[rows.length - 1]?.id);
  }
  return total;
}

export async function loadCampaign(db: Db, id: string): Promise<CampaignRow | null> {
  const rows = await db.select<CampaignRow & Row>('marketing_campaigns', { columns: CAMPAIGN_COLUMNS, filters: [['id', 'eq', id]], limit: 1 });
  return (rows[0] as CampaignRow | undefined) ?? null;
}

interface CsvRow {
  id: string;
  subscriber_id: string | null;
  custom_subject: string | null;
}

interface SubscriberRow {
  id: string;
  status: string | null;
  tags: unknown;
}

/** Active subscribers among ids (status 'active'). */
async function activeAmong(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const rows = await db.select<SubscriberRow & Row>('marketing_subscribers', { columns: 'id,status', filters: [['id', 'in', chunk]] });
    for (const r of rows) if (r.status === 'active') out.add(String(r.id).toLowerCase());
  }
  return out;
}

async function pendingCsvRows(db: Db, campaignId: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  await forEachPage<CsvRow & Row>(
    db,
    'marketing_campaign_recipients',
    { columns: 'id,subscriber_id,custom_subject', filters: [['campaign_id', 'eq', campaignId], ['sequence_number', 'eq', 1], ['status', 'eq', 'pending']] },
    (page) => {
      rows.push(...(page as CsvRow[]));
    },
  );
  return rows;
}

function tagsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * The recipients of a campaign send (rules above). `mode` forces the mode of an earlier run; without it the mode is
 * decided as the repo function decides it.
 */
export async function selectRecipients(
  db: Db,
  campaign: CampaignRow,
  o: { random?: RandomSource; mode?: RecipientMode } = {},
): Promise<{ mode: RecipientMode; recipients: SelectedRecipient[] }> {
  const random = o.random ?? defaultRandom;
  const seen = new Set<string>();
  const recipients: SelectedRecipient[] = [];
  const csv = o.mode === 'tags' ? [] : await pendingCsvRows(db, campaign.id);
  if (o.mode === 'csv' || (o.mode === undefined && csv.length > 0)) {
    const ids = [...new Set(csv.map((r) => r.subscriber_id).filter((id): id is string => typeof id === 'string' && id !== ''))];
    const active = await activeAmong(db, ids);
    for (const row of csv) {
      const sid = row.subscriber_id;
      if (!sid || !active.has(sid.toLowerCase()) || seen.has(sid.toLowerCase())) continue;
      seen.add(sid.toLowerCase());
      recipients.push({ subscriber_id: sid, recipient_record_id: row.id, subject: row.custom_subject || campaign.subject_a });
    }
    return { mode: 'csv', recipients };
  }
  const targets = tagsOf(campaign.target_tags);
  const ab = Boolean(campaign.ab_test_config?.enabled) && Boolean(campaign.subject_b);
  await forEachPage<SubscriberRow & Row>(db, 'marketing_subscribers', { columns: 'id,status,tags', filters: [['status', 'eq', 'active']] }, (page) => {
    for (const sub of page) {
      const sid = String(sub.id);
      if (seen.has(sid.toLowerCase())) continue;
      if (targets.length > 0) {
        const own = tagsOf(sub.tags);
        if (!targets.some((t) => own.includes(t))) continue;
      }
      seen.add(sid.toLowerCase());
      let subject = campaign.subject_a;
      if (ab && random() > 0.5) subject = campaign.subject_b as string;
      recipients.push({ subscriber_id: sid, recipient_record_id: null, subject });
    }
  });
  return { mode: 'tags', recipients };
}
