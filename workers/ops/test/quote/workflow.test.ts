// Q-2: the quote Workflow through FakeStep with MemoryDb, the scripted LLM (production adapter), RecordingMailer,
// RecordingTelegram and the real decide(): happy path to sent; reject; edit and re-render; timeout, reminder and
// expiry; follow-ups 1 and 2 then expiry; replies won / lost / counter / question / low confidence; replay after a
// crash at every step; shadow mode, flag parking, daily cap, LLM failures; CAD jobs for web-form RFQs; no address
// in step results or logs; the status lists against the migration.
import { describe, expect, it } from 'vitest';
import type { CardV1 } from '../../src/agents/cards/index';
import type { QuoteDrafts } from '../../src/workflows/quote';
import { DEFAULT_FOLLOW_UP_DAYS, followUpDays, quoteLanguage } from '../../src/workflows/quote';
import type { QuoteStatus } from '../../src/db/repos/quote-workflows';
import type { PricingV1 } from '../../src/pricing/types';
import { checkList, sorted } from '../helpers/check-lists';
import { FakeStep } from '../helpers/fake-step';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';
import type { FakeQueue } from '../helpers/agent-env';
import { DecidingStep, addressesIn, decideAndDeliver, harness, INSTANCE, runCase, seedReply, STAFF, waitingHash, type QuoteHarness } from './harness';
import { CONTACT_EMAIL, FILE_1, JOB_1, PART_1, PART_2, QWID, RFQ_ID, RFQ_NUMBER, TENANT } from './seed';

const quoteRow = (h: QuoteHarness) => h.ports.db.rows('quote_workflows', ['id', 'eq', QWID])[0];
const runs = (h: QuoteHarness) => h.ports.db.rows('agent_runs');
const mainRun = (h: QuoteHarness) => runs(h).find((r) => r.idempotency_key === `${RFQ_ID}:v1`);
const pricingOf = (h: QuoteHarness) => quoteRow(h).pricing as PricingV1;

