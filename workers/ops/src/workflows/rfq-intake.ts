// RfqIntakeWorkflow ('rfq-intake'): one instance per inbound RFQ e-mail (id 'rfq-intake-<32 hex of
// message_id_sha256>', started by MailIngest.startIntake or the dispatcher). Params carry ids only.
//
//   open-run            agent_runs row (agent rfq_intake, key = message_id_sha256); a final run exits; prompts pinned
//   daily-cap           above value.max_runs_per_day: run 'skipped' (daily_cap), mail 'needs_review', no LLM call
//   flag-start          agent.rfq_intake off -> run parked (flag_off) until 'agent-resumed' (7 days, then cancelled)
//   parse-and-store     raw MIME from R2, attachments to email/<sha>/att/<n>-<safe> (ZIP entries streamed), the
//                       quote-stripped text to email/<sha>/body.txt, inbound_emails.attachments, body_excerpt
//                       (first 4,000 characters), status 'parsed'
//   triage-rules        auto replies, bounces and bulk mail decided without a model
//   triage              rfq_intake.triage@v1 when the rules did not decide
//   end-non-rfq         spam / auto_reply / other: mail 'spam' or 'rejected', run 'skipped' (notice for 'other')
//   hand-to-replies     a reply: agent-events 'inbound-reply', run 'succeeded'
//   thread-check        reply attribution rules 1-3 (In-Reply-To, References, RFQ number in the subject)
//   attach-to-rfq       a follow-up of a known RFQ: files and CAD jobs added to it, mail 'attached'
//   flag-extract        flag re-read before the extraction
//   extract             rfq_intake.extract@v1 (text, attachment list, one PDF trimmed to 5 pages, up to 3 images);
//                       the result is stored in inbound_emails.parsed, the step keeps a summary without addresses
//   classify-process    rfq_intake.classify_process@v1 plus process rules; combine-process merges them
//   dedupe-customer     existing customer by the contact address (exact, case-insensitive); suggestions only
//   decide              a human confirms unless mode 'auto' and every check passes; shadow: notice only, then end
//   request-confirmation, wait-intake-confirmed (7 days, reminder, 7 days, then mail 'needs_review', run cancelled)
//   flag-create         flag re-read before any business write
//   create-rfq          rpc/create_email_rfq (one RFQ per mail; source 'email' or 'techpilot')
//   copy-file-<n>, insert-files   RFQ files at rfq/<rfq_id>/<file_id>-<safe> and their rfq_files rows
//   enqueue-cad         one cad_jobs row + cad-jobs message per STEP/STL/DXF file; RfqThread.expectCadJobs
//   start-quote         QuoteWorkflow 'quote-<rfq_id>-v1' when agent.quote is on ("already exists" = success)
//   notify-and-close    run 'succeeded' with usage and cost; notice card with the RFQ link
// Every step after daily-cap runs inside one try/catch: a step that throws ends in step 'fail-run', which puts
// the run behind a failure card (Retry restarts the instance from that step; Dismiss closes it) and marks the
// mail 'failed'. LLM steps: a retryable provider failure is retried by the step; when the retries are used up the
// run parks as 'llm_unavailable', a gateway 429 parks it as 'budget', both until 'agent-resumed'. Refusals, schema
// failures and other provider 4xx are not retried (failure card).
// Step results and the return value carry ids, kinds, counts and short business fields only: no e-mail text and
// no address (the mail text is read from R2 and the row by each step that needs it). Nothing here logs an
// address, a subject or a token.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig, type WorkflowTimeoutDuration } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { request, isWaitTimeout, waitWithReminder } from '../agents/approval';
import { attachedCard, createdCard, intakeCard, notRfqCard, shadowCard, VERB_PROCESS, type IntakeCardInput } from '../agents/cards/intake';
import { maskEmail } from '../agents/cards/index';
import { isConfigMissing, need } from '../agents/config';
import type { DecisionEventPayload } from '../agents/decision';
import { readFlag } from '../agents/flags';
import { isAlreadyExists, quoteInstanceId } from '../agents/ids';
import { loadPrompt, registerPromptSource, selectPrompt, type PromptId } from '../agents/prompts/registry';
import { addUsage, applyDailyCap, checkpointRun, closeRun, EMPTY_USAGE, failRun, isFinal, openRun, parkRun, usageColumns, type UsageAcc } from '../agents/runs';
import { DbError } from '../db/postgrest';
import { enqueueCadJob } from '../db/repos/cad-jobs';
import { getInboundEmail, updateInboundEmail, type InboundEmailRow, type InboundKind } from '../db/repos/inbound-emails';
import { agentFileRow, insertAgentFiles, type RfqFileRow } from '../db/repos/rfq-files';
import { createEmailRfq, customerCandidates, getRfq } from '../db/repos/rfqs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { AttachmentRecord } from '../mail-in/attachments';
import { storeAttachments } from '../mail-in/attachments';
import { authResultsOf } from '../mail-in/auth-results';
import {
  classifyContent,
  combineProcess,
  companyFallback,
  contactEmailFor,
  decideCard,
  extractConfidence,
  extractContent,
  EXTRACT_TEXT_CHARS,
  fileKinds,
  mailSignals,
  MAX_IMAGE_BASE64,
  MAX_IMAGES,
  MAX_REQUEST_BYTES,
  minConfidenceOf,
  partCount,
  processRules,
  rfqPayload,
  triageRules,
  type CardReason,
  type ClassifyProcessV1,
  type DocumentForModel,
  type EmailForModel,
  type ImageForModel,
  type MailSignals,
  type Process,
  type ProcessDecision,
  type ProcessRuleResult,
  type RfqExtractV1,
  type TriageV1,
} from '../mail-in/intake';
import { parseMime } from '../mail-in/parse';
import { stripQuoted } from '../mail-in/quote-strip';
import { bodyTextKey, rawKey, uuidV5 } from '../mail-in/safe-name';
import { CAD_KINDS, RFQ_FILE_KINDS } from '../mail-in/sniff';
import { bytesToBase64, trimPdf } from '../pdf/trim';
import { makePorts, type JsonSchemaObject, type LlmContent, type LlmUsage, type Ports } from '../ports/index';
import { matchReply, type ReplyHeaders, type ReplyMatch } from '../replies/match';
import { BLOB, DB, LLM_CLASSIFY, LLM_EXTRACT, PURE } from './steps';
import triagePrompt from '../agents/prompts/rfq_intake/triage.v1.md';
import triageSchema from '../agents/prompts/rfq_intake/triage.v1.schema.json';
import extractPrompt from '../agents/prompts/rfq_intake/extract.v1.md';
import extractSchema from '../agents/prompts/rfq_intake/extract.v1.schema.json';
import classifyPrompt from '../agents/prompts/rfq_intake/classify_process.v1.md';
import classifySchema from '../agents/prompts/rfq_intake/classify_process.v1.schema.json';

