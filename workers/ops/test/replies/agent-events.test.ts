// RP-1 / R-1: the agent-events consumer: inbound replies through attribution rules 1-5 (attach, notice, "Which
// RFQ?" card and its decisions through decide(), new RFQ, ignore), flag off, redelivery, the last-attempt failure,
// order-created, resume-parked, notice cards; no token or address in any log line or run output.

import { describe, expect, it } from 'vitest';
import { decide } from '../../src/agents/decision';
import { agentEventsConsumer, MAX_ATTEMPTS } from '../../src/queues/agent-events';
import type { AgentEventV1 } from '../../src/queues/messages';
import { assertNoSecretsLogged, RecordingLogger } from '../helpers/recorders';
import { batch, ctx, CUSTOMER, harness, message, OUT_A, QW_A, QW_B, RFQ_A, RFQ_B, replyMime, seedQuotes, STAFF_ACTOR, storeReply, TENANT, type Harness } from './helpers';

async function deliver(h: Harness, body: AgentEventV1, attempts = 1) {
  const m = message(body, attempts);
  await agentEventsConsumer(batch('agent-events', [m]), h.env, ctx, { ports: h.ports });
  return m;
}

const inbound = (id: string): AgentEventV1 => ({ v: 1, type: 'inbound-reply', inbound_email_id: id, tenant_id: TENANT });
const row = (h: Harness, id: string) => h.ports.db.rows('inbound_emails', ['id', 'eq', id])[0];
const runs = (h: Harness) => h.ports.db.rows('agent_runs');