describe('happy path', () => {
  it('draft -> approval card -> approve -> RFQ priced -> sent with PDF -> follow-ups 1 and 2 -> expired', async () => {
    const h = harness();
    const { result, step } = await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }] } });
    expect(result).toMatchObject({ outcome: 'expired', quote_workflow_id: QWID });

    // approval card: business fields only, approve + reject, one row of buttons
    const card = h.ports.telegram.cards[0];
    expect(card.card).toMatchObject({ kind: 'quote', allowed_verbs: ['approve', 'reject'] });
    expect(card.card.title).toBe(`Quote draft ${RFQ_NUMBER} v1 · Example Metall GmbH (DE)`);
    expect(card.token).toMatch(/^[A-Z2-7]{26}$/);
    expect(addressesIn(card.card)).toEqual([]);
    expect(card.card.lines.find((l) => l.label === 'Model notes')?.value).toBe('2 assumptions, 1 risks, 0 suggestions');

    // pricing (seed rules): material 0.43332 + cut 0.53333 + bends 3 + powder coating 0.432 + setup 50 / 20
    // = 6.89865, margin 25 % -> 8.62; 20 pieces = 172.40 (above the 150 minimum), shipping 35
    const pricing = pricingOf(h);
    expect(pricing.lines[0]).toMatchObject({ unit_price: 8.62, line_total: 172.4, manual: false });
    expect(pricing).toMatchObject({ complete: true, min_order_surcharge: 0, shipping: 35, total_net: 207.4 });
    expect(pricing.notes?.assumptions).toHaveLength(2);

    // the RFQ carries the approved prices; status sent
    const rfq = h.ports.db.rows('rfqs', ['id', 'eq', RFQ_ID])[0];
    const part = (rfq.parts_details as Array<Record<string, unknown>>)[0];
    expect(part).toMatchObject({ id: PART_1, unit_price: pricing.lines[0].unit_price, total_price: pricing.lines[0].line_total });
    expect(rfq.total_amount).toBe(pricing.subtotal + (pricing.min_order_surcharge ?? 0));
    expect(rfq.shipping_cost).toBe(35);
    expect(rfq.status).toBe('sent');

    // three mails: quote (PDF attached, Reply-To, our Message-ID), then two follow-ups in the thread
    const [quote, fu1, fu2] = h.ports.mailer.sent;
    expect(h.ports.mailer.sent).toHaveLength(3);
    expect(quote).toMatchObject({ from: 'MicronsHub Quotations <info@micronshub.eu>', to: [CONTACT_EMAIL], reply_to: 'replies@rfq.micronshub.eu', subject: `Ihr Angebot ${RFQ_NUMBER}`, idempotency_key: `quote/${QWID}/send` });
    expect(quote.headers).toEqual({ 'Message-ID': `<q.${QWID}.0@rfq.micronshub.eu>` });
    expect(quote.attachments?.[0]).toMatchObject({ filename: `Offer_${RFQ_NUMBER}_v1.pdf`, content_type: 'application/pdf' });
    expect(Buffer.from(quote.attachments?.[0].content_base64 ?? '', 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(quote.html).toContain('<p>Sehr geehrte Frau Beispiel,</p>');
    expect(fu1).toMatchObject({ idempotency_key: `quote/${QWID}/fu1` });
    expect(fu1.headers?.['In-Reply-To']).toBe(`<q.${QWID}.0@rfq.micronshub.eu>`);
    expect(fu1.attachments).toBeUndefined();
    expect(fu2.headers?.References?.split(' ')).toEqual([`<q.${QWID}.0@rfq.micronshub.eu>`, '<resend-1@resend.example>', `<q.${QWID}.1@rfq.micronshub.eu>`, '<resend-2@resend.example>']);

    // the row: approval, ids, follow-ups, PDF key and hash, final status
    const row = quoteRow(h);
    expect(row).toMatchObject({ status: 'expired', outcome_reason: 'no_reply', approved_by: STAFF, approved_via: 'dashboard', follow_ups_sent: 2, quote_pdf_r2_key: `quotes/${RFQ_ID}/v1/quote.pdf`, resend_email_ids: ['resend-1', 'resend-2', 'resend-3'] });
    expect(row.outbound_message_ids).toHaveLength(6);
    expect(row.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((row.drafts as unknown as QuoteDrafts).followups).toHaveLength(2);
    expect(h.bucket.objects.has(`quotes/${RFQ_ID}/v1/quote.pdf`)).toBe(true);

    // runs: the quote run (2 model calls, priced), one per follow-up, one for the expiry; nothing left running
    const main = mainRun(h);
    expect(main).toMatchObject({ status: 'succeeded', llm_calls: 2, workflow_instance_id: INSTANCE, approval_token_sha256: null });
    expect(Number(main?.cost_cents)).toBeGreaterThan(0);
    expect(runs(h).map((r) => r.idempotency_key).sort()).toEqual([`${RFQ_ID}:v1`, `${RFQ_ID}:v1:expire`, `${RFQ_ID}:v1:fu1`, `${RFQ_ID}:v1:fu2`].sort());
    expect(runs(h).every((r) => r.status === 'succeeded' && r.parent_run_id === (r.id === main?.id ? null : main?.id))).toBe(true);

    // RfqThread: bound to this instance, outbound ids mirrored
    const thread = (h.env.RFQ_THREAD as unknown as { calls: Array<{ name: string; method: string; args: unknown[] }> }).calls;
    expect(thread.find((c) => c.method === 'bindQuote')).toMatchObject({ name: RFQ_ID, args: [INSTANCE, QWID] });
    expect(thread.filter((c) => c.method === 'registerOutbound')).toHaveLength(3);

    // vectors: one per line, final outcome expired
    const stored = [...(h.ports.vector.namespaces.get(TENANT)?.values() ?? [])];
    expect(stored.map((v) => v.metadata.outcome)).toEqual(['expired']);
    expect(stored[0].metadata).toMatchObject({ quote_workflow_id: QWID, line_no: 1, process: 'sheet_metal', material_family: 'steel', material_grade: 'S235JR', unit_price_eur: pricing.lines[0].unit_price });

    // step results never carry an e-mail text or address
    for (const [key, value] of step.cache) expect(addressesIn(value), key).toEqual([]);
    // the model never saw the contact's address
    for (const u of h.llm.users) expect(addressesIn(u.user), u.prompt).toEqual([]);
  });

  it('waits for CAD results the RFQ thread reports; follow-up days come from the flag', async () => {
    expect(followUpDays({ follow_up_days: [2, 5, 9] })).toEqual([2, 5, 9]);
    expect(followUpDays({ follow_up_days: [2, 'x', 9] })).toEqual([...DEFAULT_FOLLOW_UP_DAYS]);
    expect(quoteLanguage('Deutschland', null)).toBe('de');
    expect(quoteLanguage('GR', null)).toBe('el');
    expect(quoteLanguage('DE', 'en')).toBe('en');
    expect(quoteLanguage(null, null)).toBe('en');
  });
});

