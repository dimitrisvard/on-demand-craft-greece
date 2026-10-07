// IN-3 (I-4 and the failure path): the rfq-intake Workflow in real workerd, started by a mail injected into
// microns-mail through the Local Explorer, with the model answers served by the Anthropic stub (fixtures registered
// for the content hash the Workflow will send, predicted with the same builders it uses).
//   I-4   a German sheet-metal RFQ with a STEP file: triage, extract, classify -> intake card on Telegram (callback
//         buttons) -> the decision (claim of the card, then 'intake-confirmed' through the Local Explorer) -> RFQ,
//         rfq_files row, R2 copy, cad_jobs row and quote instance 'quote-<rfq_id>-v1'; run 'succeeded' with cost;
//         the gateway headers of every model call (no x-api-key, authorization, 5 metadata keys, payload logging
//         off, fallbacks only on extract).
//   fail  the extract fixture is missing: the run ends on a failure card (Retry / Dismiss) and the mail is
//         'failed'; the test registers the fixture for the recorded hash and decides 'rty': with unit W's relay
//         present through POST /api/agent/decision (signed like the Telegram relay), else exactly what decide()
//         does for 'rty' (claim, then restart the instance from the failed step through the Local Explorer). The
//         restarted instance reuses the earlier steps, extracts, waits for the confirmation and ends 'succeeded'.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  classifySha,
  extractSha,
  globalUrls,
  instance,
  llmRequests,
  registerFixture,
  relayDecision,
  relayPresent,
  restartFrom,
  rows,
  rpc,
  sendEvent,
  sendMail,
  setFlag,
  stepFile,
  telegramCalls,
  TENANT,
  until,
  type OutgoingMail,
  type Row,
} from '../intake/t2-helpers';

const U = globalUrls();
const W_PRESENT = relayPresent();
const STAFF = 'user:0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';

const f = <T>(value: T | null, confidence: number) => ({ value, confidence });
const none = { value: null, confidence: 0 };

function extractFor(company: string, email: string, partName: string) {
  return {
    company: f(company, 0.95),
    contact_first_name: f('Hans', 0.95),
    contact_last_name: f('Müller', 0.95),
    contact_email: f(email, 0.97),
    phone: none,
    vat_id: f('DE123456789', 0.9),
    country: f('DE', 0.95),
    deadline: none,
    language: 'de',
    notes: '',
    parts: [{ name: partName, quantity: f(200, 0.95), material: f('1.4301', 0.95), thickness_mm: f(1.5, 0.95), finish: none, tolerance: none, process_hint: 'sheet_metal', attachment_refs: [1] }],
    injection_suspected: false,
  };
}

const TRIAGE = { kind: 'rfq', language: 'de', injection_suspected: false, confidence: 0.96 };
const CLASSIFY = { process: 'sheet_metal', confidence: 0.93, signals: ['Abkantung', 'Blechdicke 1,5 mm'] };

async function runOfMail(sha: string): Promise<Row | undefined> {
  return (await rows(U, 'agent_runs')).find((r) => r.agent === 'rfq_intake' && r.idempotency_key === sha);
}

async function waitingCard(sha: string, kind: string): Promise<Row> {
  return until(`a ${kind} card for ${sha.slice(0, 16)}`, async () => {
    const run = await runOfMail(sha);
    const output = (run?.output ?? {}) as Row;
    return run && run.status === 'waiting_human' && output.card_kind === kind && run.approval_token_sha256 ? run : null;
  }, 45_000);
}

/** The callback token of the run's current Telegram card (from the sendMessage call carrying its message id). */
async function cardToken(run: Row, code: string): Promise<string> {
  const messageId = (run.output as Row).telegram_message_id;
  const calls = await telegramCalls(U);
  const buttons = calls
    .filter((c) => c.method === 'sendMessage')
    .flatMap((c) => ((c.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined)?.inline_keyboard ?? []).flat())
    .map((b) => b.callback_data ?? '')
    .filter((d) => d.endsWith(`:${code}`));
  expect(typeof messageId).toBe('number');
  const match = /^ap:([A-Z2-7]{26}):/.exec(buttons.at(-1) ?? '');
  if (!match) throw new Error(`no ${code} button found`);
  return match[1];
}

