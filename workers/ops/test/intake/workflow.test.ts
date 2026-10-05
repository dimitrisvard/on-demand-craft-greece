// I-1 and IN-2: the rfq-intake Workflow through FakeStep with MemoryDb (the RPCs of the migration), FakeLlm (the
// fixtures of test/fixtures/llm, replayed through the production adapter), R2 over FakeR2Bucket and the recorders.
//   - every MIME fixture reaches its terminal status;
//   - replay after a crash at every step: exactly one RFQ, one rfq_files row per file, one cad_jobs row per CAD file
//     and one quote instance;
//   - flood control: above the daily cap the run closes 'skipped' (daily_cap), no LLM call, mail 'needs_review';
//   - parks: flag off, gateway 429 (budget) and an LLM outage (llm_unavailable) wait for 'agent-resumed';
//   - a step that fails ends on a failure card (Retry / Dismiss); a restart from the failed step completes the run;
//   - shadow mode, the confirmation reminder and timeout, the follow-up path (thread-check -> attach-to-rfq);
//   - step results and log lines carry no address; the approval token never leaves the card.

import { describe, expect, it } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import type { LlmCall, LlmFailure, LlmPort, LlmResult } from '../../src/ports/index';
import { uuidV5 } from '../../src/mail-in/safe-name';
import { runIntake, type IntakeDeps } from '../../src/workflows/rfq-intake';
import type { ReplyMatch } from '../../src/replies/match';
import { FakeQueue, FakeWorkflow, type FakeLlm } from '../helpers/agent-env';
import { FakeStep } from '../helpers/fake-step';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';
import { addressesIn, caseOf, CASES, harness, runCase, seedMail, STAFF, TENANT, type IntakeHarness } from './cases';

type Row = Record<string, unknown>;

function rows(h: IntakeHarness, table: string, ...filters: Array<readonly [string, 'eq', string]>): Row[] {
  return h.ports.db.rows(table, ...filters);
}

function runOf(h: IntakeHarness): Row {
  const runs = rows(h, 'agent_runs', ['agent', 'eq', 'rfq_intake']);
  expect(runs).toHaveLength(1);
  return runs[0];
}

function inboundOf(h: IntakeHarness, id: string): Row {
  return rows(h, 'inbound_emails', ['id', 'eq', id])[0];
}

/** An LlmPort that answers by prompt id (any content), recording calls; `fail` answers a failure per prompt. */
class ByPromptLlm implements LlmPort {
  readonly calls: string[] = [];
  constructor(
    private readonly values: Record<string, unknown>,
    public fail: Record<string, LlmFailure | undefined> = {},
  ) {}
  async call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    this.calls.push(c.prompt);
    const failure = this.fail[c.prompt];
    if (failure) return failure;
    if (!(c.prompt in this.values)) return { ok: false, code: 'schema', retryable: false, message: 'no value' };
    const model = c.route === 'extract' ? 'claude-sonnet-5-5' : 'claude-haiku-4-5-20251001';
    return { ok: true, value: structuredClone(this.values[c.prompt]) as T, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.0002, model }, model, stop: 'end_turn' };
  }
}

function valuesOf(file: string): Record<string, unknown> {
  const c = caseOf(file);
  return { 'rfq_intake.triage@v1': c.triage, 'rfq_intake.extract@v1': c.extract, 'rfq_intake.classify_process@v1': c.classify };
}