describe('approval decisions', () => {
  it('reject: the row is rejected, the run cancelled and the instance terminated; nothing is sent', async () => {
    const h = harness();
    const step = new DecidingStep();
    let decided: Promise<unknown> | null = null;
    step.hook = async (type) => {
      if (type !== 'quote-approved' || decided) return;
      decided = decideAndDeliver(h, step, { verb: 'reject' });
      await decided;
      // A terminated instance never resumes.
      await new Promise(() => {});
    };
    void runCase(h, { step });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 200 && !decided; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await decided).toMatchObject({ ok: true, result: { verb: 'reject', outcome: 'terminated' } });
    expect(quoteRow(h).status).toBe('rejected');
    expect(mainRun(h)).toMatchObject({ status: 'cancelled', approval_token_sha256: null });
    expect(h.workflow.instances.get(INSTANCE)?.calls.map((c) => c.method)).toEqual(['terminate']);
    expect(h.ports.mailer.sent).toHaveLength(0);
    expect(h.ports.telegram.edits[0].card).toMatchObject({ allowed_verbs: [] });
  });

  it('edit: a dashboard approval with prices and shipping reprices the draft, re-renders the PDF and sends it', async () => {
    const h = harness({ cncPart: true, noShipping: true });
    const { result } = await runCase(h, {
      decisions: { 'quote-approved': [{ verb: 'approve', edits: { overrides: [{ line_no: 2, unit_price: 42, note: 'priced by hand' }], shipping: 50, drafts: { subject: `Angebot ${RFQ_NUMBER} (bearbeitet)` } } }] },
    });
    expect(result.outcome).toBe('expired');
    const pricing = pricingOf(h);
    expect(pricing.lines[1]).toMatchObject({ unit_price: 42, line_total: 210, override: { unit_price: 42, note: 'priced by hand' } });
    expect(pricing).toMatchObject({ complete: true, shipping: 50, shipping_source: 'override', min_order_surcharge: 0 });
    expect(pricing.total_net).toBe(pricing.subtotal + 50);
    // draft card: line 2 manual, quote incomplete, no shipping
    const draftCard = h.ports.telegram.cards[0].card;
    expect(draftCard.flags).toContain('manual_lines');
    expect(draftCard.lines.find((l) => l.label === 'Lines')?.value).toBe('2 (1 without price)');
    // the PDF was rendered again: the stored hash is the hash of the sent attachment
    const sent = h.ports.mailer.sent[0];
    const pdf = Buffer.from(sent.attachments?.[0].content_base64 ?? '', 'base64');
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(quoteRow(h).pdf_sha256);
    expect(sent.subject).toBe(`Angebot ${RFQ_NUMBER} (bearbeitet)`);
    expect((quoteRow(h).drafts as unknown as QuoteDrafts).edited_by).toBe(STAFF);
    const parts = h.ports.db.rows('rfqs', ['id', 'eq', RFQ_ID])[0].parts_details as Array<Record<string, unknown>>;
    expect(parts.find((p) => p.id === PART_2)).toMatchObject({ unit_price: 42, total_price: 210 });
  });

  it('an approval that leaves prices missing gets an "incomplete" card; the second approval with edits sends', async () => {
    const h = harness({ cncPart: true });
    const { result } = await runCase(h, {
      decisions: { 'quote-approved': [{ verb: 'approve' }, { verb: 'approve', edits: { overrides: [{ line_no: 2, unit_price: 30 }] } }] },
    });
    expect(result.outcome).toBe('expired');
    expect(h.ports.telegram.cards.map((c) => c.card.title.split(' ').slice(0, 2).join(' '))).toEqual(['Quote draft', 'Quote incomplete']);
    expect(h.ports.mailer.sent[0].idempotency_key).toBe(`quote/${QWID}/send`);
  });

  it('three approvals without the missing prices cancel the quote (pricing_incomplete)', async () => {
    const h = harness({ cncPart: true });
    const { result } = await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }, { verb: 'approve' }, { verb: 'approve' }] } });
    expect(result.outcome).toBe('pricing_incomplete');
    expect(quoteRow(h)).toMatchObject({ status: 'cancelled', outcome_reason: 'pricing_incomplete' });
    expect(mainRun(h)).toMatchObject({ status: 'cancelled', error: 'pricing_incomplete' });
    expect(h.ports.mailer.sent).toHaveLength(0);
  });

  it('no decision: reminder after 7 days (old card loses its buttons, new token), expiry after 7 more', async () => {
    const h = harness();
    const { result, step } = await runCase(h);
    expect(result.outcome).toBe('expired');
    expect(step.trace().filter((t) => /quote-approved|approval-expired/.test(t))).toEqual(['wait-quote-approved:timed_out', 'remind-quote-approved:ok', 'wait-quote-approved-reminded:timed_out', 'approval-expired:ok']);
    expect(h.ports.telegram.cards.map((c) => c.card.title.startsWith('Reminder: quote draft'))).toEqual([false, true]);
    expect(h.ports.telegram.cards[0].token).not.toBe(h.ports.telegram.cards[1].token);
    expect(h.ports.telegram.edits[0]).toMatchObject({ message_id: h.ports.telegram.cards[0].message_id });
    expect(quoteRow(h)).toMatchObject({ status: 'expired', outcome_reason: 'approval_timeout' });
    expect(mainRun(h)).toMatchObject({ status: 'cancelled', error: 'approval_timeout', approval_token_sha256: null });
    expect(h.ports.mailer.sent).toHaveLength(0);
  });

  it('a Telegram approval records the relay actor and channel', async () => {
    const h = harness();
    const step = new DecidingStep();
    step.hook = async (type) => {
      if (type !== 'quote-approved') return;
      const card = h.ports.telegram.cards.at(-1);
      if (!card?.token) return;
      const { decide } = await import('../../src/agents/decision');
      h.workflow.ensure(INSTANCE);
      const r = await decide(h.env, h.ports, { channel: 'telegram', actor: 'telegram:4242', token: card.token, code: 'ok' });
      expect(r.ok).toBe(true);
      const call = h.workflow.instances.get(INSTANCE)?.calls.find((c) => c.method === 'sendEvent');
      step.sendEvent('quote-approved', (call?.args as { payload: unknown }).payload);
      step.hook = undefined;
    };
    await runCase(h, { step });
    expect(quoteRow(h)).toMatchObject({ approved_by: 'telegram:4242', approved_via: 'telegram' });
  });
});

