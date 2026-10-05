// RP-1 / R-1: reply attribution rules 1-5 against MemoryDb rows, message-id normalisation, tenant scoping and the
// candidate list of rule 4.

import { describe, expect, it } from 'vitest';
import { MAX_MATCH_IDS, matchReply, normaliseMessageId, type ReplyHeaders } from '../../src/replies/match';
import { MemoryDb } from '../helpers/memory-db';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000aa';
const RFQ_A = '0a000000-0000-4000-8000-00000000000a';
const RFQ_B = '0b000000-0000-4000-8000-00000000000b';
const RFQ_C = '0c000000-0000-4000-8000-00000000000c';
const RFQ_D = '0d000000-0000-4000-8000-00000000000d';
const RFQ_X = '0e000000-0000-4000-8000-00000000000e';
const QW_A = '1a000000-0000-4000-8000-00000000000a';
const QW_B = '1b000000-0000-4000-8000-00000000000b';
const QW_C = '1c000000-0000-4000-8000-00000000000c';
const QW_D = '1d000000-0000-4000-8000-00000000000d';
const QW_X = '1e000000-0000-4000-8000-00000000000e';

const OUT_A = `<q.${QW_A}.0@rfq.micronshub.eu>`;
const OUT_A_RESEND = '<0102019a-resend-a@email.amazonses.com>';
const OUT_B = `<q.${QW_B}.0@rfq.micronshub.eu>`;
const OUT_X = `<q.${QW_X}.0@rfq.micronshub.eu>`;

function db(): MemoryDb {
  const d = new MemoryDb();
  d.seed('rfqs', [
    { id: RFQ_A, company_name: 'Example GmbH', rfq_number: 'RFQ-01102026-1', contact_email: 'Erika@Example.de', tenant_id: TENANT },
    { id: RFQ_B, company_name: 'Example GmbH', rfq_number: 'RFQ-02102026-2', contact_email: 'erika@example.de', tenant_id: TENANT },
    { id: RFQ_C, company_name: 'Example GmbH', rfq_number: 'RFQ-03102026-3', contact_email: 'erika@example.de', tenant_id: TENANT },
    { id: RFQ_D, company_name: 'Other Ltd', rfq_number: 'RFQ-04102026-4', contact_email: 'buyer@example.com', tenant_id: TENANT },
    { id: RFQ_X, company_name: 'Foreign AG', rfq_number: 'RFQ-05102026-5', contact_email: 'erika@example.de', tenant_id: OTHER_TENANT },
  ]);
  d.seed('quote_workflows', [
    { id: QW_A, rfq_id: RFQ_A, quote_version: 1, workflow_instance_id: `quote-${RFQ_A}-v1`, status: 'sent', outbound_message_ids: [OUT_A, OUT_A_RESEND], sent_at: '2026-10-01T10:00:00.000Z', tenant_id: TENANT },
    { id: QW_B, rfq_id: RFQ_B, quote_version: 1, workflow_instance_id: `quote-${RFQ_B}-v1`, status: 'follow_up', outbound_message_ids: [OUT_B], sent_at: '2026-10-02T10:00:00.000Z', tenant_id: TENANT },
    { id: QW_C, rfq_id: RFQ_C, quote_version: 1, workflow_instance_id: `quote-${RFQ_C}-v1`, status: 'sent', outbound_message_ids: [], sent_at: '2026-10-03T10:00:00.000Z', tenant_id: TENANT },
    { id: QW_D, rfq_id: RFQ_D, quote_version: 1, workflow_instance_id: `quote-${RFQ_D}-v1`, status: 'won', outbound_message_ids: [], sent_at: '2026-09-20T10:00:00.000Z', tenant_id: TENANT },
    { id: QW_X, rfq_id: RFQ_X, quote_version: 1, workflow_instance_id: `quote-${RFQ_X}-v1`, status: 'sent', outbound_message_ids: [OUT_X], sent_at: '2026-10-04T10:00:00.000Z', tenant_id: OTHER_TENANT },
  ]);
  d.seed('inbound_emails', [
    { id: '2a000000-0000-4000-8000-00000000000a', tenant_id: TENANT, message_id: '<original-rfq-d@example.com>', message_id_sha256: 'a'.repeat(64), mailbox: 'rfq', from_email: 'buyer@example.com', received_at: '2026-09-18T08:00:00.000Z', status: 'rfq_created', rfq_id: RFQ_D },
    { id: '2b000000-0000-4000-8000-00000000000b', tenant_id: TENANT, message_id: '<loose@example.com>', message_id_sha256: 'b'.repeat(64), mailbox: 'replies', from_email: 'someone@example.com', received_at: '2026-09-19T08:00:00.000Z', status: 'needs_review', rfq_id: null },
  ]);
  return d;
}

