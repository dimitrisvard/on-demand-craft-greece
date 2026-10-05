// K-2 decide(): both bodies (relay token + code, dashboard hash + verb), a hash from the relay channel, verb not
// allowed, double claim -> already_decided, run_id mismatch, every outcome kind (event_sent, terminated, restarted,
// dismissed), edits validation, the failure card (rty -> restart from the failed step once, dis -> failed,
// restart error -> restart_failed), cards edited for every channel, and no token or hash in any log line.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../src/agents/approval';
import type { CardV1 } from '../../src/agents/cards/index';
import { testCard } from '../../src/agents/cards/test';
import { decide, type DecideInput } from '../../src/agents/decision';
import { sha256hex } from '../../src/agents/ids';
import { EMPTY_USAGE, addUsage, failRun, openRun } from '../../src/agents/runs';
import type { OpsEnv } from '../../src/env';
import { FakeQueue, FakeWorkflow, agentBindings, agentPorts, type AgentTestPorts } from '../helpers/agent-env';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';
import { opsEnv } from '../helpers/ops';

const RFQ = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const MAIL = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const UID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const QUOTE_INSTANCE = `quote-${RFQ}-v1`;
const INTAKE_INSTANCE = `rfq-intake-${'c'.repeat(32)}`;

let env: OpsEnv;
let ports: AgentTestPorts;
let logger: RecordingLogger;
let restore: () => void;
const secrets: string[] = [];

beforeEach(() => {
  env = opsEnv({ ...agentBindings(), AGENT_APPROVAL_SECRET: 'approval-test-value' });
  ports = agentPorts();
  logger = new RecordingLogger();
  restore = logger.start();
  secrets.length = 0;
});

afterEach(() => {
  restore();
  assertNoSecretsLogged(logger.lines, secrets);
});

function card(kind: CardV1['kind'], allowed: string[], runId: string): CardV1 {
  return { v: 1, kind, run_id: runId, title: `${kind} card`, lines: [{ label: 'RFQ', value: 'RFQ-20261005-1' }], flags: [], allowed_verbs: allowed, open_url: `${env.SITE_ORIGIN}/dashboard/approvals?run=${runId}` };
}

/** A waiting run with a card; returns its id, raw token and token hash. */
async function waiting(o: { kind: CardV1['kind']; allowed: string[]; instance?: string; key?: string; subject?: { type: string; id: string }; output?: Record<string, unknown> }) {
  const run = await openRun(ports.db, {
    agent: o.kind === 'quote' ? 'quote' : 'rfq_intake',
    trigger: 'workflow',
    idempotency_key: o.key ?? `${o.kind}-${Math.random()}`,
    ...(o.instance ? { workflow_name: 'wf', workflow_instance_id: o.instance } : {}),
    ...(o.subject ? { subject_type: o.subject.type, subject_id: o.subject.id } : {}),
  });
  const { token } = await request(env, ports, { run_id: run.run_id, card: card(o.kind, o.allowed, run.run_id) }, { output: o.output });
  const hash = await sha256hex(token);
  secrets.push(token, hash);
  return { runId: run.run_id, token, hash };
}

const relay = (token: string, code: string): DecideInput => ({ channel: 'telegram', actor: 'telegram:4242', token, code });
const dash = (runId: string, hash: string, verb: string, extra: Partial<DecideInput> = {}): DecideInput => ({ channel: 'dashboard', actor: `user:${UID}`, run_id: runId, token_sha256: hash, verb, ...extra });
const runRow = (id: string) => ports.db.rows('agent_runs', ['id', 'eq', id])[0];