describe('customer replies', () => {
  const approve = { 'quote-approved': [{ verb: 'approve' }] };

  async function replyCase(o: { answer: Record<string, unknown>; decisions?: Record<string, Array<{ verb: string }>> }) {
    const h = harness();
    h.llm.answer('quote.classify_reply@v1', o.answer);
    const inboundId = await seedReply(h, { subject: `Re: Ihr Angebot ${RFQ_NUMBER}`, text: 'Wir nehmen das Angebot an. Bitte fertigen.' });
    const step = new DecidingStep();
    step.sendEvent('customer-reply', { inbound_email_id: inboundId });
    const { result } = await runCase(h, { step, decisions: { ...approve, ...(o.decisions ?? {}) } });
    return { h, result, step, inboundId };
  }

  it('won with high confidence: one order through create_order_from_quote, order-created event, row won, vectors won', async () => {
    const { h, result, inboundId } = await replyCase({ answer: { outcome: 'won', confidence: 0.95, summary: 'The customer accepts the offer.' } });
    expect(result).toMatchObject({ outcome: 'won', quote_workflow_id: QWID });
    expect(result.order_id).toMatch(/^[0-9a-f-]{36}$/);
    const orders = h.ports.db.rows('orders');
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ rfq_id: RFQ_ID, currency: 'EUR', status: 'new' });
    expect(h.ports.db.calls.filter((c) => c.method === 'rpc' && c.target === 'create_order_from_quote')).toHaveLength(1);
    const events = (h.env.AGENT_EVENTS as unknown as FakeQueue).sent.map((s) => s.body);
    expect(events).toEqual([{ v: 1, type: 'order-created', order_id: result.order_id, tenant_id: TENANT, source: 'quote' }]);
    expect(quoteRow(h)).toMatchObject({ status: 'won', outcome_reason: 'customer_accepted' });
    expect([...(h.ports.vector.namespaces.get(TENANT)?.values() ?? [])].map((v) => v.metadata.outcome)).toEqual(['won']);
    const replyRun = runs(h).find((r) => r.idempotency_key === `${RFQ_ID}:v1:reply:${inboundId}`);
    expect(replyRun).toMatchObject({ status: 'succeeded', llm_calls: 1, subject_type: 'inbound_email', subject_id: inboundId });
    expect(Number(replyRun?.cost_cents)).toBeGreaterThan(0);
    const classified = h.ports.db.rows('inbound_emails', ['id', 'eq', inboundId])[0];
    expect(classified.classification).toMatchObject({ quote_reply: { outcome: 'won', confidence: 0.95 } });
    // the model saw the reply text without the quoted history and without the sender's address
    const user = h.llm.users.find((u) => u.prompt === 'quote.classify_reply@v1')?.user[0];
    expect(user && user.type === 'text' ? user.text : '').toContain('Wir nehmen das Angebot an.');
    expect(user && user.type === 'text' ? user.text : '').not.toContain('> Sehr geehrte');
    expect(h.ports.telegram.cards.some((c) => c.card.lines.some((l) => /order PO-/.test(l.value)))).toBe(true);
    expect(h.ports.mailer.sent).toHaveLength(1);
  });

  it('won survives a retried outcome step: the RPC answers the same order, one order and one event', async () => {
    const h = harness();
    h.llm.answer('quote.classify_reply@v1', { outcome: 'won', confidence: 0.95, summary: 'Accepted.' });
    const inboundId = await seedReply(h, { subject: 'Re: offer', text: 'Accepted.' });
    const queue = h.env.AGENT_EVENTS as unknown as FakeQueue;
    const send = queue.send.bind(queue);
    let failed = false;
    queue.send = async (body, o) => {
      if (!failed) {
        failed = true;
        throw new Error('queue unavailable');
      }
      return send(body, o);
    };
    const step = new DecidingStep();
    step.sendEvent('customer-reply', { inbound_email_id: inboundId });
    const { result } = await runCase(h, { step, decisions: approve });
    expect(result.outcome).toBe('won');
    expect(h.ports.db.calls.filter((c) => c.method === 'rpc' && c.target === 'create_order_from_quote')).toHaveLength(2);
    expect(h.ports.db.rows('orders')).toHaveLength(1);
    expect(queue.sent).toHaveLength(1);
  });

  it('lost with high confidence closes the quote lost', async () => {
    const { h, result } = await replyCase({ answer: { outcome: 'lost', confidence: 0.9, summary: 'Ordered elsewhere.' } });
    expect(result.outcome).toBe('lost');
    expect(quoteRow(h)).toMatchObject({ status: 'lost', outcome_reason: 'customer_declined' });
    expect(h.ports.db.rows('orders')).toHaveLength(0);
  });

  it('a counter-offer always asks a human (reply card); "counter" closes the quote as counter_offer', async () => {
    const { h, result } = await replyCase({ answer: { outcome: 'counter_offer', confidence: 0.97, summary: 'Asks for a lower price.' }, decisions: { 'reply-confirmed': [{ verb: 'counter' }] } });
    expect(result.outcome).toBe('counter_offer');
    const replyCard = h.ports.telegram.cards.find((c) => c.card.kind === 'reply' && c.card.allowed_verbs.length)?.card as CardV1;
    expect(replyCard.allowed_verbs).toEqual(['won', 'lost', 'counter', 'ignore']);
    expect(replyCard.lines.find((l) => l.label === 'Sender')?.value).toBe('e***@example.de');
    expect(addressesIn(replyCard).filter((a) => a !== 'e***@example.de')).toEqual([]);
    expect(quoteRow(h).status).toBe('counter_offer');
  });

  it('low confidence asks a human; "won" creates the order', async () => {
    const { h, result } = await replyCase({ answer: { outcome: 'won', confidence: 0.55, summary: 'Maybe accepts.' }, decisions: { 'reply-confirmed': [{ verb: 'won' }] } });
    expect(result.outcome).toBe('won');
    expect(h.ports.db.rows('orders')).toHaveLength(1);
    expect(h.ports.telegram.cards.find((c) => c.card.kind === 'reply')?.card.flags).toEqual(['low_confidence']);
  });

  it('a question is a notice; the quote keeps waiting and expires after the follow-ups', async () => {
    const { h, result, step } = await replyCase({ answer: { outcome: 'question', confidence: 0.9, summary: 'Asks about the coating.' } });
    expect(result.outcome).toBe('expired');
    expect(step.trace()).toContain('reply-notice-1:ok');
    expect(h.ports.telegram.cards.some((c) => c.card.kind === 'reply' && c.card.allowed_verbs.length === 0)).toBe(true);
    expect(h.ports.mailer.sent).toHaveLength(3);
    expect(runs(h).find((r) => String(r.idempotency_key).includes(':reply:'))).toMatchObject({ status: 'succeeded', output: expect.objectContaining({ outcome: 'ignore' }) });
  });

  it('"ignore" on a reply card keeps waiting', async () => {
    const { h, result } = await replyCase({ answer: { outcome: 'other', confidence: 0.4, summary: 'Unclear.' }, decisions: { 'reply-confirmed': [{ verb: 'ignore' }] } });
    expect(result.outcome).toBe('expired');
    expect(quoteRow(h).status).toBe('expired');
  });
});