registerPromptSource('rfq_intake.triage@v1', triagePrompt, triageSchema as Record<string, unknown>);
registerPromptSource('rfq_intake.extract@v1', extractPrompt, extractSchema as Record<string, unknown>);
registerPromptSource('rfq_intake.classify_process@v1', classifyPrompt, classifySchema as Record<string, unknown>);

export interface RfqIntakeParams {
  v: 1;
  inbound_email_id: string;
  message_id_sha256: string;
  tenant_id: string;
}

export type IntakeOutcome =
  | 'exists'
  | 'daily_cap'
  | 'cancelled'
  | 'spam'
  | 'auto_reply'
  | 'other'
  | 'reply'
  | 'attached'
  | 'shadow'
  | 'timed_out'
  | 'not_rfq'
  | 'rfq_created'
  | 'failed';

/** Return value of a run (kept by Workflows for 30 days): ids and the outcome only. */
export interface IntakeResult {
  outcome: IntakeOutcome;
  run_id: string;
  rfq_id?: string;
  failed_step?: string;
}

export interface IntakeDeps {
  env: OpsEnv;
  ports: Ports;
  step: WorkflowStep;
  /** Reply attribution (src/replies/match.ts); tests pass their own. */
  match?: (db: Ports['db'], h: ReplyHeaders, o: { tenant_id: string; rules?: ReadonlyArray<1 | 2 | 3 | 4> }) => Promise<ReplyMatch>;
}

const AGENT = 'rfq_intake' as const;
const FLAG = 'agent.rfq_intake' as const;
/** How long a parked run waits for 'agent-resumed' before it is cancelled. */
export const PARK_TIMEOUT: WorkflowTimeoutDuration = '7 days';
export const CONFIRM_FIRST: WorkflowTimeoutDuration = '7 days';
export const CONFIRM_SECOND: WorkflowTimeoutDuration = '7 days';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function isIntakeParams(p: unknown): p is RfqIntakeParams {
  const x = p as Record<string, unknown> | null;
  return (
    typeof x === 'object' &&
    x !== null &&
    x.v === 1 &&
    typeof x.inbound_email_id === 'string' &&
    UUID.test(x.inbound_email_id) &&
    typeof x.message_id_sha256 === 'string' &&
    HEX64.test(x.message_id_sha256) &&
    typeof x.tenant_id === 'string' &&
    UUID.test(x.tenant_id)
  );
}

/** Ends the run early with a result (not an error: the top-level catch passes it through). */
class Halt {
  constructor(readonly result: IntakeResult) {}
}

/**
 * Error code written to the run and the mail: a fixed code found in the error (the runtime wraps the message of an
 * error that leaves a step, e.g. 'Step threw a NonRetryableError with message "NonRetryableError: llm_refusal"'),
 * else the error's name. Never other message text.
 */