describe('every MIME fixture reaches its terminal status (assist mode, confirmation by the dashboard)', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s', async (_file, c) => {
    const h = harness({ quoteFlag: true });
    const mail = await seedMail(h, c.file);
    const logger = new RecordingLogger();
    const restore = logger.start();
    let result;
    let step: FakeStep;
    try {
      ({ result, step } = await runCase(h, mail, { verb: c.verb }));
    } finally {
      restore();
    }
    expect(result.outcome).toBe(c.outcome);
    const run = runOf(h);
    const inbound = inboundOf(h, mail.id);
    expect(inbound.agent_run_id).toBe(run.id);
    const llm = h.ports.llm as FakeLlm;

    if (c.outcome === 'rfq_created') {
      const rfqs = rows(h, 'rfqs');
      expect(rfqs).toHaveLength(1);
      expect(rfqs[0]).toMatchObject({ source: c.source ?? 'email', inbound_email_id: mail.id, status: 'draft' });
      expect(result.rfq_id).toBe(rfqs[0].id);
      expect(inbound).toMatchObject({ status: 'rfq_created', rfq_id: rfqs[0].id, kind: c.source === 'techpilot' ? 'techpilot' : 'rfq' });
      expect(String(inbound.body_excerpt).length).toBeGreaterThan(10);
      expect(rows(h, 'rfq_files')).toHaveLength(c.files ?? 0);
      for (const f of rows(h, 'rfq_files')) {
        expect(f).toMatchObject({ rfq_id: rfqs[0].id, source: c.source ?? 'email', r2_key: `rfq/${String(f.file_path)}` });
        expect(String(f.file_path)).toMatch(new RegExp(`^${String(rfqs[0].id)}/${String(f.id)}-[A-Za-z0-9._-]+$`));
        expect(h.bucket.objects.has(String(f.r2_key))).toBe(true);
      }
      expect(rows(h, 'cad_jobs')).toHaveLength(c.cadJobs ?? 0);
      expect((h.env.CAD_JOBS as unknown as FakeQueue).sent).toHaveLength(c.cadJobs ?? 0);
      const thread = (h.env.RFQ_THREAD as unknown as { calls: Array<{ name: string; method: string; args: unknown[] }> }).calls;
      expect(thread).toEqual([{ name: String(rfqs[0].id), method: 'expectCadJobs', args: [rows(h, 'cad_jobs').map((j) => j.id)] }]);
      expect((h.env.QUOTE as unknown as FakeWorkflow).created).toEqual([{ id: `quote-${String(rfqs[0].id)}-v1`, params: { v: 1, rfq_id: rfqs[0].id, quote_version: 1, tenant_id: TENANT, trigger: 'intake' } }]);
      expect(run).toMatchObject({ status: 'succeeded', llm_calls: 3, approval_token_sha256: null, parked_reason: null });
      expect(Number(run.cost_cents)).toBeGreaterThan(0);
      expect(run.human_action).toBeNull();
      // one confirmation card (four verbs, token) and the RFQ-created notice (no buttons)
      const cards = h.ports.telegram.cards;
      expect(cards.map((x) => [x.card.kind, x.card.allowed_verbs.length, x.token === null])).toEqual([
        ['intake', 4, true],
        ['intake', 0, true],
      ]);
      expect(cards[1].card.open_url).toBe(`https://www.micronshub.eu/rfq/${String(rfqs[0].id)}`);
      expect(llm.calls.map((x) => x.prompt)).toEqual(['rfq_intake.triage@v1', 'rfq_intake.extract@v1', 'rfq_intake.classify_process@v1']);
      // contact: the From address (a platform notice: the address written in its text)
      expect(rfqs[0].contact_email).toBe(c.source === 'techpilot' ? 'p.schmidt@example.de' : inbound.from_email);
    } else {
      expect(rows(h, 'rfqs')).toHaveLength(0);
      if (c.outcome === 'auto_reply') {
        expect(llm.calls).toEqual([]);
        expect(inbound).toMatchObject({ status: 'rejected', kind: 'auto_reply' });
        expect(run).toMatchObject({ status: 'skipped', llm_calls: 0 });
      } else if (c.outcome === 'other') {
        expect(inbound).toMatchObject({ status: 'rejected', kind: 'other' });
        expect(run).toMatchObject({ status: 'skipped', llm_calls: 1 });
        expect(h.ports.telegram.cards).toHaveLength(1);
        expect(h.ports.telegram.cards[0]).toMatchObject({ token: null, card: { allowed_verbs: [] } });
      } else if (c.outcome === 'reply') {
        expect(inbound).toMatchObject({ kind: 'reply' });
        expect((h.env.AGENT_EVENTS as unknown as FakeQueue).sent.map((m) => m.body)).toEqual([{ v: 1, type: 'inbound-reply', inbound_email_id: mail.id, tenant_id: TENANT }]);
        expect(run).toMatchObject({ status: 'succeeded' });
      }
    }
    // Workflow state: ids, kinds and counts only; no address in any step result; small results.
    for (const [key, value] of step.cache) {
      expect(addressesIn(value), `step result ${key}`).toEqual([]);
      expect(JSON.stringify(value ?? null).length, key).toBeLessThan(64 * 1024);
    }
    expect(addressesIn(result)).toEqual([]);
    assertNoSecretsLogged(logger.lines, [String(inbound.subject ?? 'no subject')]);
    expect(addressesIn(run.output)).toEqual([]);
  });
});