describe('inbound-reply', () => {
  it('agent.quote off: acked, no run, the row stays received', async () => {
    const h = harness({ flags: { 'agent.quote': { enabled: false } } });
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 1, messageId: '<r1@example.de>', inReplyTo: OUT_A, mime: replyMime({ messageId: '<r1@example.de>', inReplyTo: OUT_A }) });
    const m = await deliver(h, inbound(id));
    expect(m.acked).toBe(true);
    expect(runs(h)).toHaveLength(0);
    expect(row(h, id).status).toBe('received');
  });

  it('rule 1: attachments stored and copied to the RFQ, customer-reply forwarded through RfqThread, row matched, run succeeded', async () => {
    const h = harness();
    seedQuotes(h);
    const { id, sha } = await storeReply(h, { n: 1, messageId: '<r1@example.de>', inReplyTo: OUT_A, mime: replyMime({ messageId: '<r1@example.de>', inReplyTo: OUT_A, step: true }) });
    const m = await deliver(h, inbound(id));
    expect(m.acked).toBe(true);
    const r = row(h, id);
    expect(r).toMatchObject({ status: 'matched', kind: 'reply', rfq_id: RFQ_A, quote_workflow_id: QW_A });
    expect(r.body_excerpt).toContain('geaenderte Zeichnung');
    expect(r.body_excerpt).not.toContain('quoted earlier');
    expect((r.attachments as Array<{ kind: string; r2_key: string }>).map((a) => [a.kind, a.r2_key])).toEqual([['step', `email/${sha}/att/1-bracket-rev2.step`]]);
    const files = h.ports.db.rows('rfq_files');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ rfq_id: RFQ_A, source: 'email', file_name: 'bracket-rev2.step' });
    expect(String(files[0].r2_key)).toMatch(new RegExp(`^rfq/${RFQ_A}/[0-9a-f-]{36}-bracket-rev2\\.step$`));
    expect(h.bucket.objects.has(String(files[0].r2_key))).toBe(true);
    expect(h.threadCalls).toEqual([{ name: RFQ_A, method: 'appendInbound', args: [id, '<r1@example.de>'] }]);
    const [run] = runs(h);
    expect(run).toMatchObject({ agent: 'quote', trigger: 'queue', idempotency_key: `quote:inbound-reply:${id}`, status: 'succeeded', subject_type: 'inbound_email', subject_id: id });
    expect(run.output).toMatchObject({ rule: 1, rfq_id: RFQ_A, quote_workflow_id: QW_A, attachments: 1, files: 1 });
  });

  it('a redelivered message changes nothing (run final): no second forward, no second file', async () => {
    const h = harness();
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 1, messageId: '<r1@example.de>', inReplyTo: OUT_A, mime: replyMime({ messageId: '<r1@example.de>', inReplyTo: OUT_A, step: true }) });
    await deliver(h, inbound(id));
    const before = h.ports.db.calls.length;
    const m = await deliver(h, inbound(id));
    expect(m.acked).toBe(true);
    expect(h.threadCalls).toHaveLength(1);
    expect(h.ports.db.rows('rfq_files')).toHaveLength(1);
    expect(h.ports.db.calls.slice(before).filter((c) => c.method !== 'select' && c.target !== 'agent_run_begin')).toEqual([]);
  });

  it('a crash after the forward finishes on redelivery: the same run continues and the row ends matched', async () => {
    const h = harness();
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 1, messageId: '<r1@example.de>', inReplyTo: OUT_A, mime: replyMime({ messageId: '<r1@example.de>', inReplyTo: OUT_A }) });
    const ns = h.env.RFQ_THREAD as unknown as { get: (id: unknown) => { appendInbound: () => Promise<void> } };
    const realGet = ns.get;
    let fail = true;
    ns.get = (x: unknown) => (fail ? { appendInbound: async () => { throw new Error('do unavailable'); } } : realGet(x));
    const first = await deliver(h, inbound(id));
    expect(first.retried).toBe(true);
    expect(runs(h)[0].status).toBe('running');
    expect(row(h, id).status).toBe('received');
    fail = false;
    const second = await deliver(h, inbound(id), 2);
    expect(second.acked).toBe(true);
    expect(runs(h)).toHaveLength(1);
    expect(runs(h)[0].status).toBe('succeeded');
    expect(row(h, id).status).toBe('matched');
  });

  it('the last attempt that fails closes the run failed and the row failed (acked, no endless retries)', async () => {
    const h = harness();
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 1, messageId: '<r1@example.de>', inReplyTo: OUT_A, mime: replyMime({ messageId: '<r1@example.de>', inReplyTo: OUT_A }) });
    (h.env as { RFQ_THREAD?: unknown }).RFQ_THREAD = undefined;
    const early = await deliver(h, inbound(id), 1);
    expect(early.retried).toBe(true);
    const last = await deliver(h, inbound(id), MAX_ATTEMPTS);
    expect(last.acked).toBe(true);
    expect(runs(h)[0]).toMatchObject({ status: 'failed', error: 'reply_failed' });
    expect(row(h, id)).toMatchObject({ status: 'failed', error: 'reply_failed' });
  });

  it('rule 3: attached by the RFQ number in the subject, with a notice card without buttons', async () => {
    const h = harness();
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 2, messageId: '<r2@example.de>', subject: 'AW: RFQ-02102026-2 Frage', from: 'kollege@example.de', mime: replyMime({ messageId: '<r2@example.de>', subject: 'AW: RFQ-02102026-2 Frage', from: 'kollege@example.de' }) });
    await deliver(h, inbound(id));
    expect(row(h, id)).toMatchObject({ status: 'matched', rfq_id: RFQ_B, quote_workflow_id: QW_B });
    expect(h.ports.telegram.cards).toHaveLength(1);
    const notice = h.ports.telegram.cards[0];
    expect(notice.token).toBeNull();
    expect(notice.card).toMatchObject({ kind: 'reply', allowed_verbs: [] });
    expect(JSON.stringify(notice.card)).toContain('k***@example.de');
    expect(JSON.stringify(notice.card)).not.toContain('kollege@example.de');
  });

  it('rule 4: "Which RFQ?" card; decide() attach_2 from the dashboard attaches to the second candidate', async () => {
    const h = harness();
    seedQuotes(h);
    const logger = new RecordingLogger();
    const stop = logger.start();
    try {
      const { id } = await storeReply(h, { n: 3, messageId: '<r3@example.de>', subject: 'Frage zur Lieferung', mime: replyMime({ messageId: '<r3@example.de>', subject: 'Frage zur Lieferung' }) });
      await deliver(h, inbound(id));
      expect(row(h, id).status).toBe('needs_review');
      const [run] = runs(h);
      expect(run.status).toBe('waiting_human');
      expect(run.output).toMatchObject({ card_kind: 'reply_pick', allowed_verbs: ['attach_1', 'attach_2', 'new_rfq', 'ignore'], candidates: [{ rfq_id: RFQ_B, quote_workflow_id: QW_B }, { rfq_id: RFQ_A, quote_workflow_id: QW_A }] });
      const sent = h.ports.telegram.cards[0];
      expect(sent.card.kind).toBe('reply_pick');
      expect(sent.token).toMatch(/^[A-Z2-7]{26}$/);
      const token = sent.token as string;
      expect(JSON.stringify(run.output)).not.toContain(token);
      expect(JSON.stringify(run.output)).not.toContain(CUSTOMER);

      const decided = await decide(h.env, h.ports, { channel: 'dashboard', actor: STAFF_ACTOR, run_id: run.id as string, token_sha256: run.approval_token_sha256 as string, verb: 'attach_2' });
      expect(decided).toMatchObject({ ok: true, result: { outcome: 'event_sent', verb: 'attach_2' } });
      const decision = h.events.sent.at(-1)?.body as AgentEventV1;
      expect(decision).toMatchObject({ type: 'decision', run_id: run.id, card_kind: 'reply_pick', verb: 'attach_2', candidate: 2 });
      await deliver(h, decision);
      expect(row(h, id)).toMatchObject({ status: 'matched', rfq_id: RFQ_A, quote_workflow_id: QW_A });
      expect(runs(h)[0]).toMatchObject({ status: 'succeeded', approval_token_sha256: null, output: { decision: 'attach_2', rfq_id: RFQ_A } });
      expect(h.threadCalls).toEqual([{ name: RFQ_A, method: 'appendInbound', args: [id, '<r3@example.de>'] }]);
      // a second delivery of the decision is a no-op
      await deliver(h, decision);
      expect(h.threadCalls).toHaveLength(1);
      assertNoSecretsLogged(logger.lines, [token, run.approval_token_sha256 as string]);
    } finally {
      stop();
    }
  });

  it('rule 4 decisions: new_rfq starts rfq-intake for the row; ignore rejects the row', async () => {
    const h = harness();
    seedQuotes(h);
    const a = await storeReply(h, { n: 4, messageId: '<r4@example.de>', mime: replyMime({ messageId: '<r4@example.de>' }) });
    const b = await storeReply(h, { n: 5, messageId: '<r5@example.de>', mime: replyMime({ messageId: '<r5@example.de>' }) });
    await deliver(h, inbound(a.id));
    await deliver(h, inbound(b.id));
    const [runA, runB] = runs(h);
    for (const [run, verb] of [[runA, 'new_rfq'], [runB, 'ignore']] as const) {
      const decided = await decide(h.env, h.ports, { channel: 'dashboard', actor: STAFF_ACTOR, run_id: run.id as string, token_sha256: run.approval_token_sha256 as string, verb });
      expect(decided.ok).toBe(true);
      await deliver(h, h.events.sent.at(-1)?.body as AgentEventV1);
    }
    expect(h.intake.created).toEqual([{ id: `rfq-intake-${a.sha.slice(0, 32)}`, params: { v: 1, inbound_email_id: a.id, message_id_sha256: a.sha, tenant_id: TENANT } }]);
    expect(row(h, b.id).status).toBe('rejected');
    expect(runs(h).map((r) => [r.status, (r.output as { decision?: string }).decision])).toEqual([['succeeded', 'new_rfq'], ['succeeded', 'ignore']]);
  });

  it('rule 5 on replies@: a new RFQ (rfq-intake started); with agent.rfq_intake off the row waits for a human', async () => {
    const h = harness();
    const { id, sha } = await storeReply(h, { n: 6, messageId: '<r6@example.de>', from: 'new.customer@example.com', subject: 'Anfrage', mime: replyMime({ messageId: '<r6@example.de>', from: 'new.customer@example.com' }) });
    await deliver(h, inbound(id));
    expect(h.intake.created.map((c) => c.id)).toEqual([`rfq-intake-${sha.slice(0, 32)}`]);
    expect(runs(h)[0]).toMatchObject({ status: 'succeeded', output: { rule: 5, intake: 'started' } });

    const off = harness({ flags: { 'agent.quote': { enabled: true }, 'agent.rfq_intake': { enabled: false } } });
    const r2 = await storeReply(off, { n: 7, messageId: '<r7@example.de>', from: 'new.customer@example.com', mime: replyMime({ messageId: '<r7@example.de>', from: 'new.customer@example.com' }) });
    await deliver(off, inbound(r2.id));
    expect(off.intake.created).toEqual([]);
    expect(row(off, r2.id)).toMatchObject({ status: 'needs_review', error: 'intake_flag_off' });
    expect(runs(off)[0]).toMatchObject({ status: 'skipped' });
  });

  it('rule 5 on a Gmail copy: ignored (row rejected); rules 1-3 only (no card for a Gmail copy)', async () => {
    const h = harness();
    seedQuotes(h);
    const { id } = await storeReply(h, { n: 8, mailbox: 'gmail', messageId: '<r8@example.de>', mime: replyMime({ messageId: '<r8@example.de>' }) });
    await deliver(h, inbound(id));
    expect(row(h, id).status).toBe('rejected');
    expect(h.ports.telegram.cards).toHaveLength(0);
    expect(runs(h)[0]).toMatchObject({ status: 'skipped', output: { rule: 5, action: 'ignored' } });
  });

  it('an unknown or malformed message is acked without effect', async () => {
    const h = harness();
    const a = await deliver(h, { v: 1, type: 'inbound-reply', inbound_email_id: 'nope', tenant_id: TENANT });
    const b = await deliver(h, { v: 1, type: 'something-else' } as unknown as AgentEventV1);
    expect(a.acked && b.acked).toBe(true);
    expect(runs(h)).toHaveLength(0);
  });
});