export function errorCode(e: unknown): string {
  if (isConfigMissing(e)) return `config_missing: ${e.names.join(', ')}`.slice(0, 200);
  if (e instanceof DbError) return `db_error ${e.status}${e.code ? ` ${e.code}` : ''}`;
  const message = e instanceof Error ? e.message : String(e);
  const known =
    /\b(config_missing: [A-Z0-9_]+(?:, [A-Z0-9_]+)*|llm_(?:refusal|max_tokens|schema|provider_4xx|provider_5xx|timeout|budget|unavailable)|(?:raw_mime|body_text|inbound_email|parsed)_missing|invalid_params)\b/.exec(message) ??
    /postgrest [a-z]+ [a-z_./]+: ([0-9]{3}(?: [A-Za-z0-9_]+)?)/.exec(message);
  if (known) return (known[0].startsWith('postgrest') ? `db_error ${known[1]}` : known[1]).slice(0, 200);
  const name = e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) ? e.name : 'Error';
  return name === 'Error' ? 'error' : name;
}

/** True for the error an LLM step throws for a retryable provider failure. */
function isLlmUnavailable(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes('llm_unavailable');
}

function strip(text: string | null | undefined, max: number): string | null {
  const v = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return v ? v.slice(0, max) : null;
}

interface ParseResult {
  signals: MailSignals;
  attachments: AttachmentRecord[];
  text_chars: number;
  from_html: boolean;
}

interface ExtractSummary {
  company: string | null;
  country: string | null;
  language: string | null;
  confidence: number;
  injection_suspected: boolean;
  parts: Array<{ refs: number[]; material: string | null; thickness_mm: number | null; process_hint: string }>;
  unreadable: number;
}

type LlmStepResult<T> = { ok: true; value: T; usage: LlmUsage } | { ok: false; park: 'budget'; usage: LlmUsage | null };

/** The production entry point: ports from the environment, then runIntake(). */
export class RfqIntakeWorkflow extends WorkflowEntrypoint<OpsEnv, RfqIntakeParams> {
  async run(event: Readonly<WorkflowEvent<RfqIntakeParams>>, step: WorkflowStep): Promise<IntakeResult> {
    return runIntake(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), step });
  }
}