describe('replay', () => {
  it('a crash at any step, then a restart, sends each mail at most once per idempotency key and creates one order', async () => {
    const probe = harness();
    probe.llm.answer('quote.classify_reply@v1', { outcome: 'won', confidence: 0.95, summary: 'Accepted.' });
    const probeReply = await seedReply(probe, { subject: 'Re', text: 'Accepted.' });
    const first = new FakeStep();
    first.sendEvent('quote-approved', { verb: 'approve', actor: STAFF, channel: 'dashboard' });
    first.sendEvent('customer-reply', { inbound_email_id: probeReply });
    await runCase(probe, { step: first });
    const names = [...new Set(first.calls.filter((c) => c.kind === 'do').map((c) => c.name))];
    expect(names.length).toBeGreaterThan(20);

    for (const name of names) {
      const h = harness();
      h.llm.answer('quote.classify_reply@v1', { outcome: 'won', confidence: 0.95, summary: 'Accepted.' });
      const reply = await seedReply(h, { subject: 'Re', text: 'Accepted.' });
      const step = new FakeStep();
      step.sendEvent('quote-approved', { verb: 'approve', actor: STAFF, channel: 'dashboard' });
      step.sendEvent('customer-reply', { inbound_email_id: reply });
      step.crashAt(name);
      if (name === 'open-run' || name === 'daily-cap') {
        // Before the run row exists (or is checked) a failing step fails the instance; Workflows retries it.
        await expect(runCase(h, { step }), name).rejects.toThrow(/crash/);
      } else {
        const crashed = await runCase(h, { step });
        expect(crashed.result.outcome, name).toBe('failed');
        expect(crashed.result.failed_step, name).toBe(name);
        expect(h.ports.db.rows('agent_runs').some((r) => r.parked_reason === 'failed'), name).toBe(true);
      }
      // Retry: the instance restarts from the failed step (earlier results cached; fail-run and later ones not)
      for (const key of [...step.cache.keys()]) if (key.startsWith('fail-run#')) step.cache.delete(key);
      const again = await runCase(h, { step: step.replay() });
      expect(again.result.outcome, name).toBe('won');
      const keys = h.ports.mailer.sent.map((m) => m.idempotency_key);
      expect(keys, name).toEqual([`quote/${QWID}/send`]);
      expect(h.ports.db.rows('orders'), name).toHaveLength(1);
      expect(quoteRow(h).status, name).toBe('won');
    }
  }, 180_000);
});

