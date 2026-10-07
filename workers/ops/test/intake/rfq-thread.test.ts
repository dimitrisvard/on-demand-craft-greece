// IN-2 / I-3: RfqThread with a fake Durable Object state (node:sqlite): cad-done exactly once for concurrent
// cadJobFinal calls, buffered orders (jobs final before the quote binds; no CAD file), alarm retries of a failed
// send, customer-reply once per inbound mail, and the rebuild of an empty object from Supabase.

import { describe, expect, it } from 'vitest';
import { RfqThread, CAD_DONE_MAX_ATTEMPTS } from '../../src/do/rfq-thread';
import type { OpsEnv } from '../../src/env';
import { agentBindings, FakeWorkflow, type FakeWorkflowInstance } from '../helpers/agent-env';
import { fakeNamespace, type FakeDurableObjectState } from '../helpers/fake-do';
import { MemoryDb } from '../helpers/memory-db';
import { opsEnv } from '../helpers/ops';

const RFQ = '0d6f6c35-2e5a-4f0e-9a56-2c8f4b8a1f10';
const QW = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const QI = `quote-${RFQ}-v1`;

function setup(o: { db?: MemoryDb } = {}) {
  const quote = new FakeWorkflow();
  const env = opsEnv({ ...agentBindings({ QUOTE: quote as unknown as OpsEnv['QUOTE'] }) }) as OpsEnv;
  const db = o.db ?? new MemoryDb();
  const ns = fakeNamespace((state) => {
    const t = new RfqThread(state as unknown as DurableObjectState, env);
    (t as unknown as { dbInstance: MemoryDb }).dbInstance = db;
    return t;
  });
  const thread = ns.instance(RFQ) as RfqThread;
  const state = ns.state(RFQ) as FakeDurableObjectState;
  const instance = quote.ensure(QI) as FakeWorkflowInstance;
  return { thread, state, instance, quote, env, db };
}

const events = (i: FakeWorkflowInstance) => i.calls.filter((c) => c.method === 'sendEvent').map((c) => c.args as { type: string; payload: unknown });

