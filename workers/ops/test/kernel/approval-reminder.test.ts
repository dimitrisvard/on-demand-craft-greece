// K-2 waitWithReminder, reminder step rules (through FakeStep and the real decide()):
//   - the reminder replaces only the card fields of output; the request step's own fields (line_count,
//     quote_workflow_id, order_id, candidates, ...) are kept, so decide() applies the same limits to the reminder card;
//   - the reminder is issued only while the run still waits on the token it had: a decision made after the first wait
//     timed out (before the reminder step, or while the reminder card is being sent) keeps the run decided, stores no
//     new token, leaves no reminder card with live buttons, and the decision's event reaches the second wait;
//   - a second decision on any card of that run is refused (already_decided) and no second event is sent.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_OUTPUT_KEYS, callerOutput, request, waitWithReminder } from '../../src/agents/approval';
import type { CardV1 } from '../../src/agents/cards/index';
import { decide, type DecideInput } from '../../src/agents/decision';
import { sha256hex } from '../../src/agents/ids';
import { openRun } from '../../src/agents/runs';
import type { OpsEnv } from '../../src/env';
import { FakeWorkflow, agentBindings, agentPorts, type AgentTestPorts } from '../helpers/agent-env';
import { FakeStep } from '../helpers/fake-step';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';
import { opsEnv } from '../helpers/ops';

const RFQ = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const UID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const QWID = '11111111-2222-4333-8444-555555555555';
const INSTANCE = `quote-${RFQ}-v1`;

let env: OpsEnv;
let ports: AgentTestPorts;
let workflow: FakeWorkflow;
let logger: RecordingLogger;
let restore: () => void;
const secrets: string[] = [];

beforeEach(() => {
  env = opsEnv({ ...agentBindings(), AGENT_APPROVAL_SECRET: 'approval-test-value' });
  ports = agentPorts();
  workflow = env.QUOTE as unknown as FakeWorkflow;
  workflow.ensure(INSTANCE);
  logger = new RecordingLogger();
  restore = logger.start();
  secrets.length = 0;
});

afterEach(() => {
  restore();
  assertNoSecretsLogged(logger.lines, secrets);
});

const row = (id: string) => ports.db.rows('agent_runs', ['id', 'eq', id])[0];
const events = () => (workflow.instances.get(INSTANCE)?.calls ?? []).filter((c) => c.method === 'sendEvent');
const dash = (runId: string, hash: string, extra: Partial<DecideInput> = {}): DecideInput => ({ channel: 'dashboard', actor: `user:${UID}`, run_id: runId, token_sha256: hash, verb: 'approve', ...extra });

/** A quote run waiting on its first approval card, with the request step's own output fields. */
async function waitingQuote(output: Record<string, unknown> = { line_count: 2, quote_workflow_id: QWID }) {
  const run = await openRun(ports.db, { agent: 'quote', trigger: 'workflow', idempotency_key: `${RFQ}:v1`, workflow_name: 'quote', workflow_instance_id: INSTANCE });
  const card = (): CardV1 => ({ v: 1, kind: 'quote', run_id: run.run_id, title: 'RFQ-20261005-1 v1', lines: [{ label: 'Total net', value: 'EUR 120.00' }], flags: [], allowed_verbs: ['approve', 'reject'], open_url: `${env.SITE_ORIGIN}/dashboard/approvals?run=${run.run_id}` });
  const { token } = await request(env, ports, { run_id: run.run_id, card: card() }, { output });
  const hash = await sha256hex(token);
  secrets.push(token, hash);
  return { runId: run.run_id, card, firstHash: hash };
}

/** Bridges events the decision sent to the Workflow instance into the FakeStep buffer (the runtime buffers them). */
function bridgeEvents(step: FakeStep): void {
  for (const c of events()) {
    const a = c.args as { type: string; payload: unknown };
    step.sendEvent(a.type, a.payload);
  }
}