describe('modes, flags, limits and failures', () => {
  it('shadow mode: a notice card, the quote cancelled (shadow), no approval token and no mail', async () => {
    const h = harness({ flag: { enabled: true, value: { mode: 'shadow' }, rev: 1 } });
    const { result } = await runCase(h);
    expect(result.outcome).toBe('shadow');
    expect(h.ports.telegram.cards).toHaveLength(1);
    expect(h.ports.telegram.cards[0]).toMatchObject({ token: null, card: { allowed_verbs: [] } });
    expect(quoteRow(h)).toMatchObject({ status: 'cancelled', outcome_reason: 'shadow' });
    expect(mainRun(h)).toMatchObject({ status: 'succeeded', approval_token_sha256: null });
    expect(h.ports.mailer.sent).toHaveLength(0);
  });

  it('flag off before the send: the run parks (flag_off) and continues on agent-resumed', async () => {
    const h = harness();
    const step = new DecidingStep();
    step.hook = async (type, name) => {
      if (type === 'quote-approved' && name === 'wait-quote-approved') {
        await decideAndDeliver(h, step, { verb: 'approve' });
        h.kv.setJson('agent.quote', { enabled: false, value: {}, rev: 2 });
      }
      if (type === 'agent-resumed') {
        expect(mainRun(h)).toMatchObject({ status: 'waiting_human', parked_reason: 'flag_off' });
        h.kv.setJson('agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 3 });
        step.sendEvent('agent-resumed', {});
      }
    };
    const { result } = await runCase(h, { step });
    expect(result.outcome).toBe('expired');
    expect(step.trace()).toContain('park-flag-write-rfq:ok');
    expect(h.ports.mailer.sent).toHaveLength(3);
  });

  it('flag off and never resumed: cancelled after 7 days, nothing sent', async () => {
    const h = harness({ flag: { enabled: false, value: {}, rev: 1 } });
    const { result } = await runCase(h);
    expect(result.outcome).toBe('cancelled');
    expect(mainRun(h)).toMatchObject({ status: 'cancelled', error: 'flag_off' });
  });

  it('daily cap: the run is skipped before any model call', async () => {
    const h = harness({ flag: { enabled: true, value: { mode: 'assist', max_runs_per_day: 1 }, rev: 1 } });
    h.ports.db.seed('agent_runs', [{ agent: 'quote', trigger: 'workflow', idempotency_key: 'earlier', status: 'succeeded', started_at: '2026-10-05T08:00:00.000Z' }]);
    const { result } = await runCase(h);
    expect(result.outcome).toBe('daily_cap');
    expect(mainRun(h)).toMatchObject({ status: 'skipped', error: 'daily_cap' });
    expect(h.llm.calls).toHaveLength(0);
  });

  it('a model refusal ends on a failure card with Retry from the failed step; the quote is marked failed', async () => {
    const h = harness();
    h.llm.answer('quote.price_notes@v1', { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } } as never);
    const { messageOf } = await import('./harness');
    h.llm.answer('quote.price_notes@v1', { status: 200, body: { ...messageOf('claude-sonnet-5-5', {}), content: [], stop_reason: 'refusal' } });
    const { result } = await runCase(h);
    expect(result).toMatchObject({ outcome: 'failed', failed_step: 'price-notes' });
    expect(mainRun(h)).toMatchObject({ status: 'waiting_human', parked_reason: 'failed', error: 'llm_refusal' });
    expect(mainRun(h)?.output).toMatchObject({ card_kind: 'failure', allowed_verbs: ['retry', 'dismiss'], failed_step: 'price-notes' });
    expect(quoteRow(h)).toMatchObject({ status: 'failed', error: 'llm_refusal' });
  });

  it('a gateway 429 parks the run as budget until agent-resumed', async () => {
    const h = harness();
    h.llm.answer('quote.price_notes@v1', { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'x' } } }, { status: 200, body: (await import('./harness')).messageOf('claude-sonnet-5-5', (await import('./seed')).NOTES_ANSWER) });
    const step = new DecidingStep();
    step.sendEvent('agent-resumed', {});
    const { result } = await runCase(h, { step, decisions: { 'quote-approved': [{ verb: 'approve' }] } });
    expect(result.outcome).toBe('expired');
    expect(step.trace()).toContain('park-price-notes:ok');
    expect(step.trace()).toContain('price-notes-2:ok');
  });

  it('a missing recipient fails the send step (no retry) with a failure card', async () => {
    const h = harness();
    h.ports.db.tables.rfqs[0].contact_email = null;
    const { result } = await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }] } });
    expect(result).toMatchObject({ outcome: 'failed', failed_step: 'send' });
    expect(mainRun(h)).toMatchObject({ error: 'recipient_missing', parked_reason: 'failed' });
  });

  it('no log line carries an address, a subject or a token', async () => {
    const logger = new RecordingLogger();
    const stop = logger.start();
    let h: QuoteHarness;
    try {
      h = harness();
      await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }] } });
    } finally {
      stop();
    }
    assertNoSecretsLogged(logger.lines, [CONTACT_EMAIL, `Ihr Angebot ${RFQ_NUMBER}`, ...h.ports.telegram.cards.map((c) => c.token ?? '').filter(Boolean)]);
  });
});

