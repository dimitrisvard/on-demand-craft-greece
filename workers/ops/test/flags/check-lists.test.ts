// The migration file is the one source of the status and enum lists (PHASE4_SPEC.md §5 "CHECK-LISTS"): the reader
// in test/helpers/check-lists.ts, the copies the in-memory RPCs enforce (CHECK_LISTS of memory-rpc.ts), the flag
// modes of the feature-flags repository and the 13 seeded flag keys (FlagKey) must equal it.

import { describe, expect, it } from 'vitest';
import type { FlagKey } from '../../../shared/src/agent-types';
import { FLAG_MODES } from '../../src/db/repos/feature-flags';
import { agentLayerMigration, checkBody, checkList, migrationColumns, seededFlags, sorted } from '../helpers/check-lists';
import { AGENT_TABLES, CHECK_LISTS, TABLE_SPECS, withDefaults } from '../helpers/memory-rpc';

/** Every FlagKey exactly once (a missing or extra key fails the typecheck). */
const FLAG_KEYS: Record<FlagKey, true> = {
  'seo.strict_404': true,
  'api.forward_to_vercel': true,
  'agent.rfq_intake': true,
  'agent.quote': true,
  'agent.post_order': true,
  'agent.growth.reddit': true,
  'agent.growth.hn': true,
  'agent.growth.tenders': true,
  'agent.growth.scrapers': true,
  'agent.growth.xometry': true,
  'agent.content_daily': true,
  'agent.ops_digest': true,
  'mcp.remote': true,
};

describe('check-lists reader', () => {
  it('finds the one agent-layer migration', () => {
    expect(agentLayerMigration().file).toMatch(/supabase\/migrations\/\d{8}_agent_layer\.sql$/);
  });

  it('reads multi-line lists, the list of a named column, and quoted values only', () => {
    expect(checkList('quote_workflows_status_check')).toEqual(['started', 'cad_pending', 'pricing', 'awaiting_approval', 'approved', 'sent',
      'follow_up', 'won', 'lost', 'counter_offer', 'expired', 'rejected', 'failed', 'cancelled']);
    expect(checkList('stock_reservations_reason_check', 'release_reason')).toEqual(['cancelled', 'consumed', 'expired', 'manual']);
    expect(checkList('cad_jobs_backend_check')).toEqual(['vps', 'container', 'inline', 'mac_mini']);
    expect(checkList('agent_runs_parked_reason_check')).toEqual(['flag_off', 'budget', 'llm_unavailable', 'failed']);
    expect(checkBody('agent_runs_parked_status_check')).toBe("parked_reason IS NULL OR status = 'waiting_human'");
  });

  it('throws for an unknown constraint or a constraint without a list', () => {
    expect(() => checkList('agent_runs_no_such_check')).toThrow(/not found/);
    expect(() => checkList('agent_runs_counts_check')).toThrow(/no IN list/);
  });
});

describe('CHECK lists of the migration', () => {
  it.each(Object.entries(CHECK_LISTS))('memory-rpc enforces %s exactly as the migration', (name, values) => {
    const column = name === 'stock_reservations_reason_check' ? 'release_reason' : undefined;
    expect(sorted(values)).toEqual(sorted(checkList(name, column)));
  });

  it.each(AGENT_TABLES)('memory-rpc knows exactly the columns the migration gives %s', (table) => {
    expect(sorted(TABLE_SPECS[table].columns ?? [])).toEqual(sorted(migrationColumns(table)));
  });

  it.each(['rfqs', 'rfq_files'])('memory-rpc rows of %s carry the columns the migration adds', (table) => {
    const added = migrationColumns(table);
    expect(added.length).toBeGreaterThan(0);
    const row = withDefaults(table, {}, new Date(0));
    for (const col of added) expect(Object.keys(row), col).toContain(col);
  });

  it('flag modes of the repository = feature_flags_mode_check', () => {
    expect(sorted(FLAG_MODES)).toEqual(sorted(checkList('feature_flags_mode_check')));
  });

  it('the migration seeds exactly the 13 canonical flag keys (FlagKey), all off and waiting for the KV import', () => {
    const rows = seededFlags();
    expect(sorted(rows.map((r) => String(r.key)))).toEqual(sorted(Object.keys(FLAG_KEYS)));
    expect(rows.every((r) => r.enabled === false && r.kv_seed_pending === true)).toBe(true);
    expect(rows.find((r) => r.key === 'agent.rfq_intake')?.value).toEqual({ mode: 'shadow', min_confidence: 0.7, ack: false });
    expect(rows.find((r) => r.key === 'mcp.remote')?.value).toEqual({ writes: false });
  });
});