describe('input rules', () => {
  it('a hash is accepted only from dashboard and mcp; a raw token only from the relay', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    expect(await decide(env, ports, { channel: 'telegram', actor: 'telegram:1', token_sha256: w.hash, code: 'dis' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, { channel: 'dashboard', actor: `user:${UID}`, token: w.token, verb: 'dismiss' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, { channel: 'dashboard', actor: `user:${UID}`, token: w.token, token_sha256: w.hash, verb: 'dismiss' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, { ...dash(w.runId, w.hash, 'dismiss'), actor: 'someone@example.com' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, { ...relay(w.token, 'dis'), verb: 'dismiss' })).toEqual({ ok: false, error: 'bad_request' });
    expect(runRow(w.runId).status).toBe('waiting_human');
  });

  it('unknown hash -> already_decided; run_id of another run -> not_found', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    expect(await decide(env, ports, dash(w.runId, 'f'.repeat(64), 'dismiss'))).toEqual({ ok: false, error: 'already_decided' });
    expect(await decide(env, ports, dash('9a9b9c9d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', w.hash, 'dismiss'))).toEqual({ ok: false, error: 'not_found' });
  });

  it('verb outside output.allowed_verbs or unknown code -> verb_not_allowed, before any claim', async () => {
    const w = await waiting({ kind: 'quote', allowed: ['approve'], instance: QUOTE_INSTANCE });
    expect(await decide(env, ports, dash(w.runId, w.hash, 'reject'))).toEqual({ ok: false, error: 'verb_not_allowed' });
    expect(await decide(env, ports, relay(w.token, 'rej'))).toEqual({ ok: false, error: 'verb_not_allowed' });
    expect(await decide(env, ports, relay(w.token, 'csm'))).toEqual({ ok: false, error: 'verb_not_allowed' });
    expect(ports.db.calls.filter((c) => c.target === 'agent_run_claim_approval')).toHaveLength(0);
  });

  it('a second decision on the same token -> already_decided', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    expect((await decide(env, ports, relay(w.token, 'dis'))).ok).toBe(true);
    expect(await decide(env, ports, relay(w.token, 'dis'))).toEqual({ ok: false, error: 'already_decided' });
    expect(await decide(env, ports, dash(w.runId, w.hash, 'dismiss'))).toEqual({ ok: false, error: 'already_decided' });
  });

  it('a decision that loses the claim to a concurrent one (loaded while still waiting) -> already_decided, no act, no card edit', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    const rpc = ports.db.rpc.bind(ports.db);
    let raced = false;
    // The competing decision claims the token between this decision's load (step 2) and its claim (step 4).
    ports.db.rpc = (async (name: string, args: Record<string, unknown>) => {
      if (name === 'agent_run_claim_approval' && !raced) {
        raced = true;
        await rpc(name, { ...args, p_human_action: { channel: 'dashboard', actor: `user:${UID}`, verb: 'dismiss' } });
      }
      return rpc(name, args);
    }) as typeof ports.db.rpc;
    expect(await decide(env, ports, relay(w.token, 'dis'))).toEqual({ ok: false, error: 'already_decided' });
    expect(raced).toBe(true);
    expect(runRow(w.runId)).toMatchObject({ status: 'running', human_action: { actor: `user:${UID}` } });
    expect(ports.telegram.edits).toHaveLength(0);
  });
});

