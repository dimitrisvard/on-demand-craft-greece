// The quote after the send and its flag: an RFQ accepted outside the quote e-mails ends the quote 'won' without more
// mail or a second order; a failing step after the send goes on its own phase run (the closed quote run is never
// reopened), Retry continues and leaves no run open; agent.quote is read again before every side-effecting step
// (CAD jobs after the CAD wait, each model call, the send, each follow-up and each outcome).
import { describe, expect, it } from 'vitest';
import { decide } from '../../src/agents/decision';
import type { FakeQueue } from '../helpers/agent-env';
import { DecidingStep, decideAndDeliver, harness, INSTANCE, runCase, seedReply, STAFF, waitingHash, type QuoteHarness } from './harness';
import { FILE_1, QWID, RFQ_ID, RFQ_NUMBER, TENANT } from './seed';

const quoteRow = (h: QuoteHarness) => h.ports.db.rows('quote_workflows', ['id', 'eq', QWID])[0];
const runs = (h: QuoteHarness) => h.ports.db.rows('agent_runs');
const runByKey = (h: QuoteHarness, suffix: string) => runs(h).find((r) => r.idempotency_key === `${RFQ_ID}:v1${suffix}`);
const openRuns = (h: QuoteHarness) => runs(h).filter((r) => r.status === 'running' || r.status === 'waiting_human').map((r) => `${String(r.idempotency_key)}:${String(r.status)}`);
const mails = (h: QuoteHarness) => h.ports.mailer.sent.map((m) => m.idempotency_key);
const rpcCalls = (h: QuoteHarness) => h.ports.db.calls.filter((c) => c.method === 'rpc' && c.target === 'create_order_from_quote');
const setFlag = (h: QuoteHarness, enabled: boolean, rev: number) => h.kv.setJson('agent.quote', enabled ? { enabled: true, value: { mode: 'assist' }, rev } : { enabled: false, value: {}, rev });

/** The portal's Accept Quote (src/pages/customer/QuoteDetailPage.tsx:396-449): RFQ approved and an order row. */
async function portalAccept(h: QuoteHarness): Promise<string> {
  h.ports.db.tables.rfqs[0].status = 'approved';
  const [order] = await h.ports.db.insert<{ id: string }>('orders', { rfq_id: RFQ_ID, status: 'new', currency: 'EUR', title: 'PO-PORTAL-1', po_number: 'PO-PORTAL-1', from_rfq_number: RFQ_NUMBER, tenant_id: TENANT }, { returning: 'id' });
  return order.id;
}

/** A step that approves the draft and runs `onReplyWait` at the first wait of each customer-reply wait name. */
function approvingStep(h: QuoteHarness, onReplyWait?: (name: string) => Promise<void>): DecidingStep {
  const step = new DecidingStep();
  step.hook = async (type, name) => {
    if (type === 'quote-approved' && waitingHash(h)) await decideAndDeliver(h, step, { verb: 'approve' });
    if (type === 'customer-reply') await onReplyWait?.(name);
  };
  return step;
}

describe('accepted outside the quote e-mails', () => {
  it('portal acceptance during the first wait: no follow-up, quote won with the portal order, no RPC call and no event', async () => {
    const h = harness();
    let orderId = '';
    const step = approvingStep(h, async (name) => {
      if (name === 'wait-reply-s1-r0') orderId = await portalAccept(h);
    });
    const { result } = await runCase(h, { step });
    expect(result).toMatchObject({ outcome: 'won', quote_workflow_id: QWID, order_id: orderId });
    expect(mails(h)).toEqual([`quote/${QWID}/send`]);
    expect(quoteRow(h)).toMatchObject({ status: 'won', outcome_reason: 'rfq_approved' });
    expect(h.ports.db.rows('orders')).toHaveLength(1);
    expect(rpcCalls(h)).toHaveLength(0);
    expect((h.env.AGENT_EVENTS as unknown as FakeQueue).sent).toEqual([]);
    expect([...(h.ports.vector.namespaces.get(TENANT)?.values() ?? [])].map((v) => v.metadata.outcome)).toEqual(['won']);
    expect(runByKey(h, ':fu1')).toMatchObject({ status: 'succeeded', output: expect.objectContaining({ outcome: 'won', reason: 'rfq_approved', order_id: orderId }) });
    expect(h.ports.telegram.cards.some((c) => c.card.lines.some((l) => l.value.includes('RFQ accepted on the portal or dashboard (order PO-PORTAL-1)')))).toBe(true);
    expect(openRuns(h)).toEqual([]);
  });

  it('RFQ approved on the dashboard (no order) after follow-up 1: no follow-up 2, quote won without an order', async () => {
    const h = harness();
    const step = approvingStep(h, async (name) => {
      if (name === 'wait-reply-s2-r0') h.ports.db.tables.rfqs[0].status = 'approved';
    });
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('won');
    expect(result.order_id).toBeUndefined();
    expect(mails(h)).toEqual([`quote/${QWID}/send`, `quote/${QWID}/fu1`]);
    expect(quoteRow(h)).toMatchObject({ status: 'won', outcome_reason: 'rfq_approved' });
    expect(h.ports.db.rows('orders')).toHaveLength(0);
    expect(rpcCalls(h)).toHaveLength(0);
  });

  it('accepted during the last wait: the quote ends won, not expired', async () => {
    const h = harness();
    let orderId = '';
    const step = approvingStep(h, async (name) => {
      if (name === 'wait-reply-s3-r0') orderId = await portalAccept(h);
    });
    const { result } = await runCase(h, { step });
    expect(result).toMatchObject({ outcome: 'won', order_id: orderId });
    expect(mails(h)).toEqual([`quote/${QWID}/send`, `quote/${QWID}/fu1`, `quote/${QWID}/fu2`]);
    expect(quoteRow(h)).toMatchObject({ status: 'won', outcome_reason: 'rfq_approved' });
    expect(runByKey(h, ':expire')).toMatchObject({ status: 'succeeded', output: expect.objectContaining({ outcome: 'won' }) });
    expect([...(h.ports.vector.namespaces.get(TENANT)?.values() ?? [])].map((v) => v.metadata.outcome)).toEqual(['won']);
  });
});

