// Marketing warm-up (Phase 5, unit M5; off unless MARKETING_WARMUP_ENABLED is "true"): the daily warm-up limit step
// of the sender accounts, ported from supabase/functions/process-warmup/index.ts:18-90. The dispatcher
// (src/cron/run-schedule.ts) opens the run 'marketing.warmup:<date>' and closes it with the returned counts.
//
// Rules (as the repo function; `date` is the UTC day of the slot)
//   - Every sender account: last_reset_date missing or before the day -> emails_sent_today 0, last_reset_date = day.
//   - warmup_enabled: new limit = min((warmup_current_limit or 10) + (warmup_daily_increment or 5), daily_limit);
//     written when it changed; warmup_enabled false once the new limit reaches daily_limit.
//   - One PATCH per account with changes, updated_at included; counts {accounts_processed, warmed_up,
//     counters_reset}. No address is returned or logged.

import type { Row } from '../db/postgrest';
import type { OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import type { MarketingJobCounts } from './followups';

interface AccountRow {
  id: string;
  last_reset_date: string | null;
  warmup_enabled: boolean | null;
  warmup_current_limit: number | null;
  warmup_daily_increment: number | null;
  daily_limit: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function runWarmup(env: OpsEnv, date: string, o?: { run_id?: string; ports?: Ports }): Promise<MarketingJobCounts> {
  if (!DATE_RE.test(date)) throw new Error('runWarmup: invalid date');
  const ports = o?.ports ?? makePorts(env);
  const db = ports.db;
  const accounts = await db.select<AccountRow & Row>('marketing_sender_accounts', {
    columns: 'id,last_reset_date,warmup_enabled,warmup_current_limit,warmup_daily_increment,daily_limit',
    order: [{ column: 'id', ascending: true }],
  });
  let warmedUp = 0;
  let resetCount = 0;
  for (const account of accounts as AccountRow[]) {
    const updates: Record<string, unknown> = {};
    const lastReset = account.last_reset_date;
    if (!lastReset || lastReset < date) {
      updates.emails_sent_today = 0;
      updates.last_reset_date = date;
      resetCount++;
    }
    if (account.warmup_enabled) {
      const newLimit = Math.min((account.warmup_current_limit || 10) + (account.warmup_daily_increment || 5), account.daily_limit as number);
      if (newLimit !== account.warmup_current_limit) {
        updates.warmup_current_limit = newLimit;
        warmedUp++;
      }
      if (newLimit >= (account.daily_limit as number)) updates.warmup_enabled = false;
    }
    if (Object.keys(updates).length > 0) {
      await db.update('marketing_sender_accounts', { ...updates, updated_at: ports.clock.now().toISOString() }, { filters: [['id', 'eq', account.id]] });
    }
  }
  return { accounts_processed: accounts.length, warmed_up: warmedUp, counters_reset: resetCount };
}