export async function runIntake(p: RfqIntakeParams, instanceId: string, d: IntakeDeps): Promise<IntakeResult> {
  if (!isIntakeParams(p)) throw new NonRetryableError('invalid_params');
  const { env, ports, step } = d;
  const db = ports.db;
  const match = d.match ?? matchReply;
  const id = p.inbound_email_id;
  const sha = p.message_id_sha256;
  const tenant = p.tenant_id;
  let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  let current = 'open-run';
  /** Attachment records of the mail (set by parse-and-store). */
  let records: AttachmentRecord[] = [];

  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
    current = name;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };
  const log = (outcome: string) => console.log(formatLogLine(LOG_PREFIX, 'rfq intake', { sha: sha.slice(0, 16), outcome }));

  // 0 open-run
  const opened = await run('open-run', DB, async () => {
    const flag = await readFlag(env, FLAG, tenant);
    const prompts = {
      triage: selectPrompt('rfq_intake.triage', flag),
      extract: selectPrompt('rfq_intake.extract', flag),
      classify: selectPrompt('rfq_intake.classify_process', flag),
    };
    const r = await openRun(db, {
      agent: AGENT,
      trigger: 'email',
      idempotency_key: sha,
      workflow_name: 'rfq-intake',
      workflow_instance_id: instanceId,
      subject_type: 'inbound_email',
      subject_id: id,
      prompt_version: `${prompts.triage},${prompts.extract},${prompts.classify}`,
      tenant_id: tenant,
    });
    if (!isFinal(r.status)) await updateInboundEmail(db, id, { agent_run_id: r.run_id });
    return { run_id: r.run_id, final: isFinal(r.status), prompts };
  });
  const run_id = opened.run_id;
  if (opened.final) {
    log('exists');
    return { outcome: 'exists', run_id };
  }
  const prompts = opened.prompts as { triage: PromptId; extract: PromptId; classify: PromptId };

  // 0b daily-cap (flood control, before any LLM call)
  const capped = await run('daily-cap', DB, async () => {
    const flag = await readFlag(env, FLAG, tenant);
    const stop = await applyDailyCap(env, ports, { run_id, agent: AGENT, flag });
    if (stop) await updateInboundEmail(db, id, { status: 'needs_review', error: 'daily_cap' });
    return stop;
  });
  if (capped) {
    log('daily_cap');
    return { outcome: 'daily_cap', run_id };
  }

  // ----- helpers that need the run -----

  const readBodyText = async (): Promise<string> => {
    const object = await ports.blob.get(bodyTextKey(sha));
    if (!object) throw new NonRetryableError('body_text_missing');
    return new Response(object.body).text();
  };

  const readRow = async (): Promise<InboundEmailRow> => {
    const row = await getInboundEmail(db, id);
    if (!row) throw new NonRetryableError('inbound_email_missing');
    return row;
  };

  const emailForModel = async (): Promise<EmailForModel> => {
    const row = await readRow();
    return { subject: row.subject, from_name: row.from_name, from_email: row.from_email, text: await readBodyText() };
  };

  /** Parks the run, waits for 'agent-resumed' and resumes it; on timeout the run is cancelled (Halt). */
  const parkAndWait = async (name: string, reason: 'flag_off' | 'budget' | 'llm_unavailable'): Promise<void> => {
    await run(`park-${name}`, DB, async () => {
      await checkpointRun(db, run_id, acc);
      await parkRun(db, run_id, reason);
      return true;
    });
    try {
      await step.waitForEvent(`resume-${name}`, { type: 'agent-resumed', timeout: PARK_TIMEOUT });
    } catch (error) {
      if (!isWaitTimeout(error)) throw error;
      await run(`park-expired-${name}`, DB, async () => {
        await closeRun(db, run_id, { status: 'cancelled', error: reason }, acc);
        await updateInboundEmail(db, id, { status: 'needs_review', error: reason });
        return true;
      });
      log('cancelled');
      throw new Halt({ outcome: 'cancelled', run_id });
    }
    await run(`resumed-${name}`, DB, async () => {
      await checkpointRun(db, run_id, acc, { status: 'running' });
      return true;
    });
  };

  /** Re-reads agent.rfq_intake; while it is off the run is parked (flag_off). Returns mode and threshold. */
  const flagGate = async (name: string): Promise<{ mode: 'shadow' | 'assist' | 'auto'; min_confidence: number }> => {
    for (let k = 1; ; k++) {
      const stepName = k === 1 ? `flag-${name}` : `flag-${name}-${k}`;
      const r = await run(stepName, DB, async () => {
        const flag = await readFlag(env, FLAG, tenant);
        return { enabled: flag.enabled, mode: flag.mode, min_confidence: minConfidenceOf(flag.value) };
      });
      if (r.enabled) return { mode: r.mode, min_confidence: r.min_confidence };
      await parkAndWait(stepName, 'flag_off');
    }
  };

  /** One LLM step with the park rules of the header; `after` turns the model value into the step result. */
  const llmStep = async <V, R>(base: string, cfg: WorkflowStepConfig, prompt: PromptId, input: () => Promise<LlmContent[]>, after: (value: V) => Promise<R>): Promise<R> => {
    for (let k = 1; ; k++) {
      const name = k === 1 ? base : `${base}-${k}`;
      let reason: 'budget' | 'llm_unavailable';
      try {
        const res = await run<LlmStepResult<R>>(name, cfg, async () => {
          const loaded = await loadPrompt(prompt);
          const user = await input();
          const r = await ports.llm.call<V>({
            prompt,
            route: loaded.entry.route,
            system: loaded.system,
            user,
            schema: loaded.schema as unknown as JsonSchemaObject,
            maxTokens: loaded.entry.max_tokens,
            meta: { agent: AGENT, run_id, tenant_id: tenant, step: base },
          });
          if (r.ok) return { ok: true, value: await after(r.value), usage: r.usage };
          if (r.code === 'budget') return { ok: false, park: 'budget', usage: r.usage ?? null };
          if (r.retryable) throw new Error(`llm_unavailable: ${r.code}`);
          throw new NonRetryableError(`llm_${r.code}`);
        });
        if (res.usage) acc = addUsage(acc, res.usage, base);
        if (res.ok) return res.value;
        reason = res.park;
      } catch (error) {
        if (!isLlmUnavailable(error)) throw error;
        reason = 'llm_unavailable';
      }
      await parkAndWait(name, reason);
    }
  };

  try {
    await flagGate('start');

    // 1 parse-and-store
    const parsed = await run<ParseResult>('parse-and-store', BLOB, async () => {
      const raw = await ports.blob.get(rawKey(sha));
      if (!raw) throw new NonRetryableError('raw_mime_missing');
      const mail = await parseMime(await new Response(raw.body).arrayBuffer());
      const records = await storeAttachments(ports.blob, sha, mail.attachments);
      const text = stripQuoted(mail.text);
      await ports.blob.put(bodyTextKey(sha), new TextEncoder().encode(text.slice(0, EXTRACT_TEXT_CHARS)).buffer as ArrayBuffer, { contentType: 'text/plain; charset=utf-8' });
      await updateInboundEmail(db, id, { attachments: records, body_excerpt: text.slice(0, 4000), status: 'parsed', error: null }, ['received', 'parsed', 'failed', 'needs_review']);
      const auth = authResultsOf(mail.headers.authentication_results ?? []);
      return { signals: mailSignals(mail, auth, records), attachments: records, text_chars: text.length, from_html: mail.from_html };
    });
    records = parsed.attachments;
    const signals = parsed.signals;

    // 2 triage-rules, 3 triage
    const rules = await run('triage-rules', PURE, async () => triageRules(signals));
    const triage: TriageV1 = rules.kind
      ? { kind: rules.kind, language: 'und', injection_suspected: false, confidence: 1 }
      : await llmStep<TriageV1, TriageV1>('triage', LLM_CLASSIFY, prompts.triage, async () => classifyContent(await emailForModel(), records), async (v) => ({
          kind: v.kind,
          language: strip(v.language, 8) ?? 'und',
          injection_suspected: v.injection_suspected === true,
          confidence: v.confidence,
        }));

    // 3a end-non-rfq
    if (triage.kind === 'spam' || triage.kind === 'auto_reply' || triage.kind === 'other') {
      const kind = triage.kind;
      await run('end-non-rfq', DB, async () => {
        await updateInboundEmail(db, id, { kind, status: kind === 'spam' ? 'spam' : 'rejected', classification: { triage: rules.kind ? 'rules' : 'model', reason: rules.reason, confidence: triage.confidence } });
        await closeRun(db, run_id, { status: 'skipped', output: { kind, reason: rules.kind ? rules.reason : 'model' } }, acc);
        if (kind === 'other') {
          const row = await readRow();
          await sendNotice(ports, notRfqCard({ run_id, site_origin: env.SITE_ORIGIN, inbound_email_id: id, sender_email: row.from_email, language: triage.language, file_kinds: fileKinds(records) }), run_id);
        }
        return true;
      });
      log(kind);
      return { outcome: kind, run_id };
    }

    // 3b hand-to-replies
    if (triage.kind === 'reply') {
      await run('hand-to-replies', DB, async () => {
        need(env, 'AGENT_EVENTS');
        await updateInboundEmail(db, id, { kind: 'reply' });
        await env.AGENT_EVENTS.send({ v: 1, type: 'inbound-reply', inbound_email_id: id, tenant_id: tenant }, { contentType: 'json' });
        await closeRun(db, run_id, { status: 'succeeded', output: { kind: 'reply' } }, acc);
        return true;
      });
      log('reply');
      return { outcome: 'reply', run_id };
    }

    const kind: 'rfq' | 'techpilot' = triage.kind === 'techpilot' ? 'techpilot' : 'rfq';
    const source: 'email' | 'techpilot' = kind === 'techpilot' ? 'techpilot' : 'email';

    // 4 thread-check
    const thread = await run('thread-check', DB, async () => {
      if (!signals.in_reply_to && signals.references === 0 && !signals.rfq_number) return { matched: false as const };
      const row = await readRow();
      const m = await match(db, { message_id: row.message_id, in_reply_to: row.in_reply_to, references: row.references_ids ?? [], subject: row.subject, from_email: row.from_email }, { tenant_id: tenant, rules: [1, 2, 3] });
      if (m.rule === 1 || m.rule === 2 || m.rule === 3) return { matched: true as const, rule: m.rule, rfq_id: m.rfq_id, quote_workflow_id: m.quote_workflow_id };
      return { matched: false as const };
    });

    // 4a attach-to-rfq
    if (thread.matched) {
      const rfqId = thread.rfq_id;
      const attached = await run('attach-to-rfq', DB, async () => {
        need(env, 'RFQ_THREAD');
        const row = await readRow();
        const rfq = await getRfq(db, rfqId);
        await env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(rfqId)).appendInbound(id, row.message_id);
        await updateInboundEmail(db, id, { kind, status: 'attached', rfq_id: rfqId, quote_workflow_id: thread.quote_workflow_id ?? null });
        return { rfq_number: rfq?.rfq_number ?? null };
      });
      const files = await copyFiles(rfqId, source, []);
      const signalsOfText = await run('attach-process', BLOB, async () => processRules(await readBodyText(), fileKinds(records)));
      const jobs = await enqueueCad(rfqId, files, signalsOfText.process ?? 'other', []);
      await run('attach-close', DB, async () => {
        await closeRun(db, run_id, { status: 'succeeded', output: { kind, attached_to: rfqId, rule: thread.rule, files: files.length, cad_jobs: jobs.length } }, acc);
        const row = await readRow();
        await sendNotice(ports, attachedCard({ run_id, site_origin: env.SITE_ORIGIN, inbound_email_id: id, rfq_number: attached.rfq_number, sender_email: row.from_email, files: files.length, cad_jobs: jobs.length }), run_id);
        return true;
      });
      log('attached');
      return { outcome: 'attached', run_id, rfq_id: rfqId };
    }

    // 5 extract
    const gate = await flagGate('extract');
    let unreadable = 0;
    const extract = await llmStep<RfqExtractV1, ExtractSummary>(
      'extract',
      LLM_EXTRACT,
      prompts.extract,
      async () => {
        const input = await extractInput(ports, records, await emailForModel());
        unreadable = input.unreadable;
        return input.user;
      },
      async (value) => {
        const confidence = extractConfidence(value);
        await updateInboundEmail(db, id, { kind, parsed: boundedParsed(value), parse_confidence: confidence });
        return summaryOf(value, confidence, unreadable);
      },
    );

    // 6 classify-process (+ rules), combine-process
    const classified = await llmStep<ClassifyProcessV1, { model: ClassifyProcessV1; rules: ProcessRuleResult }>(
      'classify-process',
      LLM_CLASSIFY,
      prompts.classify,
      async () => classifyContent(await emailForModel(), records),
      async (value) => ({
        model: { process: value.process, confidence: value.confidence, signals: (value.signals ?? []).slice(0, 5).map((s) => String(s).slice(0, 60)) },
        rules: processRules(await readBodyText(), fileKinds(records)),
      }),
    );
    const proc = await run<ProcessDecision>('combine-process', PURE, async () => combineProcess(classified.rules, classified.model));

    // 7 dedupe-customer
    const customer = await run('dedupe-customer', DB, async () => {
      const row = await readRow();
      const x = row.parsed as unknown as RfqExtractV1 | null;
      const contact = contactEmailFor(kind, row.from_email, x?.contact_email?.value ?? null, await readBodyText());
      const c = await customerCandidates(db, tenant, contact, x?.vat_id?.value ?? null);
      await updateInboundEmail(db, id, { classification: { process: proc.process, confidence: proc.confidence, signals: proc.signals, source: proc.source } });
      return { customer_id: c.customer_id, suggestions: c.suggestions.length, sender_masked: row.from_email ? maskEmail(row.from_email) : null };
    });

    // 8 decide
    const decision = await run('decide', PURE, async () => {
      const d8 = decideCard({
        mode: gate.mode,
        confidence: extract.confidence,
        process_confidence: proc.confidence,
        min_confidence: gate.min_confidence,
        dmarc_pass: signals.dmarc_pass,
        injection_suspected: triage.injection_suspected || extract.injection_suspected,
        customer_id: customer.customer_id,
        company: extract.company,
      });
      const card: IntakeCardInput = {
        run_id,
        site_origin: env.SITE_ORIGIN,
        inbound_email_id: id,
        kind,
        company: extract.company,
        country: extract.country,
        language: extract.language ?? triage.language,
        sender_masked: customer.sender_masked,
        parts: partCount({ parts: extract.parts } as unknown as RfqExtractV1, records.filter((r) => CAD_KINDS.has(r.kind) && !r.inline).length),
        file_kinds: fileKinds(records),
        process: proc.process,
        process_confidence: proc.confidence,
        confidence: extract.confidence,
        customer: customer.customer_id ? 'existing' : customer.suggestions > 0 ? 'suggested' : 'new',
        reasons: d8.reasons,
        dmarc_pass: signals.dmarc_pass,
        injection_suspected: triage.injection_suspected || extract.injection_suspected,
        unreadable: extract.unreadable,
      };
      return { needs_card: d8.needs_card, reasons: d8.reasons as CardReason[], card };
    });

    if (gate.mode === 'shadow') {
      await run('shadow-notice', DB, async () => {
        await closeRun(db, run_id, { status: 'succeeded', output: { mode: 'shadow', needs_card: decision.needs_card, reasons: decision.reasons, process: proc.process, confidence: extract.confidence, parts: decision.card.parts } }, acc);
        await sendNotice(ports, shadowCard(decision.card, decision.needs_card), run_id);
        return true;
      });
      log('shadow');
      return { outcome: 'shadow', run_id };
    }

    // 9 request-confirmation, 10 wait-confirmation
    let process: Process = proc.process;
    let confirmedBy: string | null = null;
    if (decision.needs_card) {
      await run('request-confirmation', DB, async () => {
        const { price_missing: _ignored, ...usage } = usageColumns(acc);
        const { telegram_message_id } = await request(env, ports, { run_id, card: intakeCard(decision.card) }, { patch: usage });
        return { telegram_message_id };
      });
      current = 'request-confirmation';
      const waited = await waitWithReminder<DecisionEventPayload>(
        step,
        {
          run_id,
          type: 'intake-confirmed',
          first: CONFIRM_FIRST,
          second: CONFIRM_SECOND,
          card: () => intakeCard(decision.card, { reminder: true }),
          onTimeout: async () => {
            await run('confirmation-timeout', DB, async () => {
              await updateInboundEmail(db, id, { status: 'needs_review' });
              await closeRun(db, run_id, { status: 'cancelled', error: 'confirmation_timeout' }, acc);
              return true;
            });
          },
        },
        { env, ports },
      );
      if ('timedOut' in waited) {
        log('timed_out');
        return { outcome: 'timed_out', run_id };
      }
      const verb = waited.event.verb;
      confirmedBy = typeof waited.event.actor === 'string' ? waited.event.actor : null;
      if (!VERB_PROCESS[verb]) {
        // not_rfq is decided by decide() (the instance is terminated); any other verb ends the run the same way.
        await run('not-rfq', DB, async () => {
          await updateInboundEmail(db, id, { status: 'rejected' });
          await closeRun(db, run_id, { status: 'cancelled', output: { verb: String(verb).slice(0, 40) } }, acc);
          return true;
        });
        log('not_rfq');
        return { outcome: 'not_rfq', run_id };
      }
      process = VERB_PROCESS[verb];
    }

    // 11 create-rfq
    await flagGate('create');
    const cadFiles = records.filter((r) => CAD_KINDS.has(r.kind) && !r.inline);
    const created = await run('create-rfq', DB, async () => {
      const row = await readRow();
      const x = row.parsed as unknown as RfqExtractV1 | null;
      if (!x || !Array.isArray(x.parts)) throw new NonRetryableError('parsed_missing');
      const n = partCount(x, cadFiles.length);
      const partIds: string[] = [];
      for (let i = 0; i < n; i++) partIds.push(await uuidV5(id, `part-${i + 1}`));
      const payload = rfqPayload({
        extract: x,
        process,
        source,
        contact_email: contactEmailFor(kind, row.from_email, x.contact_email?.value ?? null, await readBodyText()),
        company_fallback: companyFallback(kind, row.from_email),
        now: ports.clock.now().toISOString(),
        part_ids: partIds,
        cad_files: cadFiles.map((f) => ({ n: f.n, filename: f.filename })),
      });
      const r = await createEmailRfq(db, id, payload, source);
      return {
        rfq_id: r.rfq_id,
        rfq_number: r.rfq_number,
        customer_id: r.customer_id,
        parts: payload.parts.map((part) => ({ id: part.id, refs: (part.original_values.attachment_refs as number[]) ?? [] })),
        company_fallback: !x.company?.value,
      };
    });

    // 12 copy-files
    const files = await copyFiles(created.rfq_id, source, created.parts);

    // 13 enqueue-cad
    const jobs = await enqueueCad(created.rfq_id, files, process, extract.parts);

    // 14 start-quote
    const quote = await run('start-quote', DB, async () => {
      const flag = await readFlag(env, 'agent.quote', tenant);
      if (!flag.enabled) return { started: false, instance_id: null };
      need(env, 'QUOTE');
      const instance_id = quoteInstanceId(created.rfq_id, 1);
      try {
        await env.QUOTE.create({ id: instance_id, params: { v: 1, rfq_id: created.rfq_id, quote_version: 1, tenant_id: tenant, trigger: 'intake' } });
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      return { started: true, instance_id };
    });

    // 15 notify-and-close
    await run('notify-and-close', DB, async () => {
      await closeRun(
        db,
        run_id,
        {
          status: 'succeeded',
          output: {
            rfq_id: created.rfq_id,
            rfq_number: created.rfq_number,
            process,
            confidence: extract.confidence,
            parts: created.parts.length,
            files: files.length,
            cad_jobs: jobs.length,
            quote_instance_id: quote.instance_id,
            confirmed: decision.needs_card,
            confirmed_by: confirmedBy,
            company_fallback: created.company_fallback,
          },
        },
        acc,
      );
      await sendNotice(
        ports,
        createdCard({ run_id, site_origin: env.SITE_ORIGIN, rfq_id: created.rfq_id, rfq_number: created.rfq_number, company: extract.company, country: extract.country, parts: created.parts.length, files: files.length, cad_jobs: jobs.length, quote_started: quote.started }),
        run_id,
      );
      return true;
    });
    log('rfq_created');
    return { outcome: 'rfq_created', run_id, rfq_id: created.rfq_id };
  } catch (error) {
    if (error instanceof Halt) return error.result;
    const failedStep = current;
    const code = errorCode(error);
    await step.do('fail-run', DB, async () => {
      await failRun(env, ports, run_id, { error: code, failed_step: failedStep, restartable: true }, acc);
      await updateInboundEmail(db, id, { status: 'failed', error: code });
      return true;
    });
    log('failed');
    return { outcome: 'failed', run_id, failed_step: failedStep };
  }

  // ----- steps shared by the new-RFQ and the follow-up paths -----

  /** copy-file-<n> per RFQ file kind, then insert-files: rfq_files rows (one per sha256). */
  async function copyFiles(rfqId: string, src: 'email' | 'techpilot', parts: ReadonlyArray<{ id: string; refs: number[] }>): Promise<CopiedFile[]> {
    const wanted = records.filter((r) => RFQ_FILE_KINDS.has(r.kind) && !r.inline);
    const rows: RfqFileRow[] = [];
    for (const r of wanted) {
      const partId = parts.find((pt) => pt.refs.includes(r.n))?.id ?? null;
      const row = await agentFileRow({ rfq_id: rfqId, name: r.filename, sha256: r.sha256, size_bytes: r.size_bytes, content_type: r.content_type, source: src, part_id: partId, tenant_id: tenant });
      rows.push(row);
      await run(`copy-file-${r.n}`, BLOB, async () => {
        const target = row.r2_key as string;
        if (!(await ports.blob.head(target))) await ports.blob.copy(r.r2_key, target);
        return true;
      });
    }
    if (rows.length === 0) return [];
    return run('insert-files', DB, async () => {
      const stored = await insertAgentFiles(db, rfqId, rows);
      const bySha = new Map(stored.map((s) => [s.sha256, s]));
      const out: CopiedFile[] = [];
      for (const r of wanted) {
        const s = bySha.get(r.sha256);
        if (!s || out.some((o) => o.id === s.id)) continue;
        out.push({ id: s.id, n: r.n, kind: r.kind, r2_key: s.r2_key as string, sha256: r.sha256, size_bytes: r.size_bytes, content_type: r.content_type, file_name: s.file_name });
      }
      return out;
    });
  }

  /** enqueue-cad: one analyse job per CAD file, then RfqThread.expectCadJobs (also with no job, so cad-done fires). */
  async function enqueueCad(rfqId: string, files: readonly CopiedFile[], process: Process, parts: ExtractSummary['parts']): Promise<string[]> {
    const result = await run('enqueue-cad', DB, async () => {
      need(env, 'RFQ_THREAD');
      const ids: string[] = [];
      for (const f of files.filter((x) => CAD_KINDS.has(x.kind))) {
        const part = parts.find((pt) => pt.refs.includes(f.n)) ?? (parts.length === 1 ? parts[0] : undefined);
        const r = await enqueueCadJob(env, db, {
          tenant_id: tenant,
          rfq_id: rfqId,
          rfq_file_id: f.id,
          quote_workflow_id: null,
          job_type: 'analyse',
          input: { r2_key: f.r2_key, sha256: f.sha256, content_type: f.content_type, size_bytes: f.size_bytes, file_name: f.file_name },
          params: { material: cadMaterial(part?.material ?? null), thickness_override: part?.thickness_mm ?? 0, k_factor_override: 0, drawing_size: 'A4', process },
          requested_by_run_id: run_id,
        });
        ids.push(r.job_id);
      }
      await env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(rfqId)).expectCadJobs(ids);
      return { job_ids: ids };
    });
    return result.job_ids;
  }
}