describe('replay after a crash at every step', () => {
  it.each([['en-zip.eml'], ['en-step-pdf.eml']])('%s: one RFQ, one rfq_files row per file, one cad_jobs row per CAD file, one quote', async (file) => {
    const c = caseOf(file);
    const h = harness({ quoteFlag: true });
    const mail = await seedMail(h, file);
    const { result, step } = await runCase(h, mail, { verb: c.verb });
    expect(result.outcome).toBe('rfq_created');
    const entries = [...step.cache.entries()];
    expect(entries.length).toBeGreaterThan(15);
    for (let i = 0; i < entries.length; i++) {
      // The run is lost after the first i results were stored: the step at position i (whose effects may already
      // have happened) and every later step run again.
      const replay = new FakeStep({ cache: new Map(entries.slice(0, i)) });
      const again = await runCase(h, mail, { step: replay, verb: c.verb });
      expect(['rfq_created', 'exists'], `crash before ${entries[i][0]}`).toContain(again.result.outcome);
      expect(rows(h, 'rfqs'), `crash before ${entries[i][0]}`).toHaveLength(1);
      expect(rows(h, 'rfq_files')).toHaveLength(c.files ?? 0);
      expect(rows(h, 'cad_jobs')).toHaveLength(c.cadJobs ?? 0);
      expect(rows(h, 'agent_runs')).toHaveLength(1);
      expect((h.env.QUOTE as unknown as FakeWorkflow).instances.size).toBe(1);
      // file ids are stable, so a replay copies to the same key: one R2 object per RFQ file
      const rfqId = String(rows(h, 'rfqs')[0].id);
      expect([...h.bucket.objects.keys()].filter((k) => k.startsWith(`rfq/${rfqId}/`))).toHaveLength(c.files ?? 0);
    }
    for (const f of rows(h, 'rfq_files')) expect(f.id).toBe(await uuidV5(String(f.rfq_id), String(f.sha256)));
    expect(runOf(h)).toMatchObject({ status: 'succeeded' });
  });
});

describe('flood control (daily cap)', () => {
  it('above value.max_runs_per_day: run skipped (daily_cap), no LLM call, mail needs_review, one notice', async () => {
    const h = harness({ flag: { enabled: true, value: { mode: 'assist', max_runs_per_day: 2 }, rev: 1 } });
    h.ports.db.seed('agent_runs', [
      { agent: 'rfq_intake', trigger: 'email', idempotency_key: 'earlier-1', status: 'succeeded', started_at: '2026-10-05T01:00:00.000Z' },
      { agent: 'rfq_intake', trigger: 'email', idempotency_key: 'earlier-2', status: 'succeeded', started_at: '2026-10-05T02:00:00.000Z' },
    ]);
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const { result } = await runCase(h, mail);
    expect(result.outcome).toBe('daily_cap');
    const run = rows(h, 'agent_runs', ['idempotency_key', 'eq', mail.sha])[0];
    expect(run).toMatchObject({ status: 'skipped', error: 'daily_cap', llm_calls: 0 });
    expect((h.ports.llm as FakeLlm).calls).toEqual([]);
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'needs_review', error: 'daily_cap' });
    expect(h.ports.telegram.texts).toHaveLength(1);
    expect(h.ports.bucket.objects.has(`email/${mail.sha}/body.txt`)).toBe(false);
  });
});