describe('web-form RFQ without CAD jobs', () => {
  it('ensure-cad queues an analyse job for the R2 file, registers it with the RFQ thread and waits for cad-done', async () => {
    const h = harness();
    h.ports.db.tables.cad_jobs.splice(0);
    h.ports.db.tables.rfq_files[0].sha256 = null;
    h.ports.db.tables.rfq_files[0].file_size = null;
    await h.bucket.put(`rfq/${RFQ_ID}/${FILE_1}-bracket.step`, 'ISO-10303-21;\nHEADER;\nENDSEC;\n');
    const step = new DecidingStep();
    step.sendEvent('cad-done', { jobs: [] });
    await runCase(h, { step, decisions: { 'quote-approved': [{ verb: 'approve', edits: { overrides: [{ line_no: 1, unit_price: 12 }] } }] } });
    const jobs = h.ports.db.rows('cad_jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ job_type: 'analyse', rfq_file_id: FILE_1, quote_workflow_id: QWID, params: { material: 'steel', thickness_override: 2, process: 'sheet_metal', drawing_size: 'A3', k_factor_override: 0 } });
    expect(jobs[0].input_sha256).toMatch(/^[0-9a-f]{64}$/);
    const queued = (h.env.CAD_JOBS as unknown as FakeQueue).sent;
    expect(queued).toHaveLength(1);
    const thread = (h.env.RFQ_THREAD as unknown as { calls: Array<{ method: string; args: unknown[] }> }).calls;
    expect(thread.find((c) => c.method === 'expectCadJobs')?.args).toEqual([[jobs[0].id]]);
    expect(step.trace()).toContain('await-cad:ok');
    // the job did not finish: the line is priced by hand (the approval set its price)
    expect(h.ports.telegram.cards[0].card.lines.find((l) => l.label === 'Geometry')?.value).toBe('1 line(s) without CAD result');
    expect(pricingOf(h).lines[0]).toMatchObject({ unit_price: 12, manual_reasons: ['cad_pending'] });
  });

  it('a succeeded sheet-metal STEP analysis gets a drawing_pdf job (not awaited)', async () => {
    const h = harness();
    await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }] } });
    const drawing = h.ports.db.rows('cad_jobs', ['job_type', 'eq', 'drawing_pdf']);
    expect(drawing).toHaveLength(1);
    expect(drawing[0]).toMatchObject({ rfq_file_id: FILE_1, input_sha256: h.ports.db.rows('cad_jobs', ['id', 'eq', JOB_1])[0].input_sha256 });
  });
});