describe('RfqThread', () => {
  it('cad-done goes out exactly once when the last of the registered jobs is final, also for concurrent calls', async () => {
    const { thread, instance } = setup();
    await thread.expectCadJobs(['j1', 'j2', 'j3']);
    await thread.bindQuote(QI, QW);
    expect(events(instance)).toEqual([]);
    await thread.cadJobFinal('j1', 'succeeded');
    expect(events(instance)).toEqual([]);
    await Promise.all([thread.cadJobFinal('j2', 'failed'), thread.cadJobFinal('j3', 'succeeded'), thread.cadJobFinal('j3', 'succeeded')]);
    await thread.cadJobFinal('j1', 'succeeded');
    expect(events(instance)).toEqual([{ type: 'cad-done', payload: { jobs: [{ job_id: 'j1', status: 'succeeded' }, { job_id: 'j2', status: 'failed' }, { job_id: 'j3', status: 'succeeded' }] } }]);
    expect((await thread.state()).cad_done_sent).toBe(true);
  });

  it('buffered orders: jobs final before the quote binds -> cad-done at bind; a job final before it was registered stays final', async () => {
    const { thread, instance } = setup();
    await thread.cadJobFinal('j1', 'timed_out');
    await thread.expectCadJobs(['j1', 'j2']);
    await thread.cadJobFinal('j2', 'succeeded');
    expect(events(instance)).toEqual([]);
    await thread.bindQuote(QI, QW);
    expect(events(instance)).toEqual([{ type: 'cad-done', payload: { jobs: [{ job_id: 'j1', status: 'timed_out' }, { job_id: 'j2', status: 'succeeded' }] } }]);
    await thread.bindQuote(QI, QW);
    expect(events(instance)).toHaveLength(1);
  });

  it('an RFQ without CAD files: cad-done with an empty job list once the expectation is registered', async () => {
    const { thread, instance } = setup();
    await thread.bindQuote(QI, QW);
    expect(events(instance)).toEqual([]);
    await thread.expectCadJobs([]);
    expect(events(instance)).toEqual([{ type: 'cad-done', payload: { jobs: [] } }]);
  });

  it('a failed send is released and retried by the alarm, at most 5 attempts', async () => {
    const { thread, instance, state } = setup();
    await thread.expectCadJobs(['j1']);
    await thread.bindQuote(QI, QW);
    instance.failures.set('sendEvent', new Error('unavailable'));
    await thread.cadJobFinal('j1', 'succeeded');
    expect(events(instance)).toEqual([]);
    expect(await state.storage.getAlarm()).not.toBeNull();
    expect((await thread.state()).cad_done_sent).toBe(false);
    await state.runAlarm();
    expect(events(instance)).toEqual([{ type: 'cad-done', payload: { jobs: [{ job_id: 'j1', status: 'succeeded' }] } }]);

    const second = setup();
    await second.thread.expectCadJobs(['j1']);
    await second.thread.bindQuote(QI, QW);
    for (let i = 0; i < CAD_DONE_MAX_ATTEMPTS; i++) {
      second.instance.failures.set('sendEvent', new Error('unavailable'));
      if (i === 0) await second.thread.cadJobFinal('j1', 'succeeded');
      else await second.state.runAlarm();
    }
    expect(await second.state.storage.getAlarm()).toBeNull();
    expect(events(second.instance)).toEqual([]);
  });

  /** A database with the quote row and inbound rows (not linked to the RFQ yet) with their receive times. */
  function replyDb(quote: { status: string; sent_at: string | null }, mails: Array<[id: string, receivedAt: string]>): MemoryDb {
    const db = new MemoryDb();
    db.seed('quote_workflows', [{ id: QW, rfq_id: RFQ, quote_version: 1, workflow_instance_id: QI, outbound_message_ids: [], ...quote }]);
    db.seed('inbound_emails', mails.map(([id, received_at], i) => ({ id, message_id: `<m${i}@x.example>`, message_id_sha256: String(i).repeat(64).slice(0, 64), mailbox: 'rfq', received_at })));
    return db;
  }
  const replies = (i: FakeWorkflowInstance) => events(i).filter((e) => e.type === 'customer-reply');
  const SENT_AT = '2026-10-05T10:00:00.000Z';

  it('customer-reply is forwarded once per inbound mail while the bound quote waits for the answer; outbound ids are mirrored', async () => {
    const db = replyDb({ status: 'sent', sent_at: SENT_AT }, [
      ['11111111-1111-4111-8111-111111111111', '2026-10-05T09:00:00.000Z'],
      ['22222222-2222-4222-8222-222222222222', '2026-10-05T11:00:00.000Z'],
    ]);
    const { thread, instance } = setup({ db });
    await thread.appendInbound('11111111-1111-4111-8111-111111111111', '<early@x.example>');
    expect(events(instance)).toEqual([]);
    await thread.bindQuote(QI, QW);
    await thread.registerOutbound([' <q.a.0@rfq.example.com> '], QW);
    await thread.appendInbound('22222222-2222-4222-8222-222222222222', ' <reply@x.example>');
    await thread.appendInbound('22222222-2222-4222-8222-222222222222', '<reply@x.example>');
    // the early mail is never forwarded, also when it is appended again after the quote was sent
    await thread.appendInbound('11111111-1111-4111-8111-111111111111', '<early@x.example>');
    expect(replies(instance)).toEqual([{ type: 'customer-reply', payload: { inbound_email_id: '22222222-2222-4222-8222-222222222222' } }]);
    const s = await thread.state();
    expect(s.outbound_message_ids).toEqual(['<q.a.0@rfq.example.com>']);
    expect(s.inbound.map((i) => i.message_id)).toEqual(['<early@x.example>', '<reply@x.example>']);
    expect(s.quote).toEqual({ instance_id: QI, quote_workflow_id: QW });
  });

  it('a mail attached while the bound quote has not been sent (or has ended) is recorded only, never forwarded', async () => {
    const MAIL = '55555555-5555-4555-8555-555555555555';
    const LATER = '66666666-6666-4666-8666-666666666666';
    const db = replyDb({ status: 'awaiting_approval', sent_at: null }, [
      [MAIL, '2026-10-05T09:30:00.000Z'],
      [LATER, '2026-10-05T12:00:00.000Z'],
    ]);
    const { thread, instance } = setup({ db });
    // the quote binds in its CAD step, before the approval wait
    await thread.bindQuote(QI, QW);
    await thread.appendInbound(MAIL, '<follow-up@x.example>');
    expect(replies(instance)).toEqual([]);
    for (const status of ['started', 'cad_pending', 'pricing', 'awaiting_approval', 'approved']) {
      await db.update('quote_workflows', { status }, { filters: [['id', 'eq', QW]] });
      await thread.appendInbound(MAIL, '<follow-up@x.example>');
    }
    expect(replies(instance)).toEqual([]);
    // the quote is sent afterwards: the earlier mail is still not its reply
    await db.update('quote_workflows', { status: 'sent', sent_at: SENT_AT }, { filters: [['id', 'eq', QW]] });
    await thread.registerOutbound(['<q.a.0@rfq.example.com>'], QW);
    await thread.appendInbound(MAIL, '<follow-up@x.example>');
    expect(replies(instance)).toEqual([]);
    // a quote that has ended gets nothing either
    await db.update('quote_workflows', { status: 'won' }, { filters: [['id', 'eq', QW]] });
    await thread.appendInbound(LATER, '<later@x.example>');
    expect(replies(instance)).toEqual([]);
    // in a follow-up wait the later mail is forwarded
    await db.update('quote_workflows', { status: 'follow_up' }, { filters: [['id', 'eq', QW]] });
    await thread.appendInbound(LATER, '<later@x.example>');
    expect(replies(instance)).toEqual([{ type: 'customer-reply', payload: { inbound_email_id: LATER } }]);
  });

  it('a failed status read or send throws, and the next appendInbound of the same mail forwards it', async () => {
    const db = replyDb({ status: 'sent', sent_at: SENT_AT }, [['33333333-3333-4333-8333-333333333333', '2026-10-05T10:30:00.000Z']]);
    const { thread, instance } = setup({ db });
    await thread.bindQuote(QI, QW);
    const select = db.select.bind(db);
    db.select = (async () => {
      throw new Error('postgrest select quote_workflows: 503');
    }) as typeof db.select;
    await expect(thread.appendInbound('33333333-3333-4333-8333-333333333333', '<r@x.example>')).rejects.toThrow('503');
    db.select = select;
    expect(events(instance)).toEqual([]);
    instance.failures.set('sendEvent', new Error('unavailable'));
    await expect(thread.appendInbound('33333333-3333-4333-8333-333333333333', '<r@x.example>')).rejects.toThrow('unavailable');
    await thread.appendInbound('33333333-3333-4333-8333-333333333333', '<r@x.example>');
    expect(events(instance)).toEqual([{ type: 'customer-reply', payload: { inbound_email_id: '33333333-3333-4333-8333-333333333333' } }]);
  });

  it('an empty object rebuilds itself from cad_jobs, quote_workflows and inbound_emails', async () => {
    const db = new MemoryDb();
    db.seed('rfqs', [{ id: RFQ, company_name: 'Example GmbH' }]);
    db.seed('quote_workflows', [{ id: QW, rfq_id: RFQ, quote_version: 1, workflow_instance_id: QI, status: 'cad_pending', outbound_message_ids: ['<q.x.0@rfq.example.com>'] }]);
    const sha = 'a'.repeat(64);
    db.seed('cad_jobs', [
      { id: 'c1c1c1c1-0000-4000-8000-000000000001', rfq_id: RFQ, status: 'succeeded', idempotency_key: `${sha}:analyse:${sha}`, job_type: 'analyse', input_r2_key: 'k', input_sha256: sha },
      { id: 'c1c1c1c1-0000-4000-8000-000000000002', rfq_id: RFQ, status: 'running', idempotency_key: `${sha}:analyse:${'b'.repeat(64)}`, job_type: 'analyse', input_r2_key: 'k', input_sha256: sha },
    ]);
    db.seed('inbound_emails', [{ id: '44444444-4444-4444-8444-444444444444', rfq_id: RFQ, message_id: '<orig@x.example>', message_id_sha256: sha, mailbox: 'rfq', from_email: 'a@example.com', received_at: '2026-10-05T08:00:00Z' }]);
    const { thread, instance } = setup({ db });
    const s = await thread.state();
    expect(s).toEqual({
      rfq_id: RFQ,
      quote: { instance_id: QI, quote_workflow_id: QW },
      cad: [{ job_id: 'c1c1c1c1-0000-4000-8000-000000000001', status: 'succeeded' }, { job_id: 'c1c1c1c1-0000-4000-8000-000000000002', status: 'pending' }],
      cad_done_sent: false,
      outbound_message_ids: ['<q.x.0@rfq.example.com>'],
      inbound: [{ inbound_email_id: '44444444-4444-4444-8444-444444444444', message_id: '<orig@x.example>' }],
    });
    await thread.cadJobFinal('c1c1c1c1-0000-4000-8000-000000000002', 'succeeded');
    expect(events(instance).map((e) => e.type)).toEqual(['cad-done']);
    expect(db.calls.filter((c) => c.method === 'select')).toHaveLength(3);
  });

  it('refuses a non-final status', async () => {
    const { thread } = setup();
    await expect(thread.cadJobFinal('j1', 'running' as never)).rejects.toThrow(/final/);
  });
});