interface CopiedFile {
  id: string;
  n: number;
  kind: AttachmentRecord['kind'];
  r2_key: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  file_name: string;
}

/** A material name as a CAD job parameter (letters, digits and ._+-/() only), else '' (the backend default). */
export function cadMaterial(material: string | null): string {
  const value = String(material ?? '').trim();
  return /^[A-Za-z0-9 ._+\-/()]{1,60}$/.test(value) ? value : '';
}

/** inbound_emails.parsed: the extract as returned, replaced by a marker above 32 KB. */
function boundedParsed(value: RfqExtractV1): Record<string, unknown> {
  const json = JSON.stringify(value);
  return json.length <= 32_768 ? (value as unknown as Record<string, unknown>) : { truncated: true, bytes: json.length };
}

function summaryOf(x: RfqExtractV1, confidence: number, unreadable: number): ExtractSummary {
  const country = typeof x.country?.value === 'string' && /^[A-Za-z]{2}$/.test(x.country.value.trim()) ? x.country.value.trim().toUpperCase() : null;
  return {
    company: strip(x.company?.value ?? null, 120),
    country,
    language: strip(x.language, 8),
    confidence,
    injection_suspected: x.injection_suspected === true,
    parts: (x.parts ?? []).slice(0, 100).map((p) => ({
      refs: (p.attachment_refs ?? []).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 50),
      material: strip(p.material?.value ?? null, 60),
      thickness_mm: typeof p.thickness_mm?.value === 'number' && Number.isFinite(p.thickness_mm.value) && p.thickness_mm.value > 0 ? p.thickness_mm.value : null,
      process_hint: p.process_hint,
    })),
    unreadable,
  };
}

