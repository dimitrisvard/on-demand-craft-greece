// CQ-5 / Q-5: the quote Workflow in real workerd with the canonical seed of test/quote/seed.ts (one RFQ with a
// sheet-metal bracket and a succeeded CAD job, owner-style pricing rules) in the mini-PostgREST. The model answers
// are the committed fixtures test/fixtures/llm/quote.* (test/quote/llm-fixtures.test.ts keeps them equal to the
// input the Workflow builds for this seed), served by the Anthropic stub.
//   - 'quote-<rfq>-v1' started through the Local Explorer -> approval card at the Telegram stub (approve / reject
//     buttons, no address in the text)
//   - the dashboard's decision: claim of the card (rpc agent_run_claim_approval), then 'quote-approved' through the
//     Local Explorer
//   - the Resend stub receives exactly one mail: the offer PDF attached, Reply-To the replies address, our
//     Message-ID header and the send idempotency key; the PDF in R2 matches the row's pdf_sha256
//   - rfqs.parts_details carries the approved prices (rfqs.total_amount, shipping_cost, status 'sent'); the quote row
//     is 'sent' with both message ids; one vector per priced line in the stub index; the quote run succeeded

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COVER_ANSWER, FILE_1, QWID, RFQ_ID, RFQ_NUMBER, seedRows, TENANT } from '../quote/seed';
import {
  flagValue,
  globalUrls,
  llmRequests,
  newRows,
  r2Get,
  r2Put,
  resendEmails,
  restoreFlag,
  rows,
  rpc,
  seed,
  sendEvent,
  setFlag,
  startInstance,
  telegramCalls,
  until,
  type Row,
} from '../quote/t2-helpers';

const U = globalUrls();
const INSTANCE = `quote-${RFQ_ID}-v1`;
const STAFF = 'user:0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c4';
const OUR_ID = `<q.${QWID}.0@rfq.micronshub.eu>`;
const PDF_KEY = `quotes/${RFQ_ID}/v1/quote.pdf`;
const STEP = new Uint8Array(readFileSync(new URL('../fixtures/cad/bracket-sheet.step', import.meta.url)));

const mainRun = async (): Promise<Row | undefined> => (await rows(U, 'agent_runs')).find((r) => r.agent === 'quote' && r.idempotency_key === `${RFQ_ID}:v1`);
const quoteRow = async (): Promise<Row | undefined> => (await rows(U, 'quote_workflows')).find((r) => r.id === QWID);
const quoteMails = async () => (await resendEmails(U)).filter((m) => m.idempotency_key?.startsWith(`quote/${QWID}/`));

