// T1 harness of the quote Workflow: MemoryDb seeded with test/quote/seed.ts, the fakes of test/helpers, a scripted
// LLM (answers by prompt, served through the production SDK adapter by FakeLlm), and DecidingStep: a FakeStep whose
// waits can run the real decide() first (dashboard or Telegram channel), so approvals go through the claim RPC.

import type { WorkflowStepEvent, WorkflowTimeoutDuration } from 'cloudflare:workers';
import { decide, type DecideInput } from '../../src/agents/decision';
import type { OpsEnv } from '../../src/env';
import type { LlmCall, LlmFailure, LlmPort, LlmResult } from '../../src/ports/index';
import { runQuote, type QuoteParams, type QuoteResult } from '../../src/workflows/quote';
import { agentBindings, agentPorts, FakeKV, FakeR2Bucket, FakeWorkflow, type AgentTestPorts } from '../helpers/agent-env';
import { FakeStep } from '../helpers/fake-step';
import { opsEnv } from '../helpers/ops';
import { COVER_ANSWER, NOTES_ANSWER, QWID, RFQ_ID, replyMime, seedRows, TENANT, type SeedOptions } from './seed';

export const STAFF = 'user:11111111-1111-4111-8111-111111111111';
export const INSTANCE = `quote-${RFQ_ID}-v1`;
export const PARAMS: QuoteParams = { v: 1, rfq_id: RFQ_ID, quote_version: 1, tenant_id: TENANT, trigger: 'dashboard' };

/** Answers by prompt id (each call is registered in FakeLlm with its exact content, then served by it). */
export class ScriptedLlm implements LlmPort {
  readonly inner: AgentTestPorts['llm'];
  readonly answers = new Map<string, Array<Record<string, unknown> | { status: number; body: Record<string, unknown> }>>();
  readonly users: Array<{ prompt: string; user: LlmCall['user'] }> = [];

  constructor(inner: AgentTestPorts['llm']) {
    this.inner = inner;
  }

  /** Queues answers for a prompt (the last one repeats). */
  answer(prompt: string, ...values: Array<Record<string, unknown> | { status: number; body: Record<string, unknown> }>): this {
    this.answers.set(prompt, values);
    return this;
  }

  get calls() {
    return this.inner.calls;
  }

  async call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    this.users.push({ prompt: c.prompt, user: c.user });
    const queue = this.answers.get(c.prompt) ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next) {
      const isError = 'status' in next && 'body' in next && typeof next.status === 'number';
      const response = isError ? (next as { body: Record<string, unknown> }).body : messageOf(c.route === 'extract' ? 'claude-sonnet-5-5' : 'claude-haiku-4-5', next);
      await this.inner.add(c.prompt, c.user, response, isError ? (next as { status: number }).status : 200);
    }
    return this.inner.call(c);
  }
}

