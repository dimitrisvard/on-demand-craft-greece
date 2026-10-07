// K-2 run records: openRun created / existing / final (rpc/agent_run_begin of memory-rpc); addUsage; closeRun writes
// cost_cents > 0 whenever llm_calls > 0 and clears the token and parked_reason; parkRun; failRun is one PATCH to a
// failure card; dailyCapReached at cap and cap + 1; approval.request is one PATCH; waitWithReminder timeout ->
// reminder -> second timeout through FakeStep. The CHECK lists of agent_runs equal the TypeScript unions.

import { describe, expect, it, vi } from 'vitest';
import { request, waitWithReminder } from '../../src/agents/approval';
import { testCard } from '../../src/agents/cards/test';
import type { AgentFlag } from '../../src/agents/flags';
import { sha256hex } from '../../src/agents/ids';
import {
  EMPTY_USAGE,
  addUsage,
  DEFAULT_MAX_RUNS_PER_DAY,
  applyDailyCap,
  checkpointRun,
  closeRun,
  dailyCap,
  dailyCapReached,
  failRun,
  openRun,
  parkRun,
  usageColumns,
  type ParkReason,
  type RunStatus,
  type RunTrigger,
  type UsageAcc,
} from '../../src/agents/runs';
import { agentBindings, agentPorts } from '../helpers/agent-env';
import { checkList, sorted } from '../helpers/check-lists';
import { FakeStep } from '../helpers/fake-step';
import { opsEnv } from '../helpers/ops';

const flag = (value: Record<string, unknown> = {}): AgentFlag => ({ enabled: true, mode: 'assist', value });

function setup(extra: Record<string, unknown> = {}) {
  const ports = agentPorts();
  const env = opsEnv({ ...agentBindings(), AGENT_APPROVAL_SECRET: 'approval-test-value', ...extra });
  return { env, ports, db: ports.db };
}

async function open(db: ReturnType<typeof setup>['db'], key = 'k-1') {
  return openRun(db, { agent: 'rfq_intake', trigger: 'workflow', idempotency_key: key, workflow_name: 'rfq-intake', workflow_instance_id: `rfq-intake-${'a'.repeat(32)}` });
}

const llmUsage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500, cost_usd: 0.0123, model: 'claude-sonnet-5-5' };

describe('CHECK lists of agent_runs equal the TypeScript unions', () => {
  it('status, trigger and parked_reason', () => {
    expect(sorted(['running', 'waiting_human', 'succeeded', 'failed', 'cancelled', 'skipped'] satisfies RunStatus[])).toEqual(sorted(checkList('agent_runs_status_check')));
    expect(sorted(['email', 'cron', 'queue', 'workflow', 'dashboard', 'telegram', 'mcp', 'manual'] satisfies RunTrigger[])).toEqual(sorted(checkList('agent_runs_trigger_check')));
    expect(sorted(['flag_off', 'budget', 'llm_unavailable', 'failed'] satisfies ParkReason[])).toEqual(sorted(checkList('agent_runs_parked_reason_check')));
  });
});

describe('openRun', () => {
  it('creates once, then returns the existing run and its status', async () => {
    const { db } = setup();
    const first = await open(db);
    expect(first).toEqual({ run_id: expect.any(String), created: true, status: 'running' });
    const again = await open(db);
    expect(again).toEqual({ run_id: first.run_id, created: false, status: 'running' });
    await closeRun(db, first.run_id, { status: 'succeeded' }, EMPTY_USAGE);
    expect(await open(db)).toEqual({ run_id: first.run_id, created: false, status: 'succeeded' });
    const row = db.rows('agent_runs')[0];
    expect(row).toMatchObject({ agent: 'rfq_intake', trigger: 'workflow', workflow_name: 'rfq-intake', idempotency_key: 'k-1' });
    expect(db.calls.filter((c) => c.method === 'rpc').map((c) => c.args)).toContainEqual({
      p_agent: 'rfq_intake',
      p_trigger: 'workflow',
      p_idempotency_key: 'k-1',
      p_fields: { workflow_name: 'rfq-intake', workflow_instance_id: `rfq-intake-${'a'.repeat(32)}` },
    });
  });
});

