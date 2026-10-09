// marketing_sender_accounts and marketing_settings reads and writes of the campaign send path (service role, Phase 4
// Db port). The OAuth grant and the Resend key in provider_config are read only through the Phase 4
// GmailTokenStore (src/db/repos/senders.ts), the single reader of that column.
//
// Rules
//   - Sender rows are listed without provider_config; a campaign's senders are its active accounts in the order of
//     sender_account_ids (the order the repo function's round-robin walks).
//   - Daily cap of a sender = warmup_enabled ? warmup_current_limit : daily_limit (repo send-campaign :337-339); a
//     missing or invalid value takes the column default (daily_limit 500, warmup_current_limit 10).
//   - Spacing between two sends of one sender = marketing_settings.delay_between_emails_seconds (0-3,600) or 30 s when
//     unset; the settings row is read as maybeSingle reads it (exactly one row, else none).
//   - emails_sent_today is a display mirror of the limiter's count for the UTC day; nothing reads it back.

import { GmailTokenStore } from '../db/repos/senders';
import type { Db } from '../db/postgrest';
import type { GmailProviderConfig } from '../ports/index';

export interface SenderRow {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  is_active: boolean;
  daily_limit: number | null;
  warmup_enabled: boolean | null;
  warmup_current_limit: number | null;
}

export const SENDER_COLUMNS = 'id,email,display_name,provider,is_active,daily_limit,warmup_enabled,warmup_current_limit';

export const DEFAULT_DAILY_LIMIT = 500;
export const DEFAULT_WARMUP_LIMIT = 10;
export const DEFAULT_SPACING_SECONDS = 30;
export const MAX_SPACING_SECONDS = 3600;

export interface MarketingSettings {
  unsubscribe_link_enabled: boolean | null;
  tracking_domain: string | null;
  delay_between_emails_seconds: number | null;
}

function count(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** The daily cap of a sender row. */
export function capOf(row: Pick<SenderRow, 'warmup_enabled' | 'warmup_current_limit' | 'daily_limit'>): number {
  return row.warmup_enabled === true ? count(row.warmup_current_limit, DEFAULT_WARMUP_LIMIT) : count(row.daily_limit, DEFAULT_DAILY_LIMIT);
}

/** Spacing in seconds from the settings value (0-3,600), 30 s when unset or invalid. */
export function spacingSecondsOf(settings: Pick<MarketingSettings, 'delay_between_emails_seconds'> | null): number {
  const v = settings?.delay_between_emails_seconds;
  if (v === null || v === undefined) return DEFAULT_SPACING_SECONDS;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_SPACING_SECONDS;
  return Math.min(MAX_SPACING_SECONDS, Math.max(0, Math.floor(n)));
}

/** The marketing_settings row as maybeSingle() reads it: exactly one row, else null. */
export async function readSettings(db: Db): Promise<MarketingSettings | null> {
  const rows = await db.select<MarketingSettings & Record<string, unknown>>('marketing_settings', {
    columns: 'unsubscribe_link_enabled,tracking_domain,delay_between_emails_seconds',
    limit: 2,
  });
  return rows.length === 1 ? (rows[0] as MarketingSettings) : null;
}

/** The active accounts among ids, in the order of ids (unknown and inactive ids are left out). */
export async function activeSenders(db: Db, ids: readonly string[]): Promise<SenderRow[]> {
  const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))];
  if (wanted.length === 0) return [];
  const rows = await db.select<SenderRow & Record<string, unknown>>('marketing_sender_accounts', {
    columns: SENDER_COLUMNS,
    filters: [
      ['id', 'in', wanted],
      ['is_active', 'eq', true],
    ],
  });
  const byId = new Map(rows.map((r) => [String(r.id).toLowerCase(), r as SenderRow]));
  return wanted.map((id) => byId.get(id.toLowerCase())).filter((r): r is SenderRow => r !== undefined);
}

/** One sender row (any state), or null. */
export async function senderRow(db: Db, id: string): Promise<SenderRow | null> {
  const rows = await db.select<SenderRow & Record<string, unknown>>('marketing_sender_accounts', {
    columns: SENDER_COLUMNS,
    filters: [['id', 'eq', id]],
    limit: 1,
  });
  return (rows[0] as SenderRow | undefined) ?? null;
}

/** provider_config of one account through the single reader of that column. */
export async function providerConfig(db: Db, accountId: string): Promise<GmailProviderConfig | null> {
  return new GmailTokenStore(db).readProviderConfig(accountId);
}

/** Writes the display mirror emails_sent_today of one account. */
export async function mirrorSentToday(db: Db, accountId: string, sentToday: number): Promise<void> {
  await db.update('marketing_sender_accounts', { emails_sent_today: sentToday }, { filters: [['id', 'eq', accountId]] });
}

/** Candidate accounts of one message: the campaign's active senders rotated so that the preferred one comes first
 *  (round-robin order after it); when the preferred one is no longer active the rotation starts where it stood. */
export function candidateOrder(senders: readonly SenderRow[], preferred: string, campaignOrder: readonly string[]): SenderRow[] {
  if (senders.length === 0) return [];
  const at = senders.findIndex((s) => s.id.toLowerCase() === preferred.toLowerCase());
  if (at >= 0) return [...senders.slice(at), ...senders.slice(0, at)];
  const rank = campaignOrder.findIndex((id) => id.toLowerCase() === preferred.toLowerCase());
  if (rank < 0) return [...senders];
  const after = senders.findIndex((s) => campaignOrder.findIndex((id) => id.toLowerCase() === s.id.toLowerCase()) > rank);
  const start = after < 0 ? 0 : after;
  return [...senders.slice(start), ...senders.slice(0, start)];
}