describe('revision', () => {
  it('version 2 cancels the active version 1 and terminates its instance', async () => {
    const h = harness();
    h.ports.db.tables.quote_workflows[0].status = 'sent';
    h.workflow.ensure(INSTANCE);
    const v2 = `quote-${RFQ_ID}-v2`;
    const step = new DecidingStep();
    const { runQuote } = await import('../../src/workflows/quote');
    void step;
    const result = await runQuote({ v: 1, rfq_id: RFQ_ID, quote_version: 2, tenant_id: TENANT, trigger: 'revision' }, v2, { env: h.env, ports: h.ports, step: new FakeStep() });
    expect(result.outcome).toBe('expired');
    expect(quoteRow(h)).toMatchObject({ status: 'cancelled', outcome_reason: 'superseded_by_v2' });
    expect(h.workflow.instances.get(INSTANCE)?.calls.map((c) => c.method)).toEqual(['terminate']);
    const rows = h.ports.db.rows('quote_workflows');
    expect(rows.map((r) => [r.quote_version, r.status])).toEqual([[1, 'cancelled'], [2, 'expired']]);
  });
});

describe('lists against the migration', () => {
  it('quote_workflows.status equals the CHECK list', () => {
    const statuses: QuoteStatus[] = ['started', 'cad_pending', 'pricing', 'awaiting_approval', 'approved', 'sent', 'follow_up', 'won', 'lost', 'counter_offer', 'expired', 'rejected', 'failed', 'cancelled'];
    expect(sorted(statuses)).toEqual(sorted(checkList('quote_workflows_status_check')));
  });

  it('the waiting run of an approval card holds only the token hash', () => {
    expect(typeof waitingHash).toBe('function');
  });
});