/** A Messages API response with a JSON text block. */
export function messageOf(model: string, value: unknown, stop = 'end_turn'): Record<string, unknown> {
  return {
    id: 'msg_quote_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

export interface QuoteHarness {
  env: OpsEnv;
  ports: AgentTestPorts;
  llm: ScriptedLlm;
  kv: FakeKV;
  bucket: FakeR2Bucket;
  workflow: FakeWorkflow;
}

export function harness(o: SeedOptions & { flag?: Record<string, unknown> | null; approvalSecret?: boolean } = {}): QuoteHarness {
  const bucket = new FakeR2Bucket();
  const env = opsEnv({ ...agentBindings({ PRIVATE_FILES: bucket as unknown as R2Bucket }), ...(o.approvalSecret === false ? {} : { AGENT_APPROVAL_SECRET: 't1-approval-value' }) }) as OpsEnv;
  const kv = env.FLAGS as unknown as FakeKV;
  if (o.flag !== null) kv.setJson('agent.quote', o.flag ?? { enabled: true, value: { mode: 'assist' }, rev: 1 });
  const ports = agentPorts({ bucket });
  const rows = seedRows(o);
  for (const [table, list] of Object.entries(rows)) ports.db.seed(table, list);
  const llm = new ScriptedLlm(ports.llm);
  llm.answer('quote.price_notes@v1', NOTES_ANSWER).answer('quote.cover_email@v1', COVER_ANSWER);
  ports.llm = llm as unknown as AgentTestPorts['llm'];
  return { env, ports, llm, kv, bucket, workflow: env.QUOTE as unknown as FakeWorkflow };
}

/** Stores a customer reply as microns-mail does and returns its inbound_emails id. */
export async function seedReply(h: QuoteHarness, o: { subject: string; text: string; n?: number }): Promise<string> {
  const n = o.n ?? 1;
  const sha = String(n).padStart(2, '0').repeat(32);
  const key = `email/${sha}/raw.eml`;
  await h.bucket.put(key, replyMime({ subject: o.subject, text: o.text, messageId: `<reply-${n}@example.de>` }));
  const [row] = await h.ports.db.insert<{ id: string }>(
    'inbound_emails',
    {
      tenant_id: TENANT,
      message_id: `<reply-${n}@example.de>`,
      message_id_sha256: sha,
      mailbox: 'replies',
      source: 'email_routing',
      from_email: 'erika.beispiel@example.de',
      subject: o.subject,
      in_reply_to: `<q.${QWID}.0@rfq.micronshub.eu>`,
      received_at: '2026-10-07T08:00:00.000Z',
      raw_r2_key: key,
      status: 'matched',
      rfq_id: RFQ_ID,
    },
    { returning: 'id' },
  );
  return row.id;
}

type Hook = (type: string, name: string) => Promise<void>;

/** FakeStep whose waitForEvent first awaits a hook (which may decide a card and buffer the resulting event). */
export class DecidingStep extends FakeStep {
  hook?: Hook;

  override async waitForEvent<T>(name: string, options: { type: string; timeout?: WorkflowTimeoutDuration | number }): Promise<WorkflowStepEvent<T>> {
    if (this.hook) await this.hook(options.type, name);
    return super.waitForEvent<T>(name, options);
  }
}

/** The token hash of the waiting run (as the dashboard reads it). */
export function waitingHash(h: QuoteHarness, runId?: string): { run_id: string; token_sha256: string } | null {
  const rows = h.ports.db.rows('agent_runs', ['status', 'eq', 'waiting_human']).filter((r) => r.approval_token_sha256 && (!runId || r.id === runId));
  const row = rows[rows.length - 1];
  return row ? { run_id: String(row.id), token_sha256: String(row.approval_token_sha256) } : null;
}

/** decide() on the waiting card through the dashboard, then the event the Workflow would receive is buffered. */
export async function decideAndDeliver(h: QuoteHarness, step: FakeStep, i: Omit<DecideInput, 'channel' | 'actor' | 'token_sha256' | 'run_id'> & { actor?: string }): Promise<Awaited<ReturnType<typeof decide>>> {
  const waiting = waitingHash(h);
  if (!waiting) throw new Error('no waiting card');
  const before = h.workflow.instances.get(INSTANCE)?.calls.length ?? 0;
  h.workflow.ensure(INSTANCE);
  const result = await decide(h.env, h.ports, { channel: 'dashboard', actor: i.actor ?? STAFF, run_id: waiting.run_id, token_sha256: waiting.token_sha256, verb: i.verb, edits: i.edits, note: i.note });
  for (const call of (h.workflow.instances.get(INSTANCE)?.calls ?? []).slice(before)) {
    if (call.method === 'sendEvent') {
      const e = call.args as { type: string; payload: unknown };
      step.sendEvent(e.type, e.payload);
    }
  }
  return result;
}

export interface RunOptions {
  step?: FakeStep;
  /** Event payloads buffered before the run, by type (in order). */
  events?: Array<{ type: string; payload: unknown }>;
  /** Decisions taken at the waits: type -> verb (and edits), applied through decide() when the wait starts. */
  decisions?: Record<string, Array<Omit<DecideInput, 'channel' | 'actor' | 'token_sha256' | 'run_id'> & { actor?: string }>>;
  params?: QuoteParams;
}

export async function runCase(h: QuoteHarness, o: RunOptions = {}): Promise<{ result: QuoteResult; step: FakeStep }> {
  const step = o.step ?? new DecidingStep();
  for (const e of o.events ?? []) step.sendEvent(e.type, e.payload);
  if (step instanceof DecidingStep && o.decisions) {
    const queues = Object.fromEntries(Object.entries(o.decisions).map(([k, v]) => [k, [...v]]));
    step.hook = async (type) => {
      const next = queues[type]?.shift();
      if (next) {
        const r = await decideAndDeliver(h, step, next);
        if (!r.ok) throw new Error(`decide failed: ${r.error}`);
      }
    };
  }
  const result = await runQuote(o.params ?? PARAMS, INSTANCE, { env: h.env, ports: h.ports, step });
  return { result, step };
}

/** Every e-mail-address-shaped string in a JSON value. */
export function addressesIn(value: unknown): string[] {
  return JSON.stringify(value ?? null).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? [];
}