/** A notice card without buttons; a Telegram failure is logged and ignored (the dashboard lists the run). */
async function sendNotice(ports: Ports, card: Parameters<Ports['telegram']['sendCard']>[0], runId: string): Promise<void> {
  try {
    await ports.telegram.sendCard(card, null);
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'card send failed', { run_id: runId, kind: card.kind }));
  }
}

/**
 * User content of the extract call: one PDF (the first readable one, trimmed to 5 pages) and up to 3 PNG/JPEG
 * images of at most 3.75 MB as base64, within a 20 MB request; unreadable = PDFs that do not load or are encrypted
 * plus archives with entries or problems that were not extracted.
 */
export async function extractInput(
  ports: Pick<Ports, 'blob'>,
  records: readonly AttachmentRecord[],
  email: EmailForModel,
): Promise<{ user: LlmContent[]; unreadable: number }> {
  let unreadable = records.filter((r) => (r.skipped_entries ?? 0) > 0 || (r.flags ?? []).some((f) => f.startsWith('zip_') && !f.startsWith('zip_entry_'))).length;
  let pdf: DocumentForModel | null = null;
  const images: ImageForModel[] = [];
  let budget = MAX_REQUEST_BYTES - (email.text.length + 8192);
  const readBytes = async (key: string): Promise<Uint8Array | null> => {
    const object = await ports.blob.get(key);
    return object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
  };
  for (const r of records) {
    if (r.inline) continue;
    if (r.kind === 'pdf') {
      if (pdf) continue;
      const bytes = await readBytes(r.r2_key);
      const trimmed = bytes ? await trimPdf(bytes) : null;
      if (!trimmed || !trimmed.ok) {
        unreadable++;
        continue;
      }
      const base64 = bytesToBase64(trimmed.bytes);
      if (base64.length > budget) continue;
      budget -= base64.length;
      pdf = { n: r.n, name: r.filename, base64, note: trimmed.truncated ? `pages 1-${trimmed.pages} of ${trimmed.total_pages}` : `${trimmed.pages} page${trimmed.pages === 1 ? '' : 's'}` };
    } else if (r.kind === 'image' && images.length < MAX_IMAGES && (r.content_type === 'image/png' || r.content_type === 'image/jpeg')) {
      if (Math.ceil(r.size_bytes / 3) * 4 > MAX_IMAGE_BASE64) continue;
      const bytes = await readBytes(r.r2_key);
      if (!bytes) continue;
      const base64 = bytesToBase64(bytes);
      if (base64.length > budget) continue;
      budget -= base64.length;
      images.push({ n: r.n, name: r.filename, mediaType: r.content_type, base64 });
    }
  }
  return { user: extractContent(email, records, pdf, images), unreadable };
}

export type { InboundKind };