describe('reminder keeps the request step output', () => {
  it('callerOutput drops exactly the card fields', () => {
    expect([...CARD_OUTPUT_KEYS].sort()).toEqual(['allowed_verbs', 'card', 'card_kind', 'telegram_message_id']);
    expect(callerOutput({ card_kind: 'quote', allowed_verbs: ['approve'], card: {}, telegram_message_id: 1, line_count: 2, quote_workflow_id: QWID })).toEqual({ line_count: 2, quote_workflow_id: QWID });
    expect(callerOutput(null)).toEqual({});
  });

  it('line_count and quote_workflow_id survive the reminder; an edit outside the line range is still refused, one inside is accepted', async () => {
    const q = await waitingQuote();
    const step = new FakeStep();
    expect(await waitWithReminder(step, { run_id: q.runId, type: 'quote-approved', first: '7 days', second: '7 days', card: q.card, onTimeout: async () => {} }, { env, ports })).toEqual({ timedOut: true });
    expect(step.trace()).toEqual(['wait-quote-approved:timed_out', 'remind-quote-approved:ok', 'wait-quote-approved-reminded:timed_out']);
    const after = row(q.runId);
    expect(after.approval_token_sha256).not.toBe(q.firstHash);
    expect(after.output).toMatchObject({ line_count: 2, quote_workflow_id: QWID, card_kind: 'quote', allowed_verbs: ['approve', 'reject'] });
    const hash = after.approval_token_sha256 as string;
    secrets.push(hash, ports.telegram.cards[1].token as string);
    expect(await decide(env, ports, dash(q.runId, hash, { edits: { overrides: [{ line_no: 7, unit_price: 1 }] } }))).toEqual({ ok: false, error: 'bad_request' });
    expect(events()).toHaveLength(0);
    expect(await decide(env, ports, dash(q.runId, hash, { edits: { overrides: [{ line_no: 2, unit_price: 1 }] } }))).toMatchObject({ ok: true, result: { outcome: 'event_sent' } });
    expect(events()).toHaveLength(1);
  });

  it('every non-card field of the request step is kept (post-order and reply_pick shapes)', async () => {
    const output = { order_id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', partner_id: null, traveller_sha256: 'a'.repeat(64), stock: { items: 1, over_held: false }, candidates: [{ rfq_number: 'RFQ-1' }] };
    const q = await waitingQuote(output);
    await waitWithReminder(new FakeStep(), { run_id: q.runId, type: 'quote-approved', first: '1 day', second: '1 day', card: q.card, onTimeout: async () => {} }, { env, ports });
    secrets.push(row(q.runId).approval_token_sha256 as string);
    expect(callerOutput(row(q.runId).output as Record<string, unknown>)).toEqual(output);
  });
});

describe('reminder only while the run waits on its token', () => {
  it('a decision after the first wait timed out and before the reminder step: no new token, no reminder card, the event reaches the second wait', async () => {
    const q = await waitingQuote();
    const step = new FakeStep();
    let first: unknown = null;
    step.onWait = (_type, name) => {
      if (name === 'wait-quote-approved-reminded') bridgeEvents(step);
    };
    // The first wait times out; the human decides on the first card before the reminder step starts.
    const firstWait = step.waitForEvent.bind(step);
    step.waitForEvent = (async (name: string, o: { type: string; timeout?: never }) => {
      try {
        return await firstWait(name, o);
      } catch (error) {
        if (name === 'wait-quote-approved') first = await decide(env, ports, dash(q.runId, q.firstHash));
        throw error;
      }
    }) as typeof step.waitForEvent;
    const waited = await waitWithReminder<{ verb: string }>(step, { run_id: q.runId, type: 'quote-approved', first: '7 days', second: '7 days', card: q.card, onTimeout: async () => {} }, { env, ports });
    expect(first).toMatchObject({ ok: true, result: { outcome: 'event_sent' } });
    expect(waited).toMatchObject({ event: { verb: 'approve', actor: `user:${UID}` } });
    expect(step.trace()).toEqual(['wait-quote-approved:timed_out', 'remind-quote-approved:ok', 'wait-quote-approved-reminded:ok']);
    expect(row(q.runId)).toMatchObject({ status: 'running', approval_token_sha256: null, human_action: { verb: 'approve' } });
    expect(ports.telegram.cards).toHaveLength(1);
    expect(await decide(env, ports, dash(q.runId, q.firstHash))).toEqual({ ok: false, error: 'already_decided' });
    expect(events()).toHaveLength(1);
  });

  it('a decision while the reminder card is being sent: the reminder is not stored, its card loses its buttons, a second decision is refused', async () => {
    const q = await waitingQuote();
    const step = new FakeStep();
    step.onWait = (_type, name) => {
      if (name === 'wait-quote-approved-reminded') bridgeEvents(step);
    };
    // The human decides on the first card after the reminder step read the run and before its PATCH.
    const send = ports.telegram.sendCard.bind(ports.telegram);
    let first: unknown = null;
    ports.telegram.sendCard = (async (c: CardV1, token: string | null) => {
      if (ports.telegram.cards.length === 1 && !first) first = await decide(env, ports, dash(q.runId, q.firstHash));
      return send(c, token);
    }) as typeof ports.telegram.sendCard;
    const waited = await waitWithReminder<{ verb: string }>(step, { run_id: q.runId, type: 'quote-approved', first: '7 days', second: '7 days', card: q.card, onTimeout: async () => {} }, { env, ports });
    expect(first).toMatchObject({ ok: true, result: { outcome: 'event_sent' } });
    expect(waited).toMatchObject({ event: { verb: 'approve' } });
    expect(row(q.runId)).toMatchObject({ status: 'running', approval_token_sha256: null, human_action: { verb: 'approve' } });
    expect(row(q.runId).output).toMatchObject({ line_count: 2, quote_workflow_id: QWID, telegram_message_id: 100 });
    // The reminder card (message 101) was sent, then edited to the decided form without buttons.
    const reminder = ports.telegram.cards[1];
    secrets.push(reminder.token as string, await sha256hex(reminder.token as string));
    expect(ports.telegram.edits).toContainEqual({ message_id: reminder.message_id, card: expect.objectContaining({ allowed_verbs: [] }) });
    // Neither the reminder token (relay) nor its hash (dashboard) nor the first card decides again.
    expect(await decide(env, ports, { channel: 'telegram', actor: 'telegram:4242', token: reminder.token as string, code: 'ok' })).toEqual({ ok: false, error: 'already_decided' });
    expect(await decide(env, ports, dash(q.runId, await sha256hex(reminder.token as string)))).toEqual({ ok: false, error: 'already_decided' });
    expect(await decide(env, ports, dash(q.runId, q.firstHash))).toEqual({ ok: false, error: 'already_decided' });
    expect(events()).toHaveLength(1);
  });

  it('a run that waits on the reminder card is decided once through it (the first card answers already_decided)', async () => {
    const q = await waitingQuote();
    const step = new FakeStep();
    // The human decides on the reminder card (relay) during the second wait.
    const wait = step.waitForEvent.bind(step);
    step.waitForEvent = (async (name: string, o: { type: string; timeout?: never }) => {
      if (name === 'wait-quote-approved-reminded') {
        const reminderToken = ports.telegram.cards[1].token as string;
        secrets.push(reminderToken, await sha256hex(reminderToken));
        expect(await decide(env, ports, { channel: 'telegram', actor: 'telegram:4242', token: reminderToken, code: 'ok' })).toMatchObject({ ok: true });
        bridgeEvents(step);
      }
      return wait(name, o);
    }) as typeof step.waitForEvent;
    const waited = await waitWithReminder<{ verb: string }>(step, { run_id: q.runId, type: 'quote-approved', first: '7 days', second: '7 days', card: q.card, onTimeout: async () => {} }, { env, ports });
    expect(waited).toMatchObject({ event: { verb: 'approve', actor: 'telegram:4242', channel: 'telegram' } });
    expect(ports.telegram.edits[0]).toMatchObject({ message_id: 100, card: { allowed_verbs: [] } });
    expect(await decide(env, ports, dash(q.runId, q.firstHash))).toEqual({ ok: false, error: 'already_decided' });
    expect(events()).toHaveLength(1);
  });
});
