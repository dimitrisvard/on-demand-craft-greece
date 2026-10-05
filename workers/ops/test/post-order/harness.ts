// T1 harness of the post-order Workflow: MemoryDb seeded with an order of a quoted RFQ (synthetic data, example.*
// addresses), the real MaterialStock over a fake Durable Object state, a scripted LLM (answers by prompt, served
// through the production SDK adapter by FakeLlm), and DecidingStep: a FakeStep whose waits run the real decide()
// first (dashboard channel), so approvals go through the claim RPC.

import type { WorkflowStepEvent, WorkflowTimeoutDuration } from 'cloudflare:workers';
import { decide, type DecideInput } from '../../src/agents/decision';
import { MaterialStock } from '../../src/do/material-stock';
import type { OpsEnv } from '../../src/env';
import type { LlmCall, LlmFailure, LlmPort, LlmResult } from '../../src/ports/index';
import { runPostOrder, type PostOrderParams, type PostOrderResult } from '../../src/workflows/post-order';
import { agentBindings, agentPorts, FakeKV, FakeR2Bucket, FakeWorkflow, type AgentTestPorts } from '../helpers/agent-env';
import { fakeNamespace } from '../helpers/fake-do';
import { FakeStep } from '../helpers/fake-step';
import { opsEnv } from '../helpers/ops';

import { INSTANCE, ORDER, STAFF, TENANT, seedRows, type SeedOptions } from './seed-data';

export * from './seed-data';
export const PARAMS: PostOrderParams = { v: 1, order_id: ORDER, tenant_id: TENANT, source: 'portal' };

export const NOTES_ANSWER = { language: 'de', notes: ['Alle Kanten entgraten.', 'Pulverbeschichtung erst nach dem Biegen.'], qa_checks: ['Biegewinkel von Teil 1 gegen die Zeichnung prüfen.'], injection_suspected: false };
export const REORDER_ANSWER = { subject: 'Request: S235JR 2 mm sheet', body_text: 'Hello,\n\nplease send us your offer and delivery time for S235JR 2 mm sheet (article S235-2-1000), 0.05 m2.\n\nKind regards\nMicrons Hub' };

/** Answers by prompt id (each call is registered in FakeLlm with its exact content, then served by it). */
export class ScriptedLlm implements LlmPort {
  readonly answers = new Map<string, Array<Record<string, unknown> | { status: number; body: Record<string, unknown> }>>();
  readonly users: Array<{ prompt: string; user: LlmCall['user'] }> = [];
  constructor(readonly inner: AgentTestPorts['llm']) {}

  answer(prompt: string, ...values: Array<Record<string, unknown> | { status: number; body: Record<string, unknown> }>): this {
    this.answers.set(prompt, values);
    return this;
  }

  async call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    this.users.push({ prompt: c.prompt, user: c.user });
    const queue = this.answers.get(c.prompt) ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next) {
      const isError = 'status' in next && 'body' in next && typeof next.status === 'number';
      const response = isError ? (next as { body: Record<string, unknown> }).body : messageOf(next);
      await this.inner.add(c.prompt, c.user, response, isError ? (next as { status: number }).status : 200);
    }
    return this.inner.call(c);
  }
}

export function messageOf(value: unknown): Record<string, unknown> {
  return {
    id: 'msg_post_order_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 700, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

export interface Harness {
  env: OpsEnv;
  ports: AgentTestPorts;
  llm: ScriptedLlm;
  kv: FakeKV;
  bucket: FakeR2Bucket;
  workflow: FakeWorkflow;
}

export function seed(h: Harness, o: SeedOptions = {}): void {
  const { tables, objects } = seedRows(o);
  for (const [table, rows] of Object.entries(tables)) h.ports.db.seed(table, rows);
  for (const [key, text] of Object.entries(objects)) void h.bucket.put(key, text);
}

export function harness(o: SeedOptions & { flag?: Record<string, unknown> | null; approvalSecret?: boolean } = {}): Harness {
  const bucket = new FakeR2Bucket();
  const ports = agentPorts({ bucket });
  const env = opsEnv({ ...agentBindings({ PRIVATE_FILES: bucket as unknown as R2Bucket }), ...(o.approvalSecret === false ? {} : { AGENT_APPROVAL_SECRET: 't1-approval-value' }) }) as OpsEnv;
  env.MATERIAL_STOCK = fakeNamespace((state) => {
    const s = new MaterialStock(state as unknown as DurableObjectState, env);
    (s as unknown as { dbInstance: unknown }).dbInstance = ports.db;
    (s as unknown as { clock: () => Date }).clock = () => ports.clock.now();
    return s;
  }) as unknown as OpsEnv['MATERIAL_STOCK'];
  const kv = env.FLAGS as unknown as FakeKV;
  if (o.flag !== null) kv.setJson('agent.post_order', o.flag ?? { enabled: true, value: { mode: 'assist' }, rev: 1 });
  const llm = new ScriptedLlm(ports.llm);
  llm.answer('post_order.traveller_notes@v1', NOTES_ANSWER).answer('post_order.reorder_draft@v1', REORDER_ANSWER);
  ports.llm = llm as unknown as AgentTestPorts['llm'];
  const h: Harness = { env, ports, llm, kv, bucket, workflow: env.POST_ORDER as unknown as FakeWorkflow };
  seed(h, o);
  return h;
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

/** decide() on the waiting card through the dashboard, then the event the Workflow would receive is buffered. */
export async function decideAndDeliver(h: Harness, step: FakeStep, verb: string): Promise<Awaited<ReturnType<typeof decide>>> {
  const row = h.ports.db.rows('agent_runs', ['status', 'eq', 'waiting_human']).filter((r) => r.approval_token_sha256).at(-1);
  if (!row) throw new Error('no waiting card');
  const instance = h.workflow.ensure(INSTANCE);
  const before = instance.calls.length;
  const input: DecideInput = { channel: 'dashboard', actor: STAFF, run_id: String(row.id), token_sha256: String(row.approval_token_sha256), verb };
  const result = await decide(h.env, h.ports, input);
  for (const call of instance.calls.slice(before)) {
    if (call.method === 'sendEvent') {
      const e = call.args as { type: string; payload: unknown };
      step.sendEvent(e.type, e.payload);
    }
  }
  return result;
}

export async function runCase(h: Harness, o: { step?: FakeStep; decisions?: Record<string, string[]>; params?: PostOrderParams; before?: Record<string, (h: Harness) => void> } = {}): Promise<{ result: PostOrderResult; step: FakeStep }> {
  const step = o.step ?? new DecidingStep();
  if (step instanceof DecidingStep && o.decisions) {
    const queues = Object.fromEntries(Object.entries(o.decisions).map(([k, v]) => [k, [...v]]));
    step.hook = async (type) => {
      const verb = queues[type]?.shift();
      if (!verb) return;
      o.before?.[`${type}:${verb}`]?.(h);
      const r = await decideAndDeliver(h, step, verb);
      if (!r.ok) throw new Error(`decide failed: ${r.error}`);
    };
  }
  const result = await runPostOrder(o.params ?? PARAMS, INSTANCE, { env: h.env, ports: h.ports, step });
  return { result, step };
}

/** Every e-mail-address-shaped string in a JSON value. */
export function addressesIn(value: unknown): string[] {
  return JSON.stringify(value ?? null).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? [];
}

export const runOf = (h: Harness) => h.ports.db.rows('agent_runs', ['agent', 'eq', 'post_order'], ['idempotency_key', 'eq', ORDER])[0];