describe('outcomes', () => {
  it('test card + relay dis -> run succeeded, dismissed, card edited without buttons', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    const result = await decide(env, ports, relay(w.token, 'dis'));
    expect(result).toEqual({ ok: true, result: { v: 1, ok: true, run_id: w.runId, verb: 'dismiss', outcome: 'dismissed', label: 'Dismissed' } });
    expect(runRow(w.runId)).toMatchObject({ status: 'succeeded', approval_token_sha256: null, human_action: { channel: 'telegram', actor: 'telegram:4242', verb: 'dismiss' } });
    expect(ports.telegram.edits).toHaveLength(1);
    const edited = ports.telegram.edits[0].card as CardV1;
    expect(edited.allowed_verbs).toEqual([]);
    expect(edited.lines.at(-1)).toEqual({ label: 'Decision', value: expect.stringMatching(/^Dismissed by telegram:4242 at 2026-10-05 09:00 UTC$/) });
  });

  it('intake confirm by relay code -> intake-confirmed event with verb, actor and channel', async () => {
    const workflow = env.RFQ_INTAKE as unknown as FakeWorkflow;
    const instance = workflow.ensure(INTAKE_INSTANCE);
    const w = await waiting({ kind: 'intake', allowed: ['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq'], instance: INTAKE_INSTANCE });
    const result = await decide(env, ports, relay(w.token, 'csm'));
    expect(result).toMatchObject({ ok: true, result: { outcome: 'event_sent', verb: 'confirm_sheet_metal', label: 'Confirmed: sheet metal' } });
    expect(instance.calls).toEqual([{ method: 'sendEvent', args: { type: 'intake-confirmed', payload: { verb: 'confirm_sheet_metal', actor: 'telegram:4242', channel: 'telegram' } } }]);
    expect(runRow(w.runId)).toMatchObject({ status: 'running', parked_reason: null, approval_token_sha256: null });
  });

  it('quote approve with edits (dashboard) -> quote-approved with overrides, shipping, drafts and note', async () => {
    const instance = (env.QUOTE as unknown as FakeWorkflow).ensure(QUOTE_INSTANCE);
    const w = await waiting({ kind: 'quote', allowed: ['approve', 'reject'], instance: QUOTE_INSTANCE, output: { line_count: 2 } });
    const edits = { overrides: [{ line_no: 2, unit_price: 12.5, note: 'agreed' }], shipping: 30, drafts: { subject: 'Quotation RFQ-20261005-1', body_text: 'Dear customer' } };
    const result = await decide(env, ports, dash(w.runId, w.hash, 'approve', { edits, note: 'ok to send' }));
    expect(result).toMatchObject({ ok: true, result: { outcome: 'event_sent', label: 'Approved' } });
    expect(instance.calls[0]).toEqual({ method: 'sendEvent', args: { type: 'quote-approved', payload: { verb: 'approve', actor: `user:${UID}`, channel: 'dashboard', note: 'ok to send', ...edits } } });
    expect(runRow(w.runId).human_action).toMatchObject({ channel: 'dashboard', actor: `user:${UID}`, verb: 'approve', note: 'ok to send', decided_at: expect.any(String) });
  });

  it('edits: only quote + approve + dashboard, within the limits', async () => {
    (env.QUOTE as unknown as FakeWorkflow).ensure(QUOTE_INSTANCE);
    const w = await waiting({ kind: 'quote', allowed: ['approve', 'reject'], instance: QUOTE_INSTANCE, output: { line_count: 2 } });
    const bad = [
      { overrides: [{ line_no: 3, unit_price: 1 }] },
      { overrides: [{ line_no: 1, unit_price: 1 }, { line_no: 1, unit_price: 2 }] },
      { overrides: [{ line_no: 1, unit_price: 10_000_001 }] },
      { overrides: [{ line_no: 1, unit_price: -1 }] },
      { shipping: -5 },
      { drafts: { body_text: 'Hello <script>x</script>' } },
      { drafts: { subject: 'x'.repeat(201) } },
      { overrides: [{ line_no: 1, unit_price: 1, note: 'n'.repeat(501) }] },
    ];
    for (const edits of bad) expect(await decide(env, ports, dash(w.runId, w.hash, 'approve', { edits }))).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, dash(w.runId, w.hash, 'reject', { edits: { shipping: 1 } }))).toEqual({ ok: false, error: 'bad_request' });
    expect(await decide(env, ports, { ...dash(w.runId, w.hash, 'approve', { edits: { shipping: 1 } }), channel: 'mcp' })).toEqual({ ok: false, error: 'bad_request' });
    const other = await waiting({ kind: 'reply', allowed: ['won'], instance: QUOTE_INSTANCE });
    expect(await decide(env, ports, dash(other.runId, other.hash, 'won', { edits: { shipping: 1 } }))).toEqual({ ok: false, error: 'bad_request' });
    expect(runRow(w.runId).status).toBe('waiting_human');
  });

  it('intake not_rfq -> inbound e-mail rejected, instance terminated, run cancelled (terminated)', async () => {
    const instance = (env.RFQ_INTAKE as unknown as FakeWorkflow).ensure(INTAKE_INSTANCE);
    ports.db.seed('inbound_emails', [{ id: MAIL, message_id: '<m@example.com>', message_id_sha256: 'c'.repeat(64), mailbox: 'rfq', from_email: 'buyer@example.de', received_at: '2026-10-05T08:00:00Z', status: 'parsed' }]);
    secrets.push('buyer@example.de');
    const w = await waiting({ kind: 'intake', allowed: ['confirm_cnc', 'not_rfq'], instance: INTAKE_INSTANCE, subject: { type: 'inbound_email', id: MAIL } });
    const result = await decide(env, ports, relay(w.token, 'nrfq'));
    expect(result).toMatchObject({ ok: true, result: { outcome: 'terminated', verb: 'not_rfq' } });
    expect(ports.db.rows('inbound_emails')[0].status).toBe('rejected');
    expect(instance.calls).toEqual([{ method: 'terminate' }]);
    expect(runRow(w.runId)).toMatchObject({ status: 'cancelled', finished_at: expect.any(String) });
  });

  it('quote reject -> quote_workflows row rejected, instance terminated', async () => {
    const instance = (env.QUOTE as unknown as FakeWorkflow).ensure(QUOTE_INSTANCE);
    ports.db.seed('quote_workflows', [{ rfq_id: RFQ, quote_version: 1, workflow_instance_id: QUOTE_INSTANCE, status: 'awaiting_approval' }]);
    const w = await waiting({ kind: 'quote', allowed: ['approve', 'reject'], instance: QUOTE_INSTANCE });
    expect(await decide(env, ports, relay(w.token, 'rej'))).toMatchObject({ ok: true, result: { outcome: 'terminated', label: 'Rejected' } });
    expect(ports.db.rows('quote_workflows')[0].status).toBe('rejected');
    expect(instance.calls).toEqual([{ method: 'terminate' }]);
  });

  it('reply_pick on a consumer run (no Workflow) -> agent-events decision message with the candidate', async () => {
    const queue = env.AGENT_EVENTS as unknown as FakeQueue;
    const w = await waiting({ kind: 'reply_pick', allowed: ['attach_1', 'attach_2', 'new_rfq', 'ignore'], output: { candidates: [{ rfq_number: 'RFQ-1' }, { rfq_number: 'RFQ-2' }] } });
    expect(await decide(env, ports, relay(w.token, 'a2'))).toMatchObject({ ok: true, result: { outcome: 'event_sent', verb: 'attach_2' } });
    expect(queue.sent).toEqual([{ body: { v: 1, type: 'decision', run_id: w.runId, card_kind: 'reply_pick', verb: 'attach_2', actor: 'telegram:4242', channel: 'telegram', candidate: 2 }, options: { contentType: 'json' } }]);
  });

  it('mcp channel decides with a hash and a verb like the dashboard', async () => {
    const w = await waiting({ kind: 'test', allowed: ['dismiss'] });
    expect(await decide(env, ports, { channel: 'mcp', actor: `user:${UID}`, token_sha256: w.hash, verb: 'dismiss' })).toMatchObject({ ok: true, result: { outcome: 'dismissed' } });
  });
});