describe('parks', () => {
  it('flag off: parked (flag_off) until agent-resumed; 7 days without it -> cancelled, mail needs_review', async () => {
    const h = harness({ flag: { enabled: false, value: { mode: 'assist' }, rev: 2 } });
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const parkedSeen: Row[] = [];
    const step = new FakeStep();
    step.onWait = () => parkedSeen.push(runOf(h));
    const { result } = await runCase(h, mail, { step });
    expect(result.outcome).toBe('cancelled');
    expect(parkedSeen[0]).toMatchObject({ status: 'waiting_human', parked_reason: 'flag_off', approval_token_sha256: null });
    expect(runOf(h)).toMatchObject({ status: 'cancelled', error: 'flag_off', parked_reason: null });
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'needs_review' });
    expect(step.trace()).toContain('resume-flag-start:timed_out');
  });

  it('flag off, then on with agent-resumed: the run resumes (running, park cleared) and completes', async () => {
    const h = harness({ flag: { enabled: false, value: { mode: 'assist' }, rev: 2 }, quoteFlag: true });
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const step = new FakeStep();
    step.onWait = (type) => {
      if (type === 'agent-resumed') {
        h.kv.setJson('agent.rfq_intake', { enabled: true, value: { mode: 'assist' }, rev: 3 });
        step.sendEvent('agent-resumed', {});
      }
    };
    const { result } = await runCase(h, mail, { step, verb: 'confirm_sheet_metal' });
    expect(result.outcome).toBe('rfq_created');
    expect(step.trace()).toEqual(expect.arrayContaining(['flag-start:ok', 'resume-flag-start:ok', 'resumed-flag-start:ok', 'flag-start-2:ok']));
    expect(runOf(h)).toMatchObject({ status: 'succeeded', parked_reason: null });
  });

  it('gateway 429 parks the run as budget; after agent-resumed the call is made again', async () => {
    const h = harness({ quoteFlag: true });
    const llm = new ByPromptLlm(valuesOf('de-sheet-metal-step.eml'), { 'rfq_intake.triage@v1': { ok: false, code: 'budget', retryable: false, message: '429' } });
    h.ports.llm = llm as unknown as FakeLlm;
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const step = new FakeStep();
    const parked: Row[] = [];
    step.onWait = (type) => {
      if (type === 'agent-resumed') {
        parked.push(runOf(h));
        llm.fail = {};
        step.sendEvent('agent-resumed', {});
      }
    };
    const { result } = await runCase(h, mail, { step, verb: 'confirm_sheet_metal' });
    expect(result.outcome).toBe('rfq_created');
    expect(parked[0]).toMatchObject({ status: 'waiting_human', parked_reason: 'budget' });
    expect(llm.calls.filter((p) => p === 'rfq_intake.triage@v1')).toHaveLength(2);
    expect(step.trace()).toEqual(expect.arrayContaining(['triage:ok', 'park-triage:ok', 'resume-triage:ok', 'triage-2:ok']));
  });

  it('a retryable LLM failure is retried by the step; when the retries are used up the run parks (llm_unavailable)', async () => {
    const h = harness();
    const llm = new ByPromptLlm(valuesOf('de-sheet-metal-step.eml'), { 'rfq_intake.extract@v1': { ok: false, code: 'provider_5xx', retryable: true, message: '503' } });
    h.ports.llm = llm as unknown as FakeLlm;
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const step = new FakeStep();
    let parked: Row | undefined;
    step.onWait = (type) => {
      if (type === 'agent-resumed') parked = runOf(h);
    };
    const { result } = await runCase(h, mail, { step });
    expect(result.outcome).toBe('cancelled');
    expect(llm.calls.filter((p) => p === 'rfq_intake.extract@v1')).toHaveLength(4);
    expect(parked).toMatchObject({ status: 'waiting_human', parked_reason: 'llm_unavailable' });
    expect(runOf(h)).toMatchObject({ status: 'cancelled', error: 'llm_unavailable' });
  });
});