describe('usage and closing', () => {
  it('addUsage is pure and separates LLM calls from embedding calls', () => {
    let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
    const before = structuredClone(acc);
    acc = addUsage(acc, llmUsage, 'extract');
    acc = addUsage(acc, { input_tokens: 40, cost_usd: 0.000001 }, 'similar');
    acc = addUsage(acc, { ...llmUsage, cost_usd: 0.001 }, 'extract');
    expect(before).toEqual({ ...EMPTY_USAGE, by_step: {} });
    expect(acc).toMatchObject({ llm_calls: 2, input_tokens: 2400, output_tokens: 600, cache_read_tokens: 8000, cache_write_tokens: 1000, embed_calls: 1, embed_input_tokens: 40 });
    expect(acc.cost_usd).toBeCloseTo(0.013301, 9);
    expect(acc.by_step.extract).toBeCloseTo(0.0133, 9);
    expect(usageColumns(acc)).toMatchObject({ llm_calls: 2, input_tokens: 2400 + 1000, output_tokens: 600, cached_input_tokens: 8000, cost_cents: 1.3301, price_missing: false });
  });

  it('closeRun: one PATCH with status, finished_at, usage, cost_cents > 0, token and parked_reason cleared', async () => {
    const { db, env, ports } = setup();
    const run = await open(db);
    await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
    expect(db.rows('agent_runs')[0].approval_token_sha256).toMatch(/^[0-9a-f]{64}$/);
    const writes = db.calls.length;
    await closeRun(db, run.run_id, { status: 'succeeded', output: { rfq_id: 'x' } }, addUsage({ ...EMPTY_USAGE, by_step: {} }, llmUsage, 'extract'));
    expect(db.calls.slice(writes)).toHaveLength(1);
    const row = db.rows('agent_runs')[0];
    expect(row).toMatchObject({ status: 'succeeded', llm_calls: 1, approval_token_sha256: null, parked_reason: null, error: null, output: { rfq_id: 'x', prices_version: '2026-09-25' } });
    expect(row.finished_at).toEqual(expect.any(String));
    expect(Number(row.cost_cents)).toBeGreaterThan(0);
    expect(Number(row.cost_cents)).toBeCloseTo(1.23, 4);
  });

  it('closeRun never writes cost_cents 0 with llm_calls > 0 (unpriced call -> smallest cost and price_missing)', async () => {
    const { db } = setup();
    const run = await open(db);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await closeRun(db, run.run_id, { status: 'succeeded', output: {} }, addUsage({ ...EMPTY_USAGE, by_step: {} }, { ...llmUsage, cost_usd: 0 }, 'x'));
    errors.mockRestore();
    const row = db.rows('agent_runs')[0];
    expect(Number(row.cost_cents)).toBe(0.0001);
    expect(row.output).toMatchObject({ price_missing: true });
  });

  it('closeRun failed keeps the stored error; other statuses clear it; a large output is replaced', async () => {
    const { db } = setup();
    const run = await open(db);
    await db.update('agent_runs', { error: 'extract_failed' }, { filters: [['id', 'eq', run.run_id]] });
    await closeRun(db, run.run_id, { status: 'failed' }, EMPTY_USAGE);
    expect(db.rows('agent_runs')[0]).toMatchObject({ status: 'failed', error: 'extract_failed' });
    const other = await open(db, 'k-2');
    await closeRun(db, other.run_id, { status: 'cancelled', output: { blob: 'x'.repeat(9000) } }, EMPTY_USAGE);
    expect(db.rows('agent_runs', ['id', 'eq', other.run_id])[0]).toMatchObject({ error: null, output: { truncated: true } });
  });

  it('parkRun sets waiting_human + reason without a token; a checkpoint to running clears the reason', async () => {
    const { db } = setup();
    const run = await open(db);
    await parkRun(db, run.run_id, 'flag_off');
    expect(db.rows('agent_runs')[0]).toMatchObject({ status: 'waiting_human', parked_reason: 'flag_off', approval_token_sha256: null, finished_at: null });
    await checkpointRun(db, run.run_id, { ...EMPTY_USAGE, by_step: {} }, { status: 'running' });
    expect(db.rows('agent_runs')[0]).toMatchObject({ status: 'running', parked_reason: null });
    await expect(checkpointRun(db, run.run_id, EMPTY_USAGE, { status: 'succeeded' })).rejects.toThrow(/closeRun/);
  });
});