describe('order-created', () => {
  const ORDER = '4a000000-0000-4000-8000-00000000000a';
  it('agent.post_order on: post-order-<order_id> created once ("already exists" is success)', async () => {
    const h = harness();
    const body: AgentEventV1 = { v: 1, type: 'order-created', order_id: ORDER, tenant_id: TENANT, source: 'portal' };
    expect((await deliver(h, body)).acked).toBe(true);
    expect((await deliver(h, body)).acked).toBe(true);
    expect(h.postOrder.created).toEqual([{ id: `post-order-${ORDER}`, params: { v: 1, order_id: ORDER, tenant_id: TENANT, source: 'portal' } }]);
  });

  it('agent.post_order off: acked, nothing started', async () => {
    const h = harness({ flags: { 'agent.post_order': { enabled: false } } });
    await deliver(h, { v: 1, type: 'order-created', order_id: ORDER, tenant_id: TENANT, source: 'quote' });
    expect(h.postOrder.created).toEqual([]);
  });

  it('a Workflows error other than "already exists" is retried', async () => {
    const h = harness();
    (h.postOrder as unknown as { create: () => Promise<never> }).create = async () => {
      throw new Error('workflows unavailable');
    };
    expect((await deliver(h, { v: 1, type: 'order-created', order_id: ORDER, tenant_id: TENANT, source: 'quote' })).retried).toBe(true);
  });
});