describe('failure card and restart from the failed step', () => {
  it('a refusal on extract: failure card (retry, dismiss), mail failed; restart from extract completes the run', async () => {
    const h = harness({ quoteFlag: true });
    const llm = new ByPromptLlm(valuesOf('en-step-pdf.eml'), { 'rfq_intake.extract@v1': { ok: false, code: 'refusal', retryable: false, message: 'declined' } });
    h.ports.llm = llm as unknown as FakeLlm;
    const mail = await seedMail(h, 'en-step-pdf.eml');
    const first = await runCase(h, mail);
    expect(first.result).toMatchObject({ outcome: 'failed', failed_step: 'extract' });
    const run = runOf(h);
    expect(run).toMatchObject({ status: 'waiting_human', parked_reason: 'failed', error: 'llm_refusal', finished_at: null });
    expect(run.approval_token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.output).toMatchObject({ card_kind: 'failure', allowed_verbs: ['retry', 'dismiss'], failed_step: 'extract' });
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'failed', error: 'llm_refusal' });
    const failureCard = h.ports.telegram.cards.at(-1);
    expect(failureCard?.card.kind).toBe('failure');

    // Retry: decide() claims the card (run 'running') and restarts the instance from 'extract': the results of the
    // earlier steps are reused, 'extract' and every later step run again.
    await h.ports.db.rpc('agent_run_claim_approval', { p_token_sha256: run.approval_token_sha256, p_human_action: { channel: 'telegram', actor: 'telegram:42', verb: 'retry' } });
    llm.fail = {};
    const entries = [...first.step.cache.entries()];
    const cut = entries.findIndex(([key]) => key === 'extract#1');
    const restarted = new FakeStep({ cache: new Map(entries.slice(0, cut)) });
    const second = await runCase(h, mail, { step: restarted, verb: 'confirm_sheet_metal' });
    expect(second.result.outcome).toBe('rfq_created');
    expect(restarted.trace().slice(0, 3)).toEqual(['open-run:cached', 'daily-cap:cached', 'flag-start:cached']);
    expect(runOf(h)).toMatchObject({ status: 'succeeded', approval_token_sha256: null, parked_reason: null, error: null });
    expect(rows(h, 'rfqs')).toHaveLength(1);
  });

  it('missing raw MIME: failure card at parse-and-store with a fixed error code', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    h.bucket.objects.delete(`email/${mail.sha}/raw.eml`);
    const { result } = await runCase(h, mail);
    expect(result).toMatchObject({ outcome: 'failed', failed_step: 'parse-and-store' });
    expect(runOf(h)).toMatchObject({ status: 'waiting_human', parked_reason: 'failed', error: 'raw_mime_missing' });
  });

  it('a missing binding fails only the step that needs it (config_missing, names only)', async () => {
    const h = harness();
    h.env.RFQ_THREAD = undefined;
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const { result } = await runCase(h, mail, { verb: 'confirm_sheet_metal' });
    expect(result).toMatchObject({ outcome: 'failed', failed_step: 'enqueue-cad' });
    expect(runOf(h)).toMatchObject({ error: 'config_missing: RFQ_THREAD' });
    expect(rows(h, 'rfqs')).toHaveLength(1);
  });
});

