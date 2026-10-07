// RP-3 / R-3: reply attribution in real workerd, on its own harness instance (profile 'agents', site primary), so
// the 10-minute dispatcher acts on this file's rows only:
//   - replies@ path: the canonical quote seed of test/quote/seed.ts runs to 'sent' (instance started, approval card
//     claimed, 'quote-approved' through the Local Explorer); a customer reply injected into microns-mail through the
//     Local Explorer (to replies@, In-Reply-To = our outbound Message-ID) -> MailIngest.ingestReply -> agent-events
//     'inbound-reply' -> rule 1 -> row matched, reply run succeeded -> RfqThread.appendInbound -> 'customer-reply'
//     reaches the waiting quote instance: the Local Explorer instance details show the completed event step
//     'wait-reply-s1-r0' and the instance goes on to classify the reply (a quote.classify_reply@v1 request at the
//     Anthropic stub; what the quote does with the answer is the quote unit's Q-5)
//   - dispatcher path: POST /cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops with
//     {"cron":"*/10 * * * *"} runs the Gmail poller (token refresh at the Google token stub, inbox list, metadata and
//     raw MIME at the Gmail stub): a reply to the closed quote of a second RFQ is stored (mailbox gmail, source
//     gmail_poller) and matched by rule 1; a replies@ row left 'received' for 20 minutes is queued again and matched
//     by the RFQ number in its subject (rule 3, notice card without buttons); no token or address in the poller's run
//     output; a second tick stores and queues nothing new.
// The stub client of the harness is loaded at run time by file URL.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, COVER_ANSWER, FILE_1, QWID, RFQ_ID, seedRows, TENANT } from '../quote/seed';
import { call, instance, JSON_HEADERS, llmRequests, logLines, r2Put, rows, rpc, seed, sendEvent, sendMail, setFlag, startInstance, telegramCalls, until, type Row, type Urls } from '../quote/t2-helpers';

const ENABLED = Boolean(process.env.T2_STUB_URL) && process.env.T2_PROFILE === 'agents';

const QUOTE_INSTANCE = `quote-${RFQ_ID}-v1`;
const OUR_ID = `<q.${QWID}.0@rfq.micronshub.eu>`;
const STAFF = 'user:0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c4';
const STEP = new Uint8Array(readFileSync(new URL('../fixtures/cad/bracket-sheet.step', import.meta.url)));