describe('failure cards', () => {
  async function failed(restartable = true, step: string | null = 'extract') {
    const run = await openRun(ports.db, { agent: 'rfq_intake', trigger: 'workflow', idempotency_key: `f-${Math.random()}`, workflow_name: 'rfq-intake', workflow_instance_id: INTAKE_INSTANCE });
    await failRun(env, ports, run.run_id, { error: 'schema', failed_step: step, restartable }, addUsage({ ...EMPTY_USAGE, by_step: {} }, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.0001, model: 'claude-sonnet-5-5' }, 'extract'));
    const token = ports.telegram.cards.at(-1)?.token as string;
    secrets.push(token, await sha256hex(token));
    return { runId: run.run_id, token };
  }

  it('rty -> restart from the failed step exactly once (restarted); the run continues as running', async () => {
    const instance = (env.RFQ_INTAKE as unknown as FakeWorkflow).ensure(INTAKE_INSTANCE);
    const f = await failed();
    expect(await decide(env, ports, relay(f.token, 'rty'))).toMatchObject({ ok: true, result: { outcome: 'restarted', verb: 'retry', label: 'Retrying' } });
    expect(instance.calls).toEqual([{ method: 'restart', args: { from: { name: 'extract' } } }]);
    expect(runRow(f.runId)).toMatchObject({ status: 'running', parked_reason: null, approval_token_sha256: null });
    expect(await decide(env, ports, relay(f.token, 'rty'))).toEqual({ ok: false, error: 'already_decided' });
    expect(instance.calls).toHaveLength(1);
  });

  it('dis -> run failed with its error and usage kept (dismissed)', async () => {
    const f = await failed();
    expect(await decide(env, ports, relay(f.token, 'dis'))).toMatchObject({ ok: true, result: { outcome: 'dismissed' } });
    const row = runRow(f.runId);
    expect(row).toMatchObject({ status: 'failed', error: 'schema', parked_reason: null, approval_token_sha256: null, llm_calls: 1 });
    expect(Number(row.cost_cents)).toBeGreaterThan(0);
  });

  it('a restart that throws closes the run failed with restart_failed (dismissed)', async () => {
    const instance = (env.RFQ_INTAKE as unknown as FakeWorkflow).ensure(INTAKE_INSTANCE);
    instance.failures.set('restart', new Error('no such step in the history'));
    const f = await failed();
    expect(await decide(env, ports, relay(f.token, 'rty'))).toMatchObject({ ok: true, result: { outcome: 'dismissed', label: 'Retry not possible; closed' } });
    expect(runRow(f.runId)).toMatchObject({ status: 'failed', error: 'restart_failed' });
  });

  it('a card without a failed step offers no retry: rty -> verb_not_allowed', async () => {
    const f = await failed(true, null);
    expect(await decide(env, ports, relay(f.token, 'rty'))).toEqual({ ok: false, error: 'verb_not_allowed' });
  });

  it('a decision on the dashboard also edits the Telegram card', async () => {
    const run = await openRun(ports.db, { agent: 'eval', trigger: 'manual', idempotency_key: 'card-edit' });
    const { token } = await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
    const hash = await sha256hex(token);
    secrets.push(token, hash);
    await decide(env, ports, dash(run.run_id, hash, 'dismiss'));
    expect(ports.telegram.edits).toEqual([{ message_id: ports.telegram.cards[0].message_id, card: expect.objectContaining({ allowed_verbs: [] }) }]);
  });
});