describe('modes and the human wait', () => {
  it('shadow: one notice without buttons, no RFQ, run succeeded, mail stays parsed', async () => {
    const h = harness({ flag: { enabled: true, value: { mode: 'shadow' }, rev: 1 } });
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const { result } = await runCase(h, mail);
    expect(result.outcome).toBe('shadow');
    expect(rows(h, 'rfqs')).toHaveLength(0);
    expect(h.ports.telegram.cards).toHaveLength(1);
    expect(h.ports.telegram.cards[0]).toMatchObject({ token: null, card: { kind: 'intake', allowed_verbs: [] } });
    expect(runOf(h)).toMatchObject({ status: 'succeeded', approval_token_sha256: null, output: expect.objectContaining({ mode: 'shadow', needs_card: true }) });
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'parsed', kind: 'rfq', classification: expect.objectContaining({ process: 'sheet_metal' }) });
  });

  it('no answer: reminder card after 7 days (old hash replaced), then 7 more days -> mail needs_review, run cancelled', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const hashes: unknown[] = [];
    const step = new FakeStep();
    step.onWait = (type) => {
      if (type === 'intake-confirmed') hashes.push(runOf(h).approval_token_sha256);
    };
    const { result } = await runCase(h, mail, { step });
    expect(result.outcome).toBe('timed_out');
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(h.ports.telegram.cards.map((c) => c.card.title.startsWith('Reminder'))).toEqual([false, true]);
    expect(runOf(h)).toMatchObject({ status: 'cancelled', error: 'confirmation_timeout', approval_token_sha256: null });
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'needs_review' });
  });

  it('the confirmation card: intake verbs, injection and sender flags; the token is only in the Telegram button', async () => {
    const h = harness();
    (h.env as { AGENT_APPROVAL_SECRET?: string }).AGENT_APPROVAL_SECRET = 'relay-test-value';
    const mail = await seedMail(h, 'injection.eml');
    const logger = new RecordingLogger();
    const restore = logger.start();
    let step: FakeStep;
    try {
      ({ step } = await runCase(h, mail));
    } finally {
      restore();
    }
    const sent = h.ports.telegram.cards[0];
    expect(sent.card).toMatchObject({ kind: 'intake', allowed_verbs: ['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq'], flags: ['dmarc_fail', 'injection_suspected'] });
    expect(sent.token).toMatch(/^[A-Z2-7]{26}$/);
    const tokens = h.ports.telegram.cards.map((c) => c.token).filter((t): t is string => typeof t === 'string');
    expect(JSON.stringify([...step.cache.values()])).not.toMatch(new RegExp(tokens.join('|')));
    expect(JSON.stringify(rows(h, 'agent_runs'))).not.toMatch(new RegExp(tokens.join('|')));
    assertNoSecretsLogged(logger.lines, tokens);
  });

  it('a verb other than a confirmation ends the run (not_rfq), the mail rejected', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    const { result } = await runCase(h, mail, { verb: 'not_rfq' });
    expect(result.outcome).toBe('not_rfq');
    expect(runOf(h)).toMatchObject({ status: 'cancelled' });
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'rejected' });
  });

  it('the confirmed process decides the CAD job parameters', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    await runCase(h, mail, { verb: 'confirm_mixed' });
    const job = rows(h, 'cad_jobs')[0];
    expect(job.params).toEqual({ material: '1.4301', thickness_override: 1.5, k_factor_override: 0, drawing_size: 'A4', process: 'mixed' });
    expect((h.env.CAD_JOBS as unknown as FakeQueue).sent[0].body).toMatchObject({ v: 1, job_type: 'analyse', backend: 'auto', params: { process: 'mixed' }, input: { store: 'r2', file_name: 'winkel_w20.step' } });
  });
});