describe.skipIf(!U.site || !U.stub)('quote in workerd (Q-5)', () => {
  let savedFlag: string | null = null;

  beforeAll(async () => {
    savedFlag = await flagValue(U, 'agent.quote');
    await setFlag(U, 'agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 21 });
    const data = seedRows();
    // the rule and catalogue tables belong to this test alone (the rules version is part of the model input)
    await seed(U, { pricing_rules: data.pricing_rules, catalog_materials: data.catalog_materials }, true);
    const fresh: Record<string, Row[]> = {};
    for (const table of ['rfqs', 'rfq_files', 'cad_jobs', 'quote_workflows']) fresh[table] = await newRows(U, table, data[table]);
    await seed(U, fresh);
    // the STEP file of the succeeded analysis (the drawing job the quote queues reads it)
    await r2Put(U, `rfq/${RFQ_ID}/${FILE_1}-bracket.step`, STEP);
  });

  // the flag goes back to what the run had before this file (other files read and sync the same key)
  afterAll(async () => {
    await restoreFlag(U, 'agent.quote', savedFlag);
  });

  it('draft -> approval card -> quote-approved -> one mail with PDF, Reply-To and Message-ID; RFQ priced; vector stored', async () => {
    const llmBefore = (await llmRequests(U)).length;
    await startInstance(U, 'quote', INSTANCE, { v: 1, rfq_id: RFQ_ID, quote_version: 1, tenant_id: TENANT, trigger: 'dashboard' });

    // approval card
    const waiting = await until('the quote run waiting for approval', async () => {
      const run = await mainRun();
      const kind = (run?.output as Row | undefined)?.card_kind;
      if (run && (['failed', 'cancelled', 'succeeded'].includes(String(run.status)) || (kind && kind !== 'quote'))) {
        const hashes = (await llmRequests(U)).filter((r) => r.prompt.startsWith('quote.')).map((r) => `${r.prompt} ${r.sha256.slice(0, 16)}`);
        throw new Error(`quote run ${String(run.status)} (${String(kind)}): ${String(run.error)}; model requests: ${hashes.join(', ')}`);
      }
      return run && run.status === 'waiting_human' && kind === 'quote' && run.approval_token_sha256 ? run : null;
    }, 120_000);
    expect(waiting.workflow_instance_id).toBe(INSTANCE);
    const card = (await telegramCalls(U)).filter((c) => c.method === 'sendMessage' && String(c.body.text ?? '').includes(`Quote draft ${RFQ_NUMBER} v1`));
    expect(card).toHaveLength(1);
    const text = String(card[0].body.text);
    expect(text).toContain('Example Metall GmbH (DE)');
    expect(text).not.toMatch(/@example\.de/);
    const buttons = ((card[0].body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>> }).inline_keyboard ?? []).flat();
    expect(buttons.filter((b) => b.callback_data).map((b) => b.callback_data?.replace(/^ap:[A-Z2-7]{26}:/, ''))).toEqual(['ok', 'rej']);
    expect((await quoteRow())?.status).toBe('awaiting_approval');

    // the two model calls went to the stub through the gateway shape (no provider key from the Worker)
    const llm = (await llmRequests(U)).slice(llmBefore).filter((r) => r.prompt.startsWith('quote.'));
    expect(llm.map((r) => r.prompt)).toEqual(['quote.price_notes@v1', 'quote.cover_email@v1']);
    for (const r of llm) expect(r).toMatchObject({ model: 'claude-sonnet-5-5', x_api_key: false, cf_aig_authorization: true });

    // the dashboard's decision: claim, then the event
    const claimed = (await rpc(U, 'agent_run_claim_approval', { p_token_sha256: waiting.approval_token_sha256, p_human_action: { channel: 'dashboard', actor: STAFF, verb: 'approve' } })) as Row[];
    expect(claimed).toHaveLength(1);
    await sendEvent(U, 'quote', INSTANCE, 'quote-approved', { verb: 'approve', actor: STAFF, channel: 'dashboard' });

    // one mail at the Resend stub
    const [mail] = await until('the quote mail', async () => {
      const list = await quoteMails();
      return list.length ? list : null;
    }, 120_000);
    expect(mail).toMatchObject({
      idempotency_key: `quote/${QWID}/send`,
      to: ['erika.beispiel@example.de'],
      reply_to: 'replies@rfq.micronshub.eu',
      subject: COVER_ANSWER.subject,
      message_id_header: OUR_ID,
      attachments: [`Offer_${RFQ_NUMBER}_v1.pdf`],
    });
    expect(String(mail.from)).toContain('info@micronshub.eu');

    // the quote row: sent, both ids recorded, the PDF in R2 is the one on the row
    const sent = await until('the quote row sent', async () => {
      const q = await quoteRow();
      return q && q.status === 'sent' ? q : null;
    }, 60_000);
    expect(sent).toMatchObject({ approved_by: STAFF, approved_via: 'dashboard', quote_pdf_r2_key: PDF_KEY });
    expect(sent.outbound_message_ids).toEqual(expect.arrayContaining([OUR_ID, `<${mail.id}@resend.stub>`]));
    expect(sent.resend_email_ids).toEqual([mail.id]);
    const pdf = await r2Get(U, PDF_KEY);
    expect(pdf && Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(createHash('sha256').update(pdf as Uint8Array).digest('hex')).toBe(sent.pdf_sha256);

    // the RFQ carries the approved prices: 20 x 8.62 = 172.40, shipping 35
    const rfq = (await rows(U, 'rfqs')).find((r) => r.id === RFQ_ID) as Row;
    expect(rfq).toMatchObject({ status: 'sent', total_amount: 172.4, shipping_cost: 35 });
    expect(rfq.parts_details).toEqual([expect.objectContaining({ product_name: 'Part 1', quantity: 20, unit_price: 8.62, total_price: 172.4 })]);

    // one vector per priced line in the stub index, the quote run closed with its cost
    const vectors = await until('the quote vectors', async () => {
      const bytes = await r2Get(U, `__stub/vectors/${TENANT}.json`);
      const entries = bytes ? (JSON.parse(Buffer.from(bytes).toString('utf8')) as Array<[string, { metadata: Row }]>) : [];
      return entries.some(([id]) => id === `${QWID}:1`) ? entries : null;
    }, 60_000);
    expect(vectors.find(([id]) => id === `${QWID}:1`)?.[1].metadata).toMatchObject({ quote_workflow_id: QWID, rfq_id: RFQ_ID, line_no: 1, process: 'sheet_metal', unit_price_eur: 8.62, outcome: 'open' });
    const closed = await until('the quote run succeeded', async () => {
      const run = await mainRun();
      return run && run.status === 'succeeded' ? run : null;
    }, 60_000);
    expect(closed).toMatchObject({ approval_token_sha256: null, llm_calls: 2 });
    expect(Number(closed.cost_cents)).toBeGreaterThan(0);

    // still exactly one mail
    expect(await quoteMails()).toHaveLength(1);
  });
});