describe('failures after the send', () => {
  it('a failing step that opens a phase run puts that run behind the failure card; the quote run stays closed; Retry finishes with no run open', async () => {
    const h = harness();
    const step = approvingStep(h);
    step.crashAt('fu1-run');
    const first = await runCase(h, { step });
    expect(first.result).toMatchObject({ outcome: 'failed', failed_step: 'fu1-run' });
    const main = runByKey(h, '');
    expect(main).toMatchObject({ status: 'succeeded', parked_reason: null, approval_token_sha256: null });
    expect(main?.finished_at).toBeTruthy();
    const fu1 = runByKey(h, ':fu1');
    expect(fu1).toMatchObject({ status: 'waiting_human', parked_reason: 'failed', parent_run_id: main?.id, output: expect.objectContaining({ card_kind: 'failure', failed_step: 'fu1-run', allowed_verbs: ['retry', 'dismiss'] }) });
    expect(first.result.run_id).toBe(fu1?.id);
    expect(quoteRow(h).status).toBe('failed');

    // Retry on the failure card: claim, then restart from the failed step
    const waiting = waitingHash(h, String(fu1?.id));
    h.workflow.ensure(INSTANCE);
    const decided = await decide(h.env, h.ports, { channel: 'dashboard', actor: STAFF, run_id: waiting!.run_id, token_sha256: waiting!.token_sha256, verb: 'retry' });
    expect(decided).toMatchObject({ ok: true, result: { outcome: 'restarted' } });
    expect(h.workflow.instances.get(INSTANCE)?.calls.find((c) => c.method === 'restart')?.args).toEqual({ from: { name: 'fu1-run' } });
    for (const key of [...step.cache.keys()]) if (key.startsWith('fail-run#')) step.cache.delete(key);
    const again = await runCase(h, { step: step.replay() });
    expect(again.result.outcome).toBe('expired');
    expect(openRuns(h)).toEqual([]);
    expect(runByKey(h, '')).toMatchObject({ status: 'succeeded' });
    expect(runByKey(h, ':fu1')).toMatchObject({ status: 'succeeded' });
    expect(mails(h)).toEqual([`quote/${QWID}/send`, `quote/${QWID}/fu1`, `quote/${QWID}/fu2`]);
    expect(quoteRow(h)).toMatchObject({ status: 'expired' });
  });

  it('after a Retry the quote waits for the customer as follow_up again, not failed', async () => {
    const h = harness();
    const step = approvingStep(h);
    step.crashAt('fu1-close');
    const first = await runCase(h, { step });
    expect(first.result).toMatchObject({ outcome: 'failed', failed_step: 'fu1-close' });
    expect(quoteRow(h).status).toBe('failed');
    expect(runByKey(h, ':fu1')).toMatchObject({ status: 'waiting_human', parked_reason: 'failed' });
    for (const key of [...step.cache.keys()]) if (key.startsWith('fail-run#')) step.cache.delete(key);
    const replay = new DecidingStep({ now: step.now, cache: step.cache });
    let waitingAs: unknown = null;
    replay.hook = async (_type, name) => {
      if (name === 'wait-reply-s2-r0') waitingAs = quoteRow(h).status;
    };
    const again = await runCase(h, { step: replay });
    expect(again.result.outcome).toBe('expired');
    expect(waitingAs).toBe('follow_up');
    expect(openRuns(h)).toEqual([]);
  });
});