// a second RFQ whose quote is closed (lost): replies to it are attributed and recorded, no Workflow event is due
const RFQ_2 = '8d2f6c3b-5e1a-4b9f-8c21-000000000002';
const QW_2 = '8d2f6c3b-5e1a-4b9f-8c21-0000000000a2';
const RFQ_2_NUMBER = 'RFQ-04102026-3';
const OUT_2 = `<q.${QW_2}.0@rfq.micronshub.eu>`;
const CUSTOMER_2 = 'max.muster@example.de';
const ACCOUNT = '9e3a7d4c-6f2b-4c0a-9d32-000000000001';
const ACCOUNT_EMAIL = 'sales@example.com';
const REFRESH_VALUE = 't2-refresh-value';
const GMAIL_REPLY_ID = '<gmail-reply-1@example.de>';
const ORPHAN_ID = '<orphan-reply-1@example.de>';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function cron(u: Urls, expression: string): Promise<void> {
  const res = await fetch(`${u.explorer}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ cron: expression }) });
  if (!res.ok) throw new Error(`scheduled: ${res.status} ${await res.text()}`);
}

describe.skipIf(!ENABLED)('reply attribution in workerd (R-3, own harness instance)', () => {
  let own: (Urls & { stop: () => Promise<void> }) | null = null;
  let registry = '';
  const u = (): Urls => own as Urls;
  const inboundBySha = async (s: string): Promise<Row | undefined> => (await rows(u(), 'inbound_emails')).find((r) => r.message_id_sha256 === s);
  const replyRun = async (inboundId: string): Promise<Row | undefined> => (await rows(u(), 'agent_runs')).find((r) => r.agent === 'quote' && r.idempotency_key === `quote:inbound-reply:${inboundId}`);

  beforeAll(async () => {
    const harness = (await import(/* @vite-ignore */ new URL('../../../site/test/integration/harness.mjs', import.meta.url).href)) as {
      startHarness(o: Record<string, unknown>): Promise<{ url: string; stub: { url: string }; explorer: string; tmp: string; approvalSecret: string; stop: () => Promise<void> }>;
    };
    // The instance gets its own wrangler dev registry: the Local Explorer resolves ?worker=<name> through that
    // registry, which every wrangler session of the machine shares by default, so a cron or a mail sent to this
    // instance's Explorer would otherwise run in the Worker of the same name of the global harness instance.
    registry = mkdtempSync(path.join(os.tmpdir(), 'microns-t2-registry-'));
    const previous = process.env.WRANGLER_REGISTRY_PATH;
    process.env.WRANGLER_REGISTRY_PATH = registry;
    let h: Awaited<ReturnType<typeof harness.startHarness>>;
    try {
      h = await harness.startHarness({ profile: 'agents', publish: false, quiet: true });
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_REGISTRY_PATH;
      else process.env.WRANGLER_REGISTRY_PATH = previous;
    }
    own = { site: h.url, stub: h.stub.url, explorer: h.explorer, tmp: h.tmp, approvalSecret: h.approvalSecret, stop: h.stop };
    await seed(u(), seedRows());
    await r2Put(u(), `rfq/${RFQ_ID}/${FILE_1}-bracket.step`, STEP);
    await seed(u(), {
      rfqs: [{ id: RFQ_2, rfq_number: RFQ_2_NUMBER, company_name: 'Beispiel Werke AG', country: 'DE', contact_email: CUSTOMER_2, status: 'sent', parts_details: [], tenant_id: TENANT }],
      quote_workflows: [{ id: QW_2, rfq_id: RFQ_2, quote_version: 1, workflow_instance_id: `quote-${RFQ_2}-v1`, status: 'lost', currency: 'EUR', outbound_message_ids: [OUT_2], resend_email_ids: [], sent_at: '2026-10-04T08:00:00.000Z', tenant_id: TENANT }],
      marketing_sender_accounts: [{ id: ACCOUNT, email: ACCOUNT_EMAIL, provider: 'google_workspace', is_active: true, provider_config: { refresh_token: REFRESH_VALUE } }],
    });
    await setFlag(u(), 'agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 41 });
    await setFlag(u(), 'agent.rfq_intake', { enabled: false, rev: 42 });
    await setFlag(u(), 'agent.post_order', { enabled: false, rev: 43 });
  }, 240_000);

  afterAll(async () => {
    await own?.stop();
    if (registry) rmSync(registry, { recursive: true, force: true });
  });

  it("replies@ with In-Reply-To of our quote mail: rule 1, row matched, 'customer-reply' reaches the waiting quote instance", async () => {
    // the quote runs to 'sent'
    await startInstance(u(), 'quote', QUOTE_INSTANCE, { v: 1, rfq_id: RFQ_ID, quote_version: 1, tenant_id: TENANT, trigger: 'dashboard' });
    const waiting = await until('the quote approval card', async () => {
      const run = (await rows(u(), 'agent_runs')).find((r) => r.agent === 'quote' && r.idempotency_key === `${RFQ_ID}:v1`);
      if (run && ['failed', 'cancelled', 'succeeded'].includes(String(run.status))) throw new Error(`quote run ${String(run.status)}: ${String(run.error)}`);
      return run && run.status === 'waiting_human' && (run.output as Row | undefined)?.card_kind === 'quote' && run.approval_token_sha256 ? run : null;
    }, 120_000);
    const claimed = (await rpc(u(), 'agent_run_claim_approval', { p_token_sha256: waiting.approval_token_sha256, p_human_action: { channel: 'dashboard', actor: STAFF, verb: 'approve' } })) as Row[];
    expect(claimed).toHaveLength(1);
    await sendEvent(u(), 'quote', QUOTE_INSTANCE, 'quote-approved', { verb: 'approve', actor: STAFF, channel: 'dashboard' });
    await until('the quote sent', async () => {
      const q = (await rows(u(), 'quote_workflows')).find((r) => r.id === QWID);
      return q && q.status === 'sent' && Array.isArray(q.outbound_message_ids) && (q.outbound_message_ids as string[]).includes(OUR_ID) ? q : null;
    }, 120_000);
    const classifyBefore = (await llmRequests(u())).filter((r) => r.prompt === 'quote.classify_reply@v1').length;

    // the customer answers our mail
    const mail = await sendMail(u(), {
      from: CONTACT_EMAIL,
      to: 'replies@rfq.micronshub.eu',
      subject: `Re: ${COVER_ANSWER.subject}`,
      text: 'Thank you for the offer. We are checking it internally and will come back to you.',
      headers: { 'In-Reply-To': OUR_ID, References: OUR_ID },
    });
    const matched = await until('the reply row matched', async () => {
      const r = await inboundBySha(mail.sha);
      if (r && ['failed', 'rejected', 'needs_review'].includes(String(r.status))) throw new Error(`reply row ${String(r.status)}: ${String(r.error)}`);
      return r && r.status === 'matched' ? r : null;
    }, 60_000);
    expect(matched).toMatchObject({ mailbox: 'replies', kind: 'reply', rfq_id: RFQ_ID, quote_workflow_id: QWID, in_reply_to: OUR_ID });
    expect(String(matched.body_excerpt)).toContain('We are checking it internally');
    const run = await until('the reply run succeeded', async () => {
      const r = await replyRun(String(matched.id));
      return r && r.status === 'succeeded' ? r : null;
    }, 30_000);
    expect(run).toMatchObject({ trigger: 'queue', subject_type: 'inbound_email', subject_id: matched.id, output: expect.objectContaining({ rule: 1, rfq_id: RFQ_ID, quote_workflow_id: QWID }) });
    expect(JSON.stringify(run.output)).not.toContain(CONTACT_EMAIL);

    // the waiting quote instance received 'customer-reply' and went on to classify the reply
    let seen: Array<{ name?: string; type?: string; success?: boolean }> = [];
    const eventStep = await until('the event step in the instance details', async () => {
      const i = await instance(u(), 'quote', QUOTE_INSTANCE);
      seen = (i.result?.steps ?? []) as typeof seen;
      return seen.find((s) => String(s.name ?? '').startsWith('wait-reply-s1-r0') && s.success !== false) ?? null;
    }, 60_000).catch((error: Error) => {
      throw new Error(`${error.message}; steps seen: ${seen.map((s) => `${String(s.name)}:${String(s.type)}:${String(s.success)}`).join(', ')}`);
    });
    expect(String(eventStep.name)).toMatch(/^wait-reply-s1-r0(-1)?$/);
    await until('the reply classification request', async () => ((await llmRequests(u())).filter((r) => r.prompt === 'quote.classify_reply@v1').length > classifyBefore ? true : null), 60_000);

    // no customer address in the ops log lines of this flow
    for (const line of logLines(u(), '[microns-ops]')) expect(line).not.toContain(CONTACT_EMAIL);
  });

  it('the 10-minute dispatcher: Gmail poller stores and attributes a reply; an orphan replies@ row is queued again (rule 3)', async () => {
    // the Gmail inbox of the sender account: a reply to the closed quote of RFQ 2 and an unrelated mail
    const gmailRaw = ['From: Max Muster <max.muster@example.de>', `Message-ID: ${GMAIL_REPLY_ID}`, `In-Reply-To: ${OUT_2}`, `Subject: Re: Angebot ${RFQ_2_NUMBER}`, 'Content-Type: text/plain; charset=utf-8', '', 'Vielen Dank, wir melden uns.', ''].join('\r\n');
    await call(`${u().stub}/__stub/gmail/script`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        historyId: '9100',
        messages: {
          gm1: { headers: { 'Message-ID': GMAIL_REPLY_ID, 'In-Reply-To': OUT_2, From: 'Max Muster <max.muster@example.de>', Subject: `Re: Angebot ${RFQ_2_NUMBER}` }, raw: gmailRaw },
          gm2: { headers: { 'Message-ID': '<news-1@example.net>', From: 'news@example.net', Subject: 'Newsletter' }, raw: 'Subject: Newsletter\r\n\r\nHello\r\n' },
        },
      }),
    });
    // a replies@ row left 'received' for 20 minutes (the consumer never took it), naming RFQ 2 in its subject
    const orphanSha = sha(ORPHAN_ID);
    const orphanRaw = ['From: Max Muster <max.muster@example.de>', 'To: replies@rfq.micronshub.eu', `Message-ID: ${ORPHAN_ID}`, `Subject: Frage zu ${RFQ_2_NUMBER}`, 'Content-Type: text/plain; charset=utf-8', '', 'Gilt das Angebot noch?', ''].join('\r\n');
    await r2Put(u(), `email/${orphanSha}/raw.eml`, new TextEncoder().encode(orphanRaw));
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await seed(u(), {
      inbound_emails: [{ tenant_id: TENANT, message_id: ORPHAN_ID, message_id_sha256: orphanSha, mailbox: 'replies', source: 'email_routing', from_email: CUSTOMER_2, subject: `Frage zu ${RFQ_2_NUMBER}`, received_at: old, created_at: old, raw_r2_key: `email/${orphanSha}/raw.eml`, status: 'received' }],
    });

    await cron(u(), '*/10 * * * *');

    // Gmail: refreshed token in memory, inbox list and history id, metadata of both, raw of the reply only
    const poller = await until('the poller run', async () => {
      const r = (await rows(u(), 'agent_runs')).find((x) => x.agent === 'quote.reply_poller');
      if (r && r.status === 'failed') throw new Error(`poller run failed: ${String(r.error)}`);
      return r && r.status === 'succeeded' ? r : null;
    }, 60_000);
    expect(poller).toMatchObject({ trigger: 'cron', output: { accounts: { [ACCOUNT]: expect.objectContaining({ history_id: '9100', listed: 2, matched_quote: 1, errors: [] }) } } });
    const output = JSON.stringify(poller.output);
    for (const secret of [REFRESH_VALUE, 'stub-access-', ACCOUNT_EMAIL, CUSTOMER_2]) expect(output).not.toContain(secret);
    const tokenCalls = (await (await call(`${u().stub}/__stub/google-token/calls`)).json()) as Array<{ grant_type: string }>;
    expect(tokenCalls.map((c) => c.grant_type)).toEqual(['refresh_token']);
    const gmailCalls = ((await (await call(`${u().stub}/__stub/gmail/calls`)).json()) as Array<{ path: string }>).map((c) => c.path);
    expect(gmailCalls.filter((p) => p.includes('format=raw'))).toEqual(['/gmail/users/me/messages/gm1?format=raw']);
    expect(gmailCalls.some((p) => p.startsWith('/gmail/users/me/messages?'))).toBe(true);
    expect(gmailCalls).toContain('/gmail/users/me/profile');

    // the stored Gmail copy is attributed by rule 1 to RFQ 2 (its quote is closed, so no Workflow event)
    const gmailRow = await until('the Gmail reply matched', async () => {
      const r = await inboundBySha(sha(GMAIL_REPLY_ID));
      if (r && ['failed', 'rejected'].includes(String(r.status))) throw new Error(`gmail row ${String(r.status)}: ${String(r.error)}`);
      return r && r.status === 'matched' ? r : null;
    }, 60_000);
    expect(gmailRow).toMatchObject({ mailbox: 'gmail', source: 'gmail_poller', sender_account_id: ACCOUNT, message_id: GMAIL_REPLY_ID, raw_r2_key: `email/${sha(GMAIL_REPLY_ID)}/raw.eml`, rfq_id: RFQ_2, quote_workflow_id: QW_2 });
    expect((await replyRun(String(gmailRow.id)))?.output).toMatchObject({ rule: 1 });

    // the orphan row: queued again by the dispatcher, attributed by the RFQ number in its subject, notice card
    const orphan = await until('the orphan reply matched', async () => {
      const r = await inboundBySha(orphanSha);
      return r && r.status === 'matched' ? r : null;
    }, 60_000);
    expect(orphan).toMatchObject({ rfq_id: RFQ_2, kind: 'reply' });
    expect((await replyRun(String(orphan.id)))?.output).toMatchObject({ rule: 3 });
    const notices = (await telegramCalls(u())).filter((c) => c.method === 'sendMessage' && String(c.body.text ?? '').includes(`Reply attached to ${RFQ_2_NUMBER}`));
    expect(notices).toHaveLength(1);
    expect(String(notices[0].body.text)).not.toContain(CUSTOMER_2);
    const buttons = ((notices[0].body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> }).inline_keyboard ?? []).flat();
    expect(buttons.filter((b) => b.callback_data)).toEqual([]);

    // a second tick: nothing new is stored, fetched raw or queued
    const inboundCount = (await rows(u(), 'inbound_emails')).length;
    await cron(u(), '*/10 * * * *');
    await new Promise((r) => setTimeout(r, 2500));
    expect((await rows(u(), 'inbound_emails')).length).toBe(inboundCount);
    const rawCalls = ((await (await call(`${u().stub}/__stub/gmail/calls`)).json()) as Array<{ path: string }>).filter((c) => c.path.includes('format=raw'));
    expect(rawCalls).toHaveLength(1);
  });
});