/** The dashboard's decision on an intake card: claim (as decide() does), then the Workflow event. */
async function confirm(run: Row, verb: string): Promise<void> {
  const claimed = (await rpc(U, 'agent_run_claim_approval', { p_token_sha256: run.approval_token_sha256, p_human_action: { channel: 'dashboard', actor: STAFF, verb } })) as Row[];
  expect(claimed).toHaveLength(1);
  await sendEvent(U, 'rfq-intake', String(run.workflow_instance_id), 'intake-confirmed', { verb, actor: STAFF, channel: 'dashboard' });
}

async function succeeded(sha: string): Promise<Row> {
  return until(`run ${sha.slice(0, 16)} succeeded`, async () => {
    const run = await runOfMail(sha);
    return run && run.status === 'succeeded' ? run : null;
  }, 45_000);
}

describe.skipIf(!U.site || !U.stub)('rfq-intake in workerd (I-4)', () => {
  beforeAll(async () => {
    await setFlag(U, 'agent.rfq_intake', { enabled: true, value: { mode: 'assist' }, rev: 10 });
    await setFlag(U, 'agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 10 });
  });

  it('STEP RFQ: card, confirmation, RFQ with file, CAD job and quote instance; run succeeded with cost', async () => {
    const mail: OutgoingMail = {
      from: 'h.mueller@example.de',
      to: 'rfq@rfq.micronshub.eu',
      subject: 'Anfrage Kantteile Winkel W-20 (T2)',
      text: 'Sehr geehrte Damen und Herren,\n\nbitte senden Sie uns ein Angebot für 200 Stück Kantteil Winkel W-20 (Abkantung 90°).\nWerkstoff: 1.4301, Blechdicke 1,5 mm.\n\nMit freundlichen Grüßen\nHans Müller\nBeispiel Metallbau GmbH',
      attachments: [{ filename: 'winkel_w20.step', type: 'application/step', content: stepFile('winkel_w20') }],
    };
    await registerFixture(U, 'rfq_intake.triage@v1', classifySha(mail), TRIAGE);
    await registerFixture(U, 'rfq_intake.classify_process@v1', classifySha(mail), CLASSIFY);
    await registerFixture(U, 'rfq_intake.extract@v1', extractSha(mail), extractFor('Beispiel Metallbau GmbH', 'h.mueller@example.de', 'Kantteil Winkel W-20'));
    const before = (await llmRequests(U)).length;
    const sent = await sendMail(U, mail);

    const waiting = await waitingCard(sent.sha, 'intake');
    expect((waiting.output as Row).allowed_verbs).toEqual(['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq']);
    const token = await cardToken(waiting, 'csm');
    expect(token).toMatch(/^[A-Z2-7]{26}$/);
    if (W_PRESENT) {
      const res = await relayDecision(U, token, 'csm');
      expect(res.status).toBe(200);
    } else {
      await confirm(waiting, 'confirm_sheet_metal');
    }

    const run = await succeeded(sent.sha);
    expect(run).toMatchObject({ llm_calls: 3, approval_token_sha256: null, parked_reason: null, workflow_instance_id: `rfq-intake-${sent.sha.slice(0, 32)}` });
    expect(Number(run.cost_cents)).toBeGreaterThan(0);
    const inbound = (await rows(U, 'inbound_emails')).find((r) => r.message_id_sha256 === sent.sha) as Row;
    const rfq = (await rows(U, 'rfqs')).find((r) => r.inbound_email_id === inbound.id) as Row;
    expect(rfq).toMatchObject({ source: 'email', company_name: 'Beispiel Metallbau GmbH', contact_email: 'h.mueller@example.de', tenant_id: TENANT });
    expect(inbound).toMatchObject({ status: 'rfq_created', rfq_id: rfq.id, kind: 'rfq', agent_run_id: run.id });
    const files = (await rows(U, 'rfq_files')).filter((r) => r.rfq_id === rfq.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ source: 'email', file_name: 'winkel_w20.step', content_type: 'model/step' });
    expect(String(files[0].r2_key)).toBe(`rfq/${String(files[0].file_path)}`);
    const copy = await call(`${U.explorer}/r2/buckets/microns-private/objects/${encodeURIComponent(String(files[0].r2_key))}`);
    expect(copy.status).toBe(200);
    // the analyse job of this run (the quote it started may add its own jobs, e.g. a drawing PDF, once it succeeds)
    const jobs = (await rows(U, 'cad_jobs')).filter((r) => r.rfq_id === rfq.id && r.job_type === 'analyse' && r.requested_by_run_id === run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ job_type: 'analyse', rfq_file_id: files[0].id, requested_by_run_id: run.id, params: expect.objectContaining({ process: 'sheet_metal', material: '1.4301' }) });
    expect((await instance(U, 'quote', `quote-${String(rfq.id)}-v1`)).status).toBe(200);

    // the intake's own calls (the quote it started runs at the same time and makes its own model calls)
    const calls = (await llmRequests(U)).slice(before).filter((c) => c.prompt.startsWith('rfq_intake.'));
    expect(calls.map((c) => c.prompt).sort()).toEqual(['rfq_intake.classify_process@v1', 'rfq_intake.extract@v1', 'rfq_intake.triage@v1']);
    for (const c of calls) {
      expect(c).toMatchObject({ x_api_key: false, cf_aig_authorization: true, cf_aig_collect_log_payload: 'false' });
      expect(c.cf_aig_metadata_keys.sort()).toEqual(['agent', 'prompt', 'run_id', 'step', 'tenant_id']);
      expect(c.fallbacks).toBe(c.prompt === 'rfq_intake.extract@v1' ? 'default' : null);
    }
  });

  it('missing extract fixture: failure card, then Retry restarts from extract and the run ends succeeded', async () => {
    const mail: OutgoingMail = {
      from: 'h.mueller@example.de',
      to: 'rfq@rfq.micronshub.eu',
      subject: 'Anfrage Kantteile Winkel W-30 (T2 retry)',
      text: 'Bitte ein Angebot für 200 Stück Kantteil Winkel W-30, Abkantung 90°, 1.4301, Blechdicke 1,5 mm.\n\nHans Müller\nBeispiel Metallbau GmbH',
      attachments: [{ filename: 'winkel_w30.step', type: 'application/step', content: stepFile('winkel_w30') }],
    };
    await registerFixture(U, 'rfq_intake.triage@v1', classifySha(mail), TRIAGE);
    await registerFixture(U, 'rfq_intake.classify_process@v1', classifySha(mail), CLASSIFY);
    const sent = await sendMail(U, mail);

    const failed = await waitingCard(sent.sha, 'failure');
    expect(failed).toMatchObject({ parked_reason: 'failed', error: 'llm_provider_4xx' });
    expect(failed.output).toMatchObject({ card_kind: 'failure', allowed_verbs: ['retry', 'dismiss'], failed_step: 'extract' });
    const inbound = (await rows(U, 'inbound_emails')).find((r) => r.message_id_sha256 === sent.sha) as Row;
    expect(inbound).toMatchObject({ status: 'failed', error: 'llm_provider_4xx' });

    // The extract request the stub refused: its hash is the one predicted for the mail.
    const refused = (await llmRequests(U)).filter((c) => c.prompt === 'rfq_intake.extract@v1').at(-1);
    expect(refused?.sha256).toBe(extractSha(mail));
    await registerFixture(U, 'rfq_intake.extract@v1', extractSha(mail), extractFor('Beispiel Metallbau GmbH', 'h.mueller@example.de', 'Kantteil Winkel W-30'));

    if (W_PRESENT) {
      const res = await relayDecision(U, await cardToken(failed, 'rty'), 'rty');
      expect(res.status).toBe(200);
    } else {
      const claimed = (await rpc(U, 'agent_run_claim_approval', { p_token_sha256: failed.approval_token_sha256, p_human_action: { channel: 'telegram', actor: 'telegram:4242', verb: 'retry' } })) as Row[];
      expect(claimed).toHaveLength(1);
      await restartFrom(U, 'rfq-intake', String(failed.workflow_instance_id), 'extract');
    }

    const waiting = await waitingCard(sent.sha, 'intake');
    await confirm(waiting, 'confirm_sheet_metal');
    const run = await succeeded(sent.sha);
    expect(run).toMatchObject({ error: null, parked_reason: null, approval_token_sha256: null, llm_calls: 3 });
    expect((await rows(U, 'rfqs')).filter((r) => r.inbound_email_id === inbound.id)).toHaveLength(1);
    const details = (await instance(U, 'rfq-intake', String(run.workflow_instance_id))).result as Row;
    const steps = (details.steps as Array<{ name: string; success: boolean }>).map((s) => `${s.name}:${s.success}`);
    expect(steps).toEqual(expect.arrayContaining(['open-run-1:true', 'triage-1:true', 'extract-1:true', 'create-rfq-1:true', 'notify-and-close-1:true']));
  });
});