describe('resume-parked and card', () => {
  const parkedRun = (h: Harness, o: { instance: string | null; reason?: string; status?: string }) =>
    h.ports.db.seed('agent_runs', [{ agent: 'quote', trigger: 'workflow', idempotency_key: `k-${Math.random()}`, status: o.status ?? 'waiting_human', parked_reason: o.reason ?? 'flag_off', workflow_name: o.instance ? 'quote' : null, workflow_instance_id: o.instance }])[0];

  it('sends agent-resumed to the running instance of a parked run', async () => {
    const h = harness();
    const instance = h.quote.ensure(`quote-${RFQ_A}-v1`);
    const run = parkedRun(h, { instance: `quote-${RFQ_A}-v1` });
    await deliver(h, { v: 1, type: 'resume-parked', run_id: run.id as string });
    expect(instance.calls).toEqual([{ method: 'sendEvent', args: { type: 'agent-resumed', payload: { run_id: run.id } } }]);
  });

  it('an ended instance closes the run cancelled; a run that is not parked is left alone', async () => {
    const h = harness();
    const instance = h.quote.ensure(`quote-${RFQ_B}-v1`);
    instance.status_ = 'terminated';
    const ended = parkedRun(h, { instance: `quote-${RFQ_B}-v1` });
    const failedCard = parkedRun(h, { instance: `quote-${RFQ_A}-v1`, reason: 'failed' });
    await deliver(h, { v: 1, type: 'resume-parked', run_id: ended.id as string });
    await deliver(h, { v: 1, type: 'resume-parked', run_id: failedCard.id as string });
    expect(h.ports.db.rows('agent_runs', ['id', 'eq', ended.id as string])[0]).toMatchObject({ status: 'cancelled', error: 'instance_ended' });
    expect(h.ports.db.rows('agent_runs', ['id', 'eq', failedCard.id as string])[0]).toMatchObject({ status: 'waiting_human', parked_reason: 'failed' });
    expect(instance.calls).toEqual([]);
  });

  it('card: sent to Telegram without a token; a Bot API error is retried', async () => {
    const h = harness();
    const card = { v: 1, kind: 'reorder', run_id: '8a000000-0000-4000-8000-00000000000a', title: 'Stock notice', lines: [], flags: [], allowed_verbs: [], open_url: 'https://www.micronshub.eu/dashboard/approvals?run=x' } as const;
    expect((await deliver(h, { v: 1, type: 'card', card: { ...card, lines: [] , flags: [], allowed_verbs: [] }, run_id: card.run_id })).acked).toBe(true);
    expect(h.ports.telegram.cards).toEqual([{ message_id: 100, card: { ...card }, token: null }]);
    h.ports.telegram.failNext();
    expect((await deliver(h, { v: 1, type: 'card', card: { ...card, lines: [], flags: [], allowed_verbs: [] }, run_id: card.run_id })).retried).toBe(true);
  });
});
