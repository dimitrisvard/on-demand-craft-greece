// public.pricing_rules (agent-layer migration) through the Db port: the owner-entered rates, margins, minimums and
// shipping amounts of the quote calculator. Rows are read; only staff edit them.
//
// Rules
//   - Active rules of a tenant: is_active, valid_from <= the pricing day; rows whose valid_to lies before the day
//     are dropped in pricing/rules.ts activeRules() (PostgREST has no OR across columns in one filter list here).
//   - At most MAX_RULES rows are read; more is a configuration problem the calculator reports through manual lines.

import type { Db } from '../postgrest';
import type { PricingRuleRow } from '../../pricing/types';
import { activeRules, isoDay } from '../../pricing/rules';

export const MAX_RULES = 1000;

/** = pricing_rules_process_check */
export type PricingProcess = PricingRuleRow['process'];

export async function loadActiveRules(db: Db, tenantId: string, at: Date): Promise<PricingRuleRow[]> {
  const rows = await db.select<PricingRuleRow & Record<string, unknown>>('pricing_rules', {
    columns: 'id,tenant_id,process,rule_key,material_match,qty_min,qty_max,value,unit,currency,version,valid_from,valid_to,is_active',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['is_active', 'is', true],
      ['valid_from', 'lt', nextDay(at)],
    ],
    order: [{ column: 'id', ascending: true }],
    limit: MAX_RULES,
  });
  return activeRules(rows, at);
}

/** The day after `at` (YYYY-MM-DD), so valid_from < next day = valid_from <= day. */
function nextDay(at: Date): string {
  return isoDay(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1)));
}
