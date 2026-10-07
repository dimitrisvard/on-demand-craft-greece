// RP-2: the 10-minute dispatcher: orphan inbound rows (intake started in process, replies queued again), portal
// and quote orders without a post-order run, parked runs (flag_off resumed when the flag is on again,
// llm_unavailable after 30 minutes, budget and failure-card runs never), failure-card runs older than 14 days closed
// 'failed' with the token cleared and the card edited, stuck CAD jobs dead-lettered; one failing job does not stop
// the others.

import { describe, expect, it } from 'vitest';
import { dispatcherTick, flagKeyFor } from '../../src/cron/dispatcher';
import type { AgentEventV1 } from '../../src/queues/messages';
import { harness, TENANT, type Harness } from '../replies/helpers';

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;
const controller = { cron: '*/10 * * * *', scheduledTime: NOW, noRetry() {} } as unknown as ScheduledController;
const sent = (h: Harness) => h.events.sent.map((s) => s.body);
const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(flags?: Record<string, unknown>) {
  const h = harness(flags ? { flags } : undefined);
  // the poller's gate is agent.quote: give it no accounts so it runs without effect
  return h;
}

describe('orphan inbound rows', () => {
  it('rfq rows left received > 15 min without a run start rfq-intake; replies rows are queued again; young rows wait', async () => {
    const h = setup();
    h.ports.db.seed('inbound_emails', [
      { id: id('2a', 1), tenant_id: TENANT, message_id: '<o1@example.de>', message_id_sha256: '1'.repeat(64), mailbox: 'rfq', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
      { id: id('2a', 2), tenant_id: TENANT, message_id: '<o2@example.de>', message_id_sha256: '2'.repeat(64), mailbox: 'rfq', from_email: 'a@example.de', received_at: ago(5 * MIN), created_at: ago(5 * MIN), status: 'received' },
      { id: id('2a', 3), tenant_id: TENANT, message_id: '<o3@example.de>', message_id_sha256: '3'.repeat(64), mailbox: 'replies', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
      { id: id('2a', 4), tenant_id: TENANT, message_id: '<o4@example.de>', message_id_sha256: '4'.repeat(64), mailbox: 'rfq', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
      { id: id('2a', 5), tenant_id: TENANT, message_id: '<o5@example.de>', message_id_sha256: '5'.repeat(64), mailbox: 'replies', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
      { id: id('2a', 6), tenant_id: TENANT, message_id: '<o6@example.de>', message_id_sha256: '6'.repeat(64), mailbox: 'gmail', source: 'gmail_poller', sender_account_id: id('9a', 1), from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
    ]);
    h.ports.db.seed('agent_runs', [
      { agent: 'rfq_intake', trigger: 'email', idempotency_key: '4'.repeat(64), status: 'running' },
      { agent: 'quote', trigger: 'queue', idempotency_key: `quote:inbound-reply:${id('2a', 5)}`, status: 'succeeded', finished_at: ago(MIN) },
      { agent: 'quote', trigger: 'queue', idempotency_key: `quote:inbound-reply:${id('2a', 6)}`, status: 'running' },
    ]);
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(h.intake.created.map((c) => c.id)).toEqual([`rfq-intake-${'1'.repeat(32)}`]);
    expect(sent(h)).toEqual([
      { v: 1, type: 'inbound-reply', inbound_email_id: id('2a', 3), tenant_id: TENANT },
      { v: 1, type: 'inbound-reply', inbound_email_id: id('2a', 6), tenant_id: TENANT },
    ]);
    expect(report).toMatchObject({ intake_started: 1, replies_requeued: 2, errors: [] });
  });

  it('flags off: nothing is started or queued', async () => {
    const h = setup({ 'agent.quote': { enabled: false }, 'agent.rfq_intake': { enabled: false }, 'agent.post_order': { enabled: false } });
    h.ports.db.seed('inbound_emails', [
      { id: id('2a', 1), tenant_id: TENANT, message_id: '<o1@example.de>', message_id_sha256: '1'.repeat(64), mailbox: 'rfq', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
      { id: id('2a', 3), tenant_id: TENANT, message_id: '<o3@example.de>', message_id_sha256: '3'.repeat(64), mailbox: 'replies', from_email: 'a@example.de', received_at: ago(20 * MIN), created_at: ago(20 * MIN), status: 'received' },
    ]);
    h.ports.db.seed('orders', [{ id: id('4a', 1), title: 'PO-1', status: 'new', created_at: ago(DAY), tenant_id: TENANT }]);
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(h.intake.created).toEqual([]);
    expect(sent(h)).toEqual([]);
    expect(report.poller).toBe('gate_off');
  });
});

describe('orders', () => {
  it('new orders of the last 30 days without a post-order run -> order-created (quote when the RFQ has a won quote)', async () => {
    const h = setup();
    const rfq = id('0a', 1);
    h.ports.db.seed('quote_workflows', [{ rfq_id: rfq, quote_version: 1, workflow_instance_id: `quote-${rfq}-v1`, status: 'won', tenant_id: TENANT }]);
    h.ports.db.seed('orders', [
      { id: id('4a', 1), title: 'PO-1', status: 'new', created_at: ago(2 * DAY), tenant_id: TENANT },
      { id: id('4a', 2), title: 'PO-2', status: 'new', created_at: ago(DAY), rfq_id: rfq, tenant_id: TENANT },
      { id: id('4a', 3), title: 'PO-3', status: 'new', created_at: ago(40 * DAY), tenant_id: TENANT },
      { id: id('4a', 4), title: 'PO-4', status: 'in_production', created_at: ago(DAY), tenant_id: TENANT },
      { id: id('4a', 5), title: 'PO-5', status: 'new', created_at: ago(DAY), tenant_id: TENANT },
    ]);
    h.ports.db.seed('agent_runs', [{ agent: 'post_order', trigger: 'queue', idempotency_key: id('4a', 5), status: 'waiting_human' }]);
    await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(sent(h)).toEqual([
      { v: 1, type: 'order-created', order_id: id('4a', 1), tenant_id: TENANT, source: 'portal' },
      { v: 1, type: 'order-created', order_id: id('4a', 2), tenant_id: TENANT, source: 'quote' },
    ]);
  });
});

describe('parked runs', () => {
  it('flag_off resumed when its flag is on again; llm_unavailable after 30 minutes; budget and failure-card runs never', async () => {
    const h = setup({ 'agent.quote': { enabled: true }, 'agent.rfq_intake': { enabled: false }, 'agent.post_order': { enabled: true } });
    const runs = h.ports.db.seed('agent_runs', [
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'a', status: 'waiting_human', parked_reason: 'flag_off', updated_at: ago(MIN) },
      { agent: 'rfq_intake', trigger: 'workflow', idempotency_key: 'b', status: 'waiting_human', parked_reason: 'flag_off', updated_at: ago(MIN) },
      { agent: 'post_order', trigger: 'workflow', idempotency_key: 'c', status: 'waiting_human', parked_reason: 'llm_unavailable', updated_at: ago(31 * MIN) },
      { agent: 'post_order', trigger: 'workflow', idempotency_key: 'd', status: 'waiting_human', parked_reason: 'llm_unavailable', updated_at: ago(29 * MIN) },
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'e', status: 'waiting_human', parked_reason: 'budget', updated_at: ago(DAY) },
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'f', status: 'waiting_human', parked_reason: 'failed', approval_token_sha256: 'f'.repeat(64), updated_at: ago(DAY) },
    ]);
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    // oldest park first
    expect(sent(h)).toEqual([
      { v: 1, type: 'resume-parked', run_id: runs[2].id as string },
      { v: 1, type: 'resume-parked', run_id: runs[0].id as string },
    ] satisfies AgentEventV1[]);
    expect(report.resumed).toBe(2);
  });

  it('flagKeyFor maps agents to their flags', () => {
    expect(flagKeyFor('quote.reply_poller')).toBe('agent.quote');
    expect(flagKeyFor('growth.scrapers')).toBe('agent.growth.scrapers');
    expect(flagKeyFor('mcp')).toBeNull();
    expect(flagKeyFor('cad')).toBeNull();
  });
});

describe('failure cards', () => {
  it('runs behind a failure card for more than 14 days close failed (error kept, token cleared, card edited); younger ones wait', async () => {
    const h = setup();
    const card = { v: 1, kind: 'failure', run_id: 'x', title: 'Agent run failed · quote', lines: [{ label: 'Step', value: 'send' }], flags: [], allowed_verbs: ['retry', 'dismiss'], open_url: 'https://www.micronshub.eu/dashboard/approvals?run=x' };
    const [old, young] = h.ports.db.seed('agent_runs', [
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'old', status: 'waiting_human', parked_reason: 'failed', approval_token_sha256: 'a'.repeat(64), error: 'db_error 503', llm_calls: 2, cost_cents: 1.5, output: { card_kind: 'failure', card, telegram_message_id: 321 }, updated_at: ago(15 * DAY) },
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'young', status: 'waiting_human', parked_reason: 'failed', approval_token_sha256: 'b'.repeat(64), error: 'x', updated_at: ago(13 * DAY) },
    ]);
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(report.failures_closed).toBe(1);
    expect(h.ports.db.rows('agent_runs', ['id', 'eq', old.id as string])[0]).toMatchObject({ status: 'failed', parked_reason: null, approval_token_sha256: null, error: 'db_error 503', llm_calls: 2, cost_cents: 1.5, finished_at: new Date(NOW).toISOString() });
    expect(h.ports.db.rows('agent_runs', ['id', 'eq', young.id as string])[0]).toMatchObject({ status: 'waiting_human', parked_reason: 'failed' });
    expect(h.ports.telegram.edits).toHaveLength(1);
    expect(h.ports.telegram.edits[0]).toMatchObject({ message_id: 321, card: { allowed_verbs: [] } });
    expect(JSON.stringify(h.ports.telegram.edits[0].card)).toContain('Closed after 14 days without a decision');
    // never resumed
    expect(sent(h).filter((m) => m.type === 'resume-parked')).toEqual([]);
  });
});

describe('stuck CAD jobs', () => {
  it('dispatched or running for more than 30 minutes -> dead_letter, RfqThread told, the cad run closed failed', async () => {
    const h = setup();
    const rfq = id('0a', 1);
    const job = (n: number, status: string, age: number) => ({ id: id('7a', n), rfq_id: rfq, idempotency_key: `${'a'.repeat(64)}:analyse:${String(n).repeat(64).slice(0, 64)}`, job_type: 'analyse', input_r2_key: `rfq/${rfq}/f${n}.step`, input_sha256: 'a'.repeat(64), status, updated_at: ago(age), tenant_id: TENANT });
    h.ports.db.seed('cad_jobs', [job(1, 'running', 31 * MIN), job(2, 'dispatched', 45 * MIN), job(3, 'running', 10 * MIN), job(4, 'succeeded', DAY)]);
    h.ports.db.seed('agent_runs', [{ agent: 'cad', trigger: 'queue', idempotency_key: id('7a', 1), status: 'running' }]);
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(report.cad_dead_lettered).toBe(2);
    expect(h.ports.db.rows('cad_jobs').map((j) => j.status)).toEqual(['dead_letter', 'dead_letter', 'running', 'succeeded']);
    // oldest first
    expect(h.threadCalls).toEqual([
      { name: rfq, method: 'cadJobFinal', args: [id('7a', 2), 'dead_letter'] },
      { name: rfq, method: 'cadJobFinal', args: [id('7a', 1), 'dead_letter'] },
    ]);
    expect(h.ports.db.rows('agent_runs', ['agent', 'eq', 'cad'])[0]).toMatchObject({ status: 'failed', error: 'stuck' });
  });

  it('an RfqThread call that fails for one job is logged; the next job is still dead-lettered and told, and its run closed', async () => {
    const h = setup();
    const rfq = id('0a', 1);
    const job = (n: number, age: number) => ({ id: id('7a', n), rfq_id: rfq, idempotency_key: `${'a'.repeat(64)}:analyse:${String(n).repeat(64).slice(0, 64)}`, job_type: 'analyse', input_r2_key: `rfq/${rfq}/f${n}.step`, input_sha256: 'a'.repeat(64), status: 'running', updated_at: ago(age), tenant_id: TENANT });
    h.ports.db.seed('cad_jobs', [job(1, 50 * MIN), job(2, 40 * MIN)]);
    h.ports.db.seed('agent_runs', [
      { agent: 'cad', trigger: 'queue', idempotency_key: id('7a', 1), status: 'running' },
      { agent: 'cad', trigger: 'queue', idempotency_key: id('7a', 2), status: 'running' },
    ]);
    const told: string[] = [];
    h.env.RFQ_THREAD = {
      idFromName: (name: string) => name,
      get: () => ({
        cadJobFinal: async (jobId: string) => {
          if (jobId === id('7a', 1)) throw new Error('durable object reset');
          told.push(jobId);
        },
      }),
    } as unknown as typeof h.env.RFQ_THREAD;
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(report.cad_dead_lettered).toBe(2);
    expect(report.errors).toEqual([`stuck_cad:${id('7a', 1)}`]);
    expect(told).toEqual([id('7a', 2)]);
    expect(h.ports.db.rows('cad_jobs').map((j) => j.status)).toEqual(['dead_letter', 'dead_letter']);
    expect(h.ports.db.rows('agent_runs', ['agent', 'eq', 'cad']).map((r) => r.status)).toEqual(['failed', 'failed']);
  });
});

describe('isolation', () => {
  it('a failing job is logged and the other jobs still run', async () => {
    const h = setup();
    h.ports.db.seed('orders', [{ id: id('4a', 1), title: 'PO-1', status: 'new', created_at: ago(DAY), tenant_id: TENANT }]);
    h.ports.db.seed('marketing_sender_accounts', [{ id: id('9a', 1), email: 'sales@example.com', provider: 'google_workspace', is_active: true, provider_config: {} }]);
    // the poller's Gmail port is not set in this test: its job fails
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(report.orders_sent).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.poller).toBe('ran');
    const run = h.ports.db.rows('agent_runs', ['agent', 'eq', 'quote.reply_poller'])[0];
    expect(run).toMatchObject({ status: 'succeeded', output: { accounts: { [id('9a', 1)]: { errors: ['error'] } } } });
  });

  it('a job that throws does not stop the others', async () => {
    const h = setup();
    h.ports.db.seed('orders', [{ id: id('4a', 1), title: 'PO-1', status: 'new', created_at: ago(DAY), tenant_id: TENANT }]);
    const select = h.ports.db.select.bind(h.ports.db);
    h.ports.db.select = (async (table: string, o?: unknown) => {
      if (table === 'inbound_emails') throw new Error('postgrest GET inbound_emails: 503');
      return select(table, o as never);
    }) as typeof h.ports.db.select;
    const report = await dispatcherTick(h.env, controller, { ports: h.ports });
    expect(report.errors).toEqual(['orphans']);
    expect(report.orders_sent).toBe(1);
  });
});