describe('agent.quote re-read before side effects', () => {
  it('switched off during the CAD wait: no drawing job, no model call, no PDF; the run parks and is cancelled after 7 days', async () => {
    const h = harness();
    h.ports.db.tables.cad_jobs.splice(0);
    h.ports.db.tables.rfq_files[0].sha256 = null;
    h.ports.db.tables.rfq_files[0].file_size = null;
    await h.bucket.put(`rfq/${RFQ_ID}/${FILE_1}-bracket.step`, 'ISO-10303-21;\nHEADER;\nENDSEC;\n');
    const step = new DecidingStep();
    step.hook = async (type) => {
      if (type === 'cad-done') {
        setFlag(h, false, 2);
        step.sendEvent('cad-done', { jobs: [] });
      }
    };
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('cancelled');
    expect(step.trace()).toContain('park-flag-drawings:ok');
    expect(h.llm.calls).toHaveLength(0);
    expect(h.ports.db.rows('cad_jobs', ['job_type', 'eq', 'drawing_pdf'])).toHaveLength(0);
    expect(h.bucket.objects.has(`quotes/${RFQ_ID}/v1/quote.pdf`)).toBe(false);
    expect(runByKey(h, '')).toMatchObject({ status: 'cancelled', error: 'flag_off' });
  });

  it('switched off while a model call waits after a gateway 429: the retry does not call the model', async () => {
    const h = harness();
    h.llm.answer('quote.price_notes@v1', { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'x' } } });
    const step = new DecidingStep();
    let resumed = 0;
    step.hook = async (type) => {
      if (type === 'agent-resumed' && resumed++ === 0) {
        setFlag(h, false, 2);
        step.sendEvent('agent-resumed', {});
      }
    };
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('cancelled');
    expect(step.trace()).toEqual(expect.arrayContaining(['park-price-notes:ok', 'park-flag-price-notes-r2:ok']));
    expect(h.llm.users.filter((u) => u.prompt === 'quote.price_notes@v1')).toHaveLength(1);
    expect(h.llm.users.filter((u) => u.prompt === 'quote.cover_email@v1')).toHaveLength(0);
  });

  it('switched off between write-rfq and the send: nothing is sent', async () => {
    const h = harness();
    const step = approvingStep(h);
    step.beforeDo = (name) => {
      if (name === 'flag-send') setFlag(h, false, 2);
    };
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('cancelled');
    expect(step.trace()).toContain('write-rfq:ok');
    expect(step.trace()).toContain('park-flag-send:ok');
    expect(mails(h)).toEqual([]);
    expect(runByKey(h, '')).toMatchObject({ status: 'cancelled', error: 'flag_off' });
  });

  it('switched off after the send: no follow-up mail, the follow-up run parks (flag_off) and is cancelled', async () => {
    const h = harness();
    const step = approvingStep(h, async (name) => {
      if (name === 'wait-reply-s1-r0') setFlag(h, false, 9);
    });
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('cancelled');
    expect(mails(h)).toEqual([`quote/${QWID}/send`]);
    expect(step.trace()).toContain('park-flag-fu1:ok');
    expect(runByKey(h, ':fu1')).toMatchObject({ status: 'cancelled', error: 'flag_off' });
    expect(runByKey(h, '')).toMatchObject({ status: 'succeeded' });
    expect(quoteRow(h)).toMatchObject({ status: 'cancelled', outcome_reason: 'flag_off' });
  });

  it('switched off before a decided "won" takes effect: no order is created', async () => {
    const h = harness();
    h.llm.answer('quote.classify_reply@v1', { outcome: 'won', confidence: 0.95, summary: 'Accepts.' });
    const inboundId = await seedReply(h, { subject: `Re: ${RFQ_NUMBER}`, text: 'We accept.' });
    const step = new DecidingStep();
    step.sendEvent('customer-reply', { inbound_email_id: inboundId });
    step.hook = async (type) => {
      if (type === 'quote-approved' && waitingHash(h)) await decideAndDeliver(h, step, { verb: 'approve' });
      if (type === 'reply-confirmed' && waitingHash(h)) {
        await decideAndDeliver(h, step, { verb: 'won' });
        setFlag(h, false, 5);
      }
    };
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('cancelled');
    expect(step.trace()).toContain('park-flag-outcome-reply-1:ok');
    expect(rpcCalls(h)).toHaveLength(0);
    expect(h.ports.db.rows('orders')).toHaveLength(0);
  });
});