describe('follow-up of a known RFQ (thread-check -> attach-to-rfq)', () => {
  const RFQ_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';

  it('rules 1-3 match: files and CAD jobs added to the RFQ, thread mirror updated, mail attached, no extraction', async () => {
    const h = harness();
    h.ports.db.seed('rfqs', [{ id: RFQ_ID, rfq_number: 'RFQ-05102026-1', company_name: 'Example Fabrication Ltd', title: 'RFQ-05102026-1 - Example', parts_details: [], status: 'draft', currency: 'EUR' }]);
    const llm = new ByPromptLlm({ 'rfq_intake.triage@v1': { kind: 'rfq', language: 'en', injection_suspected: false, confidence: 0.9 } });
    h.ports.llm = llm as unknown as FakeLlm;
    const mail = await seedMail(h, 'en-step-pdf.eml');
    const matched: unknown[] = [];
    const match: IntakeDeps['match'] = async (_db, headers, o) => {
      matched.push({ headers, o });
      return { rule: 3, confidence: 0.8, rfq_id: RFQ_ID, quote_workflow_id: null } satisfies ReplyMatch;
    };
    // The fixture has no RFQ number or reply headers, so the subject is changed as a follow-up would read.
    await h.ports.db.update('inbound_emails', { subject: 'Additional drawing for RFQ-05102026-1' }, { filters: [['id', 'eq', mail.id]] });
    h.bucket.objects.set(`email/${mail.sha}/raw.eml`, { ...h.bucket.objects.get(`email/${mail.sha}/raw.eml`)!, bytes: new TextEncoder().encode(new TextDecoder().decode(h.bucket.objects.get(`email/${mail.sha}/raw.eml`)!.bytes).replace('Subject: RFQ: 50 laser-cut brackets', 'Subject: Additional drawing for RFQ-05102026-1')) });
    const { result } = await runCase(h, mail, { deps: { match } });
    expect(result).toMatchObject({ outcome: 'attached', rfq_id: RFQ_ID });
    expect(matched).toEqual([{ headers: expect.objectContaining({ subject: 'Additional drawing for RFQ-05102026-1' }), o: { tenant_id: TENANT, rules: [1, 2, 3] } }]);
    expect(llm.calls).toEqual(['rfq_intake.triage@v1']);
    expect(rows(h, 'rfq_files')).toHaveLength(2);
    expect(rows(h, 'cad_jobs')).toHaveLength(1);
    const calls = (h.env.RFQ_THREAD as unknown as { calls: Array<{ name: string; method: string; args: unknown[] }> }).calls;
    expect(calls.map((c) => [c.name, c.method])).toEqual([
      [RFQ_ID, 'appendInbound'],
      [RFQ_ID, 'expectCadJobs'],
    ]);
    expect(calls[0].args).toEqual([mail.id, '<rfq-en-step-pdf-001@mail.example.com>']);
    expect(inboundOf(h, mail.id)).toMatchObject({ status: 'attached', rfq_id: RFQ_ID });
    expect(runOf(h)).toMatchObject({ status: 'succeeded' });
    expect(h.ports.telegram.cards[0].card.title).toBe('Follow-up mail attached to RFQ-05102026-1');
  });

  it('a mail without reply headers or an RFQ number is not matched (no attribution call)', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    let called = 0;
    const { result } = await runCase(h, mail, { verb: 'confirm_sheet_metal', deps: { match: async () => (called++, { rule: 5, confidence: 0 }) } });
    expect(result.outcome).toBe('rfq_created');
    expect(called).toBe(0);
  });
});

describe('input and existing runs', () => {
  it('invalid params are refused before any step', async () => {
    const h = harness();
    const step = new FakeStep();
    await expect(runIntake({ v: 1, inbound_email_id: 'x', message_id_sha256: 'a'.repeat(64), tenant_id: TENANT } as never, 'rfq-intake-x', { env: h.env, ports: h.ports, step })).rejects.toBeInstanceOf(NonRetryableError);
    expect(step.calls).toEqual([]);
  });

  it('a run that already ended exits at open-run', async () => {
    const h = harness();
    const mail = await seedMail(h, 'auto-reply.eml');
    await runCase(h, mail);
    const step = new FakeStep();
    const { result } = await runCase(h, mail, { step });
    expect(result.outcome).toBe('exists');
    expect(step.trace()).toEqual(['open-run:ok']);
  });

  it('dashboard confirmation actor is kept in the run summary; step results hold no address', async () => {
    const h = harness();
    const mail = await seedMail(h, 'de-sheet-metal-step.eml');
    await runCase(h, mail, { verb: 'confirm_sheet_metal' });
    expect(runOf(h).output).toMatchObject({ confirmed: true, confirmed_by: STAFF });
  });
});