describe('failRun', () => {
  it('one PATCH: waiting_human, parked_reason failed, error, usage, token hash, failure card with retry + dismiss', async () => {
    const { db, env, ports } = setup();
    const run = await open(db);
    const updatesBefore = db.calls.filter((c) => c.method === 'update').length;
    const acc = addUsage({ ...EMPTY_USAGE, by_step: {} }, llmUsage, 'extract');
    await failRun(env, ports, run.run_id, { error: 'schema', failed_step: 'extract', restartable: true }, acc);
    expect(db.calls.filter((c) => c.method === 'update').length - updatesBefore).toBe(1);
    const row = db.rows('agent_runs')[0];
    expect(row).toMatchObject({ status: 'waiting_human', parked_reason: 'failed', error: 'schema', llm_calls: 1, finished_at: null });
    expect(Number(row.cost_cents)).toBeGreaterThan(0);
    expect(row.output).toMatchObject({ card_kind: 'failure', allowed_verbs: ['retry', 'dismiss'], failed_step: 'extract', telegram_message_id: 100 });
    const sent = ports.telegram.cards[0];
    expect(row.approval_token_sha256).toBe(await sha256hex(sent.token as string));
    expect(sent.card.kind).toBe('failure');
    expect(sent.card.lines).toContainEqual({ label: 'Step', value: 'extract' });
  });

  it('without a failed step (or not restartable) the card offers dismiss only', async () => {
    const { db, env, ports } = setup();
    const a = await open(db, 'a');
    await failRun(env, ports, a.run_id, { error: 'boom', failed_step: null, restartable: true }, EMPTY_USAGE);
    const b = await open(db, 'b');
    await failRun(env, ports, b.run_id, { error: 'boom', failed_step: 'x', restartable: false }, EMPTY_USAGE);
    for (const row of db.rows('agent_runs')) expect(row.output).toMatchObject({ allowed_verbs: ['dismiss'] });
  });
});

