// The write path of test/helpers/memory-rpc.ts that MemoryDb and the mini-PostgREST share: defaults, the
// feature_flags trigger, NOT NULL / CHECK / unique constraints with PostgREST's error codes, upserts, atomic RPCs and
// the foreign-key actions of the retention purge. The RPC results themselves are compared with the SQL functions
// by the parity vectors (supabase/tests/agent_layer, npm run test:rpc-parity).

import { describe, expect, it } from 'vitest';
import {
  callRpc,
  DEFAULT_TENANT_ID,
  insertRow,
  MEMORY_RPCS,
  MemoryRpcError,
  rowsOf,
  seedRows,
  updateRow,
  upsertRow,
  type MemoryTableSet,
} from '../helpers/memory-rpc';

const NOW = new Date('2026-10-05T07:00:00.000Z');
const HEX = (c: string): string => c.repeat(64);
const RFQ = 'a0000000-0000-4000-8000-000000000001';

function err(fn: () => unknown): MemoryRpcError {
  try {
    fn();
  } catch (e) {
    if (e instanceof MemoryRpcError) return e;
    throw e;
  }
  throw new Error('expected a MemoryRpcError');
}

describe('memory-rpc write path', () => {
  it('fills column defaults and a generated id, as the table defaults do', () => {
    const t: MemoryTableSet = {};
    const r = insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'workflow', idempotency_key: 'k' }, NOW);
    expect(r).toMatchObject({
      tenant_id: DEFAULT_TENANT_ID, status: 'running', llm_calls: 0, cost_cents: 0, parked_reason: null, finished_at: null,
      started_at: NOW.toISOString(), approval_token_sha256: null,
    });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    const o = insertRow(t, 'orders', { title: 'PO 1' }, NOW);
    expect(o.currency).toBe('USD');
  });

  it('refuses unknown columns of the agent tables, NULLs in NOT NULL columns, and CHECK violations by name', () => {
    const t: MemoryTableSet = {};
    expect(err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', colour: 'red' }, NOW)))
      .toMatchObject({ code: 'PGRST204', status: 400 });
    expect(err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', status: null }, NOW)))
      .toMatchObject({ code: '23502' });
    const check = err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', status: 'needs_review' }, NOW));
    expect(check).toMatchObject({ code: '23514', status: 400 });
    expect(check.message).toContain('agent_runs_status_check');
    expect(err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', status: 'succeeded' }, NOW)).message)
      .toContain('agent_runs_finished_check');
    expect(err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', parked_reason: 'budget' }, NOW)).message)
      .toContain('agent_runs_parked_status_check');
    expect(err(() => insertRow(t, 'cad_jobs', {
      idempotency_key: `${HEX('a')}:analyse:${HEX('b')}`, job_type: 'analyse', input_r2_key: 'x', input_sha256: HEX('a'), backend: 'gpu',
    }, NOW)).message).toContain('cad_jobs_backend_check');
    expect(rowsOf(t, 'agent_runs')).toHaveLength(0);
  });

  it('enforces unique keys: plain, NULLs not distinct (cad_jobs), partial (one active quote per RFQ)', () => {
    const t: MemoryTableSet = {};
    insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k' }, NOW);
    const dup = err(() => insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k' }, NOW));
    expect(dup).toMatchObject({ code: '23505', status: 409 });
    expect(dup.message).toContain('agent_runs_agent_key');
    const job = { idempotency_key: `${HEX('a')}:analyse:${HEX('b')}`, job_type: 'analyse', input_r2_key: 'x', input_sha256: HEX('a') };
    insertRow(t, 'cad_jobs', job, NOW);
    expect(err(() => insertRow(t, 'cad_jobs', job, NOW)).message).toContain('cad_jobs_idem_key');
    insertRow(t, 'quote_workflows', { rfq_id: RFQ, workflow_instance_id: `quote-${RFQ}-v1`, status: 'sent' }, NOW);
    expect(err(() => insertRow(t, 'quote_workflows', { rfq_id: RFQ, quote_version: 2, workflow_instance_id: `quote-${RFQ}-v2` }, NOW)).message)
      .toContain('quote_workflows_one_active_idx');
    const i = rowsOf(t, 'quote_workflows').findIndex((r) => r.rfq_id === RFQ);
    updateRow(t, 'quote_workflows', i, { status: 'won' }, NOW);
    insertRow(t, 'quote_workflows', { rfq_id: RFQ, quote_version: 2, workflow_instance_id: `quote-${RFQ}-v2` }, NOW);
    // rfq_files: NULL sha256 never conflicts.
    for (let k = 0; k < 2; k++) insertRow(t, 'rfq_files', { rfq_id: RFQ, file_name: 'a', file_path: 'a', file_type: 'x', file_size: 1 }, NOW);
    expect(rowsOf(t, 'rfq_files')).toHaveLength(2);
  });

  it('upserts: ignore-duplicates keeps the row, merge-duplicates overwrites the given columns, other keys still conflict', () => {
    const t: MemoryTableSet = {};
    const base = { message_id: '<m@example.com>', message_id_sha256: HEX('c'), mailbox: 'rfq', from_email: 'a@example.com', received_at: NOW.toISOString() };
    const first = upsertRow(t, 'inbound_emails', base, NOW, { onConflict: ['tenant_id', 'message_id_sha256'], merge: false });
    const again = upsertRow(t, 'inbound_emails', { ...base, subject: 'changed' }, NOW, { onConflict: ['message_id_sha256', 'tenant_id'], merge: false });
    expect(first.inserted).toBe(true);
    expect(again).toMatchObject({ inserted: false, updated: false });
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.subject).toBeNull();
    const merged = upsertRow(t, 'inbound_emails', { ...base, subject: 'changed' }, NOW, { onConflict: ['tenant_id', 'message_id_sha256'], merge: true });
    expect(merged).toMatchObject({ inserted: false, updated: true });
    expect(merged.row.subject).toBe('changed');
    expect(err(() => upsertRow(t, 'inbound_emails', base, NOW, { onConflict: ['subject'], merge: false })).code).toBe('42P10');
    expect(err(() => upsertRow(t, 'inbound_emails', { ...base, id: first.row.id, message_id_sha256: HEX('d') }, NOW,
      { onConflict: ['tenant_id', 'message_id_sha256'], merge: false })).message).toContain('inbound_emails_pkey');
  });

  it('feature_flags trigger: rev moves only with enabled/value; any edit clears the seed import; bookkeeping is not an edit', () => {
    const t: MemoryTableSet = {};
    seedRows(t, 'feature_flags', [{ key: 'agent.quote', value: { mode: 'assist' }, kv_seed_pending: true, updated_at: '2026-10-01T00:00:00.000Z' }], NOW);
    const row0 = rowsOf(t, 'feature_flags')[0];
    const later = new Date(NOW.getTime() + 60_000);
    const book = updateRow(t, 'feature_flags', 0, { kv_synced_at: later.toISOString(), rev: 999 }, later);
    expect(book.rev).toBe(row0.rev);
    expect(book.updated_at).toBe(row0.updated_at);
    expect(book.kv_seed_pending).toBe(true);
    const described = updateRow(t, 'feature_flags', 0, { description: 'x' }, later);
    expect(described.rev).toBe(row0.rev);
    expect(described.kv_seed_pending).toBe(false);
    expect(described.updated_at).toBe(later.toISOString());
    const same = updateRow(t, 'feature_flags', 0, { value: { mode: 'assist' } }, later);
    expect(same.rev).toBe(row0.rev);
    const on = updateRow(t, 'feature_flags', 0, { enabled: true }, later);
    expect(on.rev).toBeGreaterThan(row0.rev as number);
    expect(err(() => updateRow(t, 'feature_flags', 0, { key: 'agent.other' }, later))).toMatchObject({ code: '42501' });
    expect(err(() => updateRow(t, 'feature_flags', 0, { value: { mode: 'yolo' } }, later)).message).toContain('feature_flags_mode_check');
  });

  it('rounds numeric(p, s) columns to their scale', () => {
    const t: MemoryTableSet = {};
    const r = insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'k', cost_cents: 1.23456 }, NOW);
    expect(r.cost_cents).toBe(1.2346);
  });

  it('RPCs are atomic: a failing call leaves every table as it was', () => {
    const t: MemoryTableSet = {};
    const email = insertRow(t, 'inbound_emails', {
      message_id: '<m@example.com>', message_id_sha256: HEX('e'), mailbox: 'rfq', from_email: 'new@example.com', received_at: NOW.toISOString(),
    }, NOW);
    const before = JSON.stringify(t);
    // contact_email creates a customer first; the missing company name then aborts the call.
    expect(() => MEMORY_RPCS.create_email_rfq(t, { p_inbound_email_id: email.id, p_payload: { contact_email: 'new@example.com' }, p_source: 'email' }, NOW))
      .toThrow(/company_name is required/);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('unknown functions answer PGRST202 (404)', () => {
    expect(err(() => callRpc({}, 'claim_approval', {}, NOW))).toMatchObject({ code: 'PGRST202', status: 404 });
  });

  it('the retention purge applies the ON DELETE SET NULL actions of the schema', () => {
    const t: MemoryTableSet = {};
    const old = new Date(NOW.getTime() - 400 * 86_400_000).toISOString();
    const parent = insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'old', status: 'succeeded', started_at: old, finished_at: old }, NOW);
    insertRow(t, 'agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'child', parent_run_id: parent.id }, NOW);
    insertRow(t, 'inbound_emails', {
      message_id: '<x>', message_id_sha256: HEX('f'), mailbox: 'rfq', from_email: 'a@example.com', received_at: NOW.toISOString(), agent_run_id: parent.id,
    }, NOW);
    const r = MEMORY_RPCS.agent_retention_purge(t, {}, NOW) as Record<string, number>;
    expect(r).toEqual({ excerpts_cleared: 0, emails_deleted: 0, run_outputs_cleared: 0, runs_deleted: 1 });
    expect(rowsOf(t, 'agent_runs').map((x) => [x.idempotency_key, x.parent_run_id])).toEqual([['child', null]]);
    expect(rowsOf(t, 'inbound_emails')[0].agent_run_id).toBeNull();
  });
});
