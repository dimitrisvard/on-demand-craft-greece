// Gmail sender accounts of the reply poller and the campaign-reply bookkeeping it keeps (service role, Db port).
//
// Rules
//   - Accounts are listed without their provider_config; the stored OAuth grant of one account is read only through
//     GmailTokenStore.readProviderConfig(accountId), the single reader of that column in this Worker, so a later move
//     of the grants to another table changes this module only.
//   - Nothing here writes a token back, logs a token or returns one beyond the caller that needs it for one tick.
//   - Campaign replies keep the semantics of supabase/functions/check-replies/index.ts:110-140: the subscriber is
//     found by the lower-cased sender address; replied_at is set once (only while it is null) and one
//     marketing_events row 'replied' with {gmail_message_id, from_account} is written for that change. The event
//     insert is best effort, as there (index.ts:127-137): a failed insert is logged with the subscriber id only and
//     the reply still counts, because replied_at is the state the campaigns read.

import { formatLogLine } from '../../../../shared/src/http/log';
import { LOG_PREFIX } from '../../env';
import type { GmailProviderConfig } from '../../ports/index';
import type { Db } from '../postgrest';

export interface SenderAccount {
  id: string;
  email: string;
  provider: string;
  is_active: boolean;
}

/** Active Google Workspace sender accounts (without their grants). */
export async function activeGoogleAccounts(db: Db): Promise<SenderAccount[]> {
  return db.select<SenderAccount & Record<string, unknown>>('marketing_sender_accounts', {
    columns: 'id,email,provider,is_active',
    filters: [
      ['provider', 'eq', 'google_workspace'],
      ['is_active', 'eq', true],
    ],
    order: [{ column: 'id', ascending: true }],
    limit: 20,
  });
}

/** The only reader of marketing_sender_accounts.provider_config. */
export class GmailTokenStore {
  constructor(private readonly db: Db) {}

  async readProviderConfig(accountId: string): Promise<GmailProviderConfig | null> {
    const rows = await this.db.select<{ provider_config: unknown }>('marketing_sender_accounts', {
      columns: 'provider_config',
      filters: [['id', 'eq', accountId]],
      limit: 1,
    });
    const config = rows[0]?.provider_config;
    return typeof config === 'object' && config !== null && !Array.isArray(config) ? (config as GmailProviderConfig) : null;
  }
}

/** The campaign subscriber of a sender address (lower-cased exact match), or null. */
export async function campaignSubscriber(db: Db, address: string): Promise<{ id: string; replied_at: string | null } | null> {
  const email = address.trim().toLowerCase();
  if (!email) return null;
  const rows = await db.select<{ id: string; replied_at: string | null }>('marketing_subscribers', {
    columns: 'id,replied_at',
    filters: [['email', 'eq', email]],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Sets replied_at once and writes the 'replied' event; false when the subscriber had replied already. */
export async function recordCampaignReply(db: Db, subscriberId: string, meta: { gmail_message_id: string; from_account: string }, now: Date): Promise<boolean> {
  const changed = await db.update('marketing_subscribers', { replied_at: now.toISOString() }, {
    filters: [
      ['id', 'eq', subscriberId],
      ['replied_at', 'is', null],
    ],
    returning: 'id',
  });
  if (changed.length === 0) return false;
  try {
    await db.insert('marketing_events', { subscriber_id: subscriberId, campaign_id: null, event_type: 'replied', metadata: meta });
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'campaign reply event not written', { subscriber_id: subscriberId }));
  }
  return true;
}