describe('approval.request', () => {
  it('sends the card with buttons (token) and writes status, token hash and card fields in one PATCH', async () => {
    const { db, env, ports } = setup();
    const run = await open(db);
    const updatesBefore = db.calls.filter((c) => c.method === 'update').length;
    const { token, telegram_message_id } = await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
    const updates = db.calls.filter((c) => c.method === 'update').slice(updatesBefore);
    expect(updates).toHaveLength(1);
    expect(token).toMatch(/^[A-Z2-7]{26}$/);
    expect(telegram_message_id).toBe(100);
    expect(ports.telegram.cards[0].token).toBe(token);
    const row = db.rows('agent_runs')[0];
    expect(row).toMatchObject({ status: 'waiting_human', approval_token_sha256: await sha256hex(token), output: { card_kind: 'test', allowed_verbs: ['dismiss'], telegram_message_id: 100 } });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('without AGENT_APPROVAL_SECRET the card has the Open button only; a Telegram failure still leaves the run waiting', async () => {
    const { db, env, ports } = setup({ AGENT_APPROVAL_SECRET: undefined });
    const run = await open(db);
    await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
    expect(ports.telegram.cards[0].token).toBeNull();
    ports.telegram.failNext();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
    errors.mockRestore();
    expect(db.rows('agent_runs')[0]).toMatchObject({ status: 'waiting_human', output: { telegram_message_id: null } });
  });
});

describe('waitWithReminder through FakeStep', () => {
  function waitSetup() {
    const s = setup();
    const step = new FakeStep();
    const card = () => testCard({ run_id: 'unused', site_origin: s.env.SITE_ORIGIN });
    return { ...s, step, card };
  }

  it('an event before the first timeout is returned', async () => {
    const { env, ports, db, step, card } = waitSetup();
    const run = await open(db);
    step.sendEvent('quote-approved', { verb: 'approve' });
    const onTimeout = vi.fn(async () => {});
    const result = await waitWithReminder<{ verb: string }>(step, { run_id: run.run_id, type: 'quote-approved', first: '7 days', second: '7 days', card, onTimeout }, { env, ports });
    expect(result).toEqual({ event: { verb: 'approve' } });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(step.trace()).toEqual(['wait-quote-approved:ok']);
  });

  it('timeout -> remind step (new token, old card loses its buttons) -> event in the second wait', async () => {
    const { env, ports, db, step, card } = waitSetup();
    const run = await open(db);
    await request(env, ports, { run_id: run.run_id, card: card() });
    const firstHash = db.rows('agent_runs')[0].approval_token_sha256;
    step.onWait = (_type, name) => {
      if (name === 'wait-quote-approved-reminded') step.sendEvent('quote-approved', { verb: 'reject' });
    };
    const result = await waitWithReminder(step, { run_id: run.run_id, type: 'quote-approved', first: '7 days', second: '7 days', card, onTimeout: async () => {} }, { env, ports });
    expect(result).toEqual({ event: { verb: 'reject' } });
    expect(step.trace()).toEqual(['wait-quote-approved:timed_out', 'remind-quote-approved:ok', 'wait-quote-approved-reminded:ok']);
    const row = db.rows('agent_runs')[0];
    expect(row.approval_token_sha256).not.toBe(firstHash);
    expect(ports.telegram.cards).toHaveLength(2);
    expect(ports.telegram.edits[0]).toMatchObject({ message_id: 100, card: { allowed_verbs: [] } });
    // The remind step result holds no token.
    expect(JSON.stringify([...step.cache.values()])).not.toContain(ports.telegram.cards[1].token as string);
  });

  it('second timeout -> onTimeout and { timedOut: true }; a replay reuses the reminder (no further card)', async () => {
    const { env, ports, db, step, card } = waitSetup();
    const run = await open(db);
    await request(env, ports, { run_id: run.run_id, card: card() });
    const onTimeout = vi.fn(async () => {});
    const start = step.now;
    const result = await waitWithReminder(step, { run_id: run.run_id, type: 'handoff-approved', first: '7 days', second: '7 days', card, onTimeout }, { env, ports });
    expect(result).toEqual({ timedOut: true });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(step.now - start).toBe(14 * 86_400_000);
    expect(ports.telegram.cards).toHaveLength(2);
    const replay = step.replay();
    await waitWithReminder(replay, { run_id: run.run_id, type: 'handoff-approved', first: '7 days', second: '7 days', card, onTimeout }, { env, ports });
    expect(ports.telegram.cards).toHaveLength(2);
    expect(replay.trace()).toContain('remind-handoff-approved:cached');
  });

  it('an error other than the wait timeout is rethrown', async () => {
    const { env, ports, card } = waitSetup();
    const broken = { waitForEvent: async () => { throw new Error('instance terminated'); } } as unknown as FakeStep;
    await expect(waitWithReminder(broken, { run_id: 'r', type: 't', first: '1 day', second: '1 day', card, onTimeout: async () => {} }, { env, ports })).rejects.toThrow('instance terminated');
  });
});

describe('daily cap (flood control)', () => {
  async function seedRuns(db: ReturnType<typeof setup>['db'], n: number, startedAt: string) {
    db.seed('agent_runs', Array.from({ length: n }, (_, i) => ({ agent: 'rfq_intake', trigger: 'email', idempotency_key: `seed-${startedAt}-${i}`, started_at: startedAt })));
  }

  it('reached only above the cap; yesterday does not count; default cap 200', async () => {
    const { db } = setup();
    const now = new Date('2026-10-05T12:00:00Z');
    await seedRuns(db, 3, '2026-10-04T23:59:59Z');
    await seedRuns(db, 5, '2026-10-05T00:00:00Z');
    expect(await dailyCapReached(db, 'rfq_intake', flag({ max_runs_per_day: 5 }), now)).toBe(false);
    await seedRuns(db, 1, '2026-10-05T11:00:00Z');
    expect(await dailyCapReached(db, 'rfq_intake', flag({ max_runs_per_day: 5 }), now)).toBe(true);
    expect(await dailyCapReached(db, 'rfq_intake', flag(), now)).toBe(false);
    expect(await dailyCapReached(db, 'quote', flag({ max_runs_per_day: 1 }), now)).toBe(false);
    const selects = db.calls.filter((c) => c.method === 'select' && c.target === 'agent_runs');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('without a valid max_runs_per_day the cap is 200: reached at the 201st run of the UTC day, not at the 200th', async () => {
    expect(DEFAULT_MAX_RUNS_PER_DAY).toBe(200);
    for (const value of [{}, { max_runs_per_day: 0 }, { max_runs_per_day: -3 }, { max_runs_per_day: 2.5 }, { max_runs_per_day: '50' }]) expect(dailyCap(flag(value))).toBe(200);
    expect(dailyCap(flag({ max_runs_per_day: 7 }))).toBe(7);
    const { db } = setup();
    const now = new Date('2026-10-05T12:00:00Z');
    await seedRuns(db, 200, '2026-10-05T01:00:00Z');
    expect(await dailyCapReached(db, 'rfq_intake', flag(), now)).toBe(false);
    await seedRuns(db, 1, '2026-10-05T02:00:00Z');
    expect(await dailyCapReached(db, 'rfq_intake', flag(), now)).toBe(true);
  });

  it('applyDailyCap closes the run skipped/daily_cap without LLM calls and sends one notice per day', async () => {
    const { db, env, ports } = setup();
    ports.clock.set(new Date('2026-10-05T12:00:00Z'));
    await seedRuns(db, 2, '2026-10-05T01:00:00Z');
    const third = await open(db, 'third');
    expect(await applyDailyCap(env, ports, { run_id: third.run_id, agent: 'rfq_intake', flag: flag({ max_runs_per_day: 2 }) })).toBe(true);
    const fourth = await open(db, 'fourth');
    expect(await applyDailyCap(env, ports, { run_id: fourth.run_id, agent: 'rfq_intake', flag: flag({ max_runs_per_day: 2 }) })).toBe(true);
    expect(db.rows('agent_runs', ['id', 'eq', third.run_id])[0]).toMatchObject({ status: 'skipped', error: 'daily_cap', llm_calls: 0 });
    expect(ports.telegram.texts).toHaveLength(1);
    expect(ports.telegram.texts[0].text).toContain('rfq_intake');
    expect(ports.llm.calls).toHaveLength(0);
  });
});