function headers(h: Partial<ReplyHeaders>): ReplyHeaders {
  return { message_id: '<new-reply@example.de>', in_reply_to: null, references: [], subject: 'Re: your offer', from_email: 'nobody@example.org', ...h };
}

const o = { tenant_id: TENANT };

describe('normaliseMessageId', () => {
  it('trims and keeps brackets and case', () => {
    expect(normaliseMessageId('  <AbC.1@Example.DE>\r\n')).toBe('<AbC.1@Example.DE>');
  });
  it('adds brackets to a bare id', () => {
    expect(normaliseMessageId('abc@example.de')).toBe('<abc@example.de>');
  });
  it('turns empty and malformed values into an empty string', () => {
    expect(normaliseMessageId('')).toBe('');
    expect(normaliseMessageId('<>')).toBe('');
    expect(normaliseMessageId('<a b@x>')).toBe('');
    expect(normaliseMessageId('two ids@x <y@z>')).toBe('');
  });
});

describe('matchReply', () => {
  it('rule 1: In-Reply-To equals our outbound Message-ID (exact, confidence 1)', async () => {
    expect(await matchReply(db(), headers({ in_reply_to: ` ${OUT_A} ` }), o)).toEqual({ rule: 1, confidence: 1, rfq_id: RFQ_A, quote_workflow_id: QW_A });
  });

  it("rule 1 also matches the provider's Message-ID stored for the same quote", async () => {
    expect(await matchReply(db(), headers({ in_reply_to: OUT_A_RESEND }), o)).toMatchObject({ rule: 1, rfq_id: RFQ_A, quote_workflow_id: QW_A });
  });

  it('ids compare case-sensitively: a changed case does not match', async () => {
    expect((await matchReply(db(), headers({ in_reply_to: OUT_A.toUpperCase(), from_email: null }), o)).rule).toBe(5);
  });

  it('rule 2: a References id equals an outbound id', async () => {
    const m = await matchReply(db(), headers({ in_reply_to: '<customer-internal@example.de>', references: ['<x@example.de>', OUT_B] }), o);
    expect(m).toEqual({ rule: 2, confidence: 1, rfq_id: RFQ_B, quote_workflow_id: QW_B });
  });

  it('rule 2: a References id equals the stored inbound mail of an RFQ (its open quote when it has none on the row)', async () => {
    const m = await matchReply(db(), headers({ references: ['<original-rfq-d@example.com>'], from_email: null }), o);
    expect(m).toEqual({ rule: 2, confidence: 1, rfq_id: RFQ_D, quote_workflow_id: null });
  });

  it('rule 2 skips stored inbound mail without an RFQ and never matches the message itself', async () => {
    const d = db();
    expect((await matchReply(d, headers({ references: ['<loose@example.com>'], from_email: null }), o)).rule).toBe(5);
    d.seed('inbound_emails', [{ id: '2c000000-0000-4000-8000-00000000000c', tenant_id: TENANT, message_id: '<new-reply@example.de>', message_id_sha256: 'c'.repeat(64), mailbox: 'replies', from_email: 'x@example.de', received_at: '2026-10-05T08:00:00.000Z', status: 'matched', rfq_id: RFQ_A }]);
    expect((await matchReply(d, headers({ references: ['<new-reply@example.de>'], from_email: null }), o)).rule).toBe(5);
  });

  it('rule 2 uses at most 100 ids', async () => {
    const refs = Array.from({ length: 150 }, (_, i) => `<r${i}@example.de>`);
    const late = await matchReply(db(), headers({ references: [...refs, OUT_B], from_email: null }), o);
    expect(late.rule).toBe(5);
    const early = await matchReply(db(), headers({ references: [...refs.slice(0, MAX_MATCH_IDS - 1), OUT_B], from_email: null }), o);
    expect(early).toMatchObject({ rule: 2, quote_workflow_id: QW_B });
  });

  it('rule 3: the subject names an RFQ number (confidence 0.8, the open quote of that RFQ)', async () => {
    expect(await matchReply(db(), headers({ subject: 'AW: Angebot RFQ-02102026-2 bitte', from_email: null }), o)).toEqual({ rule: 3, confidence: 0.8, rfq_id: RFQ_B, quote_workflow_id: QW_B });
    expect(await matchReply(db(), headers({ subject: 'Re: RFQ-04102026-4', from_email: null }), o)).toEqual({ rule: 3, confidence: 0.8, rfq_id: RFQ_D, quote_workflow_id: null });
  });

  it('rule 3 with an unknown RFQ number falls through', async () => {
    expect((await matchReply(db(), headers({ subject: 'Re: RFQ-31122025-9', from_email: null }), o)).rule).toBe(5);
  });

  it('rule 4: the sender is the contact of waiting quotes; at most 3 candidates, newest sent first, case-insensitive', async () => {
    const d = db();
    const m = await matchReply(d, headers({ from_email: 'ERIKA@example.de' }), o);
    expect(m).toEqual({
      rule: 4,
      confidence: 0.5,
      candidates: [
        { rfq_id: RFQ_C, quote_workflow_id: QW_C },
        { rfq_id: RFQ_B, quote_workflow_id: QW_B },
        { rfq_id: RFQ_A, quote_workflow_id: QW_A },
      ],
    });
    d.seed('rfqs', [{ id: '0f000000-0000-4000-8000-00000000000f', company_name: 'Example GmbH', rfq_number: 'RFQ-06102026-6', contact_email: 'erika@example.de', tenant_id: TENANT }]);
    d.seed('quote_workflows', [{ id: '1f000000-0000-4000-8000-00000000000f', rfq_id: '0f000000-0000-4000-8000-00000000000f', quote_version: 1, workflow_instance_id: 'quote-0f000000-0000-4000-8000-00000000000f-v1', status: 'sent', outbound_message_ids: [], sent_at: '2026-09-01T10:00:00.000Z', tenant_id: TENANT }]);
    const four = await matchReply(d, headers({ from_email: 'erika@example.de' }), o);
    expect(four.rule === 4 && four.candidates.map((c) => c.quote_workflow_id)).toEqual([QW_C, QW_B, QW_A]);
  });

  it('rule 4 ignores quotes that do not wait for the customer and wildcard characters in the address', async () => {
    expect((await matchReply(db(), headers({ from_email: 'buyer@example.com' }), o)).rule).toBe(5);
    expect((await matchReply(db(), headers({ from_email: 'erika@exampl_.de' }), o)).rule).toBe(5);
    expect((await matchReply(db(), headers({ from_email: '%@example.de' }), o)).rule).toBe(5);
  });

  it('rule 5: nothing matches', async () => {
    expect(await matchReply(db(), headers({}), o)).toEqual({ rule: 5, confidence: 0 });
  });

  it('every lookup stays inside the tenant', async () => {
    expect((await matchReply(db(), headers({ in_reply_to: OUT_X, subject: 'Re: RFQ-05102026-5', from_email: null }), o)).rule).toBe(5);
    expect(await matchReply(db(), headers({ in_reply_to: OUT_X }), { tenant_id: OTHER_TENANT })).toMatchObject({ rule: 1, rfq_id: RFQ_X });
  });

  it('rules limits the rules tried (the intake thread-check uses 1-3)', async () => {
    expect((await matchReply(db(), headers({ from_email: 'erika@example.de' }), { tenant_id: TENANT, rules: [1, 2, 3] })).rule).toBe(5);
    expect((await matchReply(db(), headers({ in_reply_to: OUT_A, from_email: 'erika@example.de' }), { tenant_id: TENANT, rules: [3, 4] })).rule).toBe(4);
  });

  it('rule order: In-Reply-To wins over References and the subject', async () => {
    const m = await matchReply(db(), headers({ in_reply_to: OUT_A, references: [OUT_B], subject: 'Re: RFQ-03102026-3' }), o);
    expect(m).toMatchObject({ rule: 1, quote_workflow_id: QW_A });
  });
});
