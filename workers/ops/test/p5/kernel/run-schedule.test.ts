// The Phase 5 dispatcher (src/cron/run-schedule.ts) over MemoryDb, the KV flag mirror, fake Workflows and a fake
// "scrapes" queue: gates first (no run row for a closed gate), idempotent runs and instances, the catch-up window,
// enqueue failures closed 'failed' with 'enqueue_failed', the tender fan-out, the inline marketing jobs and a
// simulated week of minute ticks (PHASE5_SPEC §5.2, §7.2 K5 row, G5-5).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFlag } from '../../../src/agents/flags';
import type { OpsEnv } from '../../../src/env';
import type { P5ScrapeMessage } from '../../../src/queues/messages';
import { agentBindings, agentPorts, FakeKV, FakeQueue, FakeWorkflow, type AgentTestPorts } from '../../helpers/agent-env';
import { opsEnv } from '../../helpers/ops';

const spies = vi.hoisted(() => ({
  followups: vi.fn(async (_env: unknown, _slot: string, _o?: unknown) => ({ due: 2, enqueued: 2 })),
  warmup: vi.fn(async (_env: unknown, _date: string, _o?: unknown) => ({ accounts: 1 })),
}));

// The marketing and collector modules belong to other units; the dispatcher's contract with them is the call.
vi.mock('../../../src/marketing/followups', () => ({ enqueueDueFollowups: spies.followups }));
vi.mock('../../../src/marketing/warmup', () => ({ runWarmup: spies.warmup }));
vi.mock('../../../src/collectors/reddit', () => ({ handleRedditTier: vi.fn() }));
vi.mock('../../../src/collectors/hn', () => ({ handleHnScan: vi.fn() }));
vi.mock('../../../src/collectors/tenders', () => ({ handleTenderScheduled: vi.fn() }));
vi.mock('../../../src/xometry/queue', () => ({ handleXometryScan: vi.fn() }));

const { runSchedule, isoWeekKey, errorName, countryFilter } = await import('../../../src/cron/run-schedule');

const MINUTE = 60_000;
/** Monday 2026-10-05 00:00 UTC. */
const MONDAY = Date.UTC(2026, 9, 5);
const t = (h: number, m = 0, day = 0) => MONDAY + day * 86_400_000 + (h * 60 + m) * MINUTE;

interface World {
  env: OpsEnv;
  ports: AgentTestPorts;
  kv: FakeKV;
  scrapes: FakeQueue<P5ScrapeMessage>;
  content: FakeWorkflow;
  sitemap: FakeWorkflow;
  digest: FakeWorkflow;
  memo: Set<string>;
}

function world(vars: Partial<OpsEnv> = {}): World {
  const kv = new FakeKV();
  const scrapes = new FakeQueue<P5ScrapeMessage>();
  const content = new FakeWorkflow();
  const sitemap = new FakeWorkflow();
  const digest = new FakeWorkflow();
  const env = opsEnv({
    ...agentBindings({ FLAGS: kv as unknown as KVNamespace }),
    SCRAPES: scrapes as unknown as OpsEnv['SCRAPES'],
    CONTENT_DAILY: content as unknown as OpsEnv['CONTENT_DAILY'],
    SITEMAP: sitemap as unknown as OpsEnv['SITEMAP'],
    OPS_DIGEST: digest as unknown as OpsEnv['OPS_DIGEST'],
    ...vars,
  });
  return { env, ports: agentPorts(), kv, scrapes, content, sitemap, digest, memo: new Set() };
}

function setFlag(w: World, key: string, enabled: boolean, value: Record<string, unknown> = {}, mode: AgentFlag['mode'] = 'assist'): void {
  w.kv.setJson(key, { enabled, mode, value, rev: 1 });
}

const ALL_FLAGS = ['agent.growth.reddit', 'agent.growth.hn', 'agent.growth.tenders', 'agent.growth.xometry', 'agent.content_daily', 'agent.ops_digest'];

function runs(w: World) {
  return (w.ports.db.tables.agent_runs ?? []) as Array<Record<string, unknown>>;
}

function tick(w: World, at: number, extra: { memo?: Set<string> } = {}) {
  return runSchedule(w.env, at, { ports: w.ports, memo: extra.memo ?? w.memo });
}

/** The fired entries with an open gate (closed gates of other due jobs are left out). */
async function active(p: ReturnType<typeof tick>) {
  return (await p).fired.filter((f) => f.outcome !== 'flag_off');
}

let errors: string[];
beforeEach(() => {
  spies.followups.mockClear();
  spies.warmup.mockClear();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('gates (G5-5: a closed gate writes nothing)', () => {
  it('every flag off and both vars unset: outcome flag_off for each due job, no run row, no message, no instance, no database call', async () => {
    const w = world();
    const result = await tick(w, t(6, 0));
    expect(result.fired.map((f) => `${f.job}:${f.outcome}`).sort()).toEqual(
      ['hn', 'reddit-t1', 'reddit-t2', 'reddit-t3', 'tenders', 'xometry', 'ops-digest'].filter((j) => j !== 'ops-digest').map((j) => `${j}:flag_off`).sort(),
    );
    expect(w.ports.db.calls).toEqual([]);
    expect(w.scrapes.sent).toEqual([]);
    expect(w.content.created).toEqual([]);
  });

  it('a disabled flag record and a malformed one read as off', async () => {
    const w = world();
    setFlag(w, 'agent.growth.hn', false);
    w.kv.store.set('agent.growth.reddit', '{"enabled":"yes"}');
    const result = await tick(w, t(10, 30));
    expect(result.fired.filter((f) => f.job === 'hn' || f.job.startsWith('reddit')).every((f) => f.outcome === 'flag_off')).toBe(true);
    expect(runs(w)).toEqual([]);
  });

  it('the flag is read once per key and tick (three reddit tiers share one read)', async () => {
    const w = world();
    setFlag(w, 'agent.growth.reddit', true);
    await tick(w, t(11, 0));
    expect(w.kv.gets.filter((g) => g.key === 'agent.growth.reddit')).toHaveLength(1);
    expect(w.kv.gets.find((g) => g.key === 'agent.growth.reddit')?.options).toEqual({ type: 'json', cacheTtl: 30 });
  });

  it('var gates open only on the exact string "true"', async () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      const w = world({ MARKETING_FOLLOWUPS_ENABLED: value, MARKETING_WARMUP_ENABLED: value });
      const followups = await tick(w, t(10, 5));
      const warmup = await tick(w, t(0, 5, 1));
      expect(followups.fired.find((f) => f.job === 'marketing-followups')?.outcome, value).toBe('flag_off');
      expect(warmup.fired.find((f) => f.job === 'marketing-warmup')?.outcome, value).toBe('flag_off');
    }
    expect(spies.followups).not.toHaveBeenCalled();
    expect(spies.warmup).not.toHaveBeenCalled();
  });
});

describe('scrape jobs', () => {
  it('reddit tiers and HN at :00: one run per job (trigger cron, run key with the slot), one message each carrying the run id', async () => {
    const w = world();
    setFlag(w, 'agent.growth.reddit', true);
    setFlag(w, 'agent.growth.hn', true, {}, 'shadow');
    const result = await tick(w, t(13, 0));
    expect(result.fired.filter((f) => f.outcome === 'enqueued').map((f) => f.job).sort()).toEqual(['hn', 'reddit-t1', 'reddit-t2', 'reddit-t3']);
    const keys = runs(w).map((r) => r.idempotency_key).sort();
    expect(keys).toEqual(['growth.hn:2026-10-05T13:00Z', 'growth.reddit:t1:2026-10-05T13:00Z', 'growth.reddit:t2:2026-10-05T13:00Z', 'growth.reddit:t3:2026-10-05T13:00Z']);
    for (const r of runs(w)) {
      expect(r.trigger).toBe('cron');
      expect(r.status).toBe('running');
    }
    const byKey = new Map(runs(w).map((r) => [r.idempotency_key, r.id]));
    const bodies = w.scrapes.sent.map((s) => s.body);
    expect(bodies.map((b) => b.kind).sort()).toEqual(['hn-scan', 'reddit-tier', 'reddit-tier', 'reddit-tier']);
    const t2 = bodies.find((b) => b.kind === 'reddit-tier' && (b.params as { tier: number }).tier === 2);
    expect(t2).toMatchObject({ v: 1, params: { tier: 2, max: 40, slot: '2026-10-05T13:00Z' }, requested_by: 'schedule', run_id: byKey.get('growth.reddit:t2:2026-10-05T13:00Z') });
    expect(bodies.find((b) => b.kind === 'hn-scan')).toMatchObject({ params: { slot: '2026-10-05T13:00Z' }, run_id: byKey.get('growth.hn:2026-10-05T13:00Z') });
    expect(w.scrapes.sent[0]?.options).toEqual({ contentType: 'json' });
  });

  it('a second tick for the same slot (new isolate, empty memo) finds the run and sends nothing: outcome exists', async () => {
    const w = world();
    setFlag(w, 'agent.growth.hn', true);
    await tick(w, t(13, 30));
    const again = await tick(w, t(13, 30), { memo: new Set() });
    expect(again.fired.find((f) => f.job === 'hn')?.outcome).toBe('exists');
    expect(w.scrapes.sent.filter((s) => s.body.kind === 'hn-scan')).toHaveLength(1);
    expect(runs(w).filter((r) => r.agent === 'growth.hn')).toHaveLength(1);
  });

  it('send() throwing: the run is closed failed with error enqueue_failed, outcome error, a log line with job, slot and name; no retry later', async () => {
    const w = world();
    setFlag(w, 'agent.growth.xometry', true);
    w.scrapes.failWith = new Error('queue unavailable');
    const result = await tick(w, t(8, 0));
    expect(result.fired.find((f) => f.job === 'xometry')).toEqual({ job: 'xometry', slot: '2026-10-05T08:00Z', outcome: 'error' });
    const run = runs(w).find((r) => r.agent === 'growth.xometry');
    expect(run).toMatchObject({ idempotency_key: 'growth.xometry:2026-10-05T08:00Z', status: 'failed', error: 'enqueue_failed' });
    expect(errors).toContain('[microns-ops] schedule xometry 2026-10-05T08:00Z error enqueue_failed');
    w.scrapes.failWith = undefined;
    const later = await tick(w, t(8, 10), { memo: new Set() });
    expect(later.fired.find((f) => f.job === 'xometry')?.outcome).toBe('exists');
    expect(w.scrapes.sent).toEqual([]);
  });

  it('never throws: a database failure on openRun becomes outcome error and the other jobs still fire', async () => {
    const w = world();
    setFlag(w, 'agent.growth.reddit', true);
    setFlag(w, 'agent.growth.hn', true);
    const rpc = w.ports.db.rpc.bind(w.ports.db);
    let calls = 0;
    vi.spyOn(w.ports.db, 'rpc').mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'agent_run_begin' && calls++ === 0) throw new Error('boom');
      return rpc(name, args);
    });
    const result = await active(tick(w, t(14, 30)));
    expect(result.map((f) => `${f.job}:${f.outcome}`).sort()).toEqual(['hn:enqueued', 'reddit-t1:error', 'reddit-t2:enqueued']);
    expect(errors).toContain('[microns-ops] schedule reddit-t1 2026-10-05T14:30Z error Error');
  });

  it('a missing ports configuration is reported per job, never thrown out of the tick', async () => {
    const w = world({ AGENT_STUBS: 'nonsense' });
    setFlag(w, 'agent.growth.hn', true);
    const result = await runSchedule(w.env, t(15, 0), { memo: new Set() });
    expect(result.fired.find((f) => f.job === 'hn')?.outcome).toBe('error');
  });
});

describe('workflow jobs', () => {
  it('content-daily at 07:00: instance content-daily-<date> with {date, trigger: cron}; a second create is exists', async () => {
    const w = world();
    setFlag(w, 'agent.content_daily', true, { steps: ['generate', 'translate', 'fix_links', 'sitemap'] });
    expect(await active(tick(w, t(7, 0)))).toEqual([{ job: 'content-daily', slot: '2026-10-05T07:00Z', outcome: 'created' }]);
    expect(w.content.created).toEqual([{ id: 'content-daily-2026-10-05', params: { date: '2026-10-05', trigger: 'cron' } }]);
    expect(await active(tick(w, t(7, 0), { memo: new Set() }))).toEqual([{ job: 'content-daily', slot: '2026-10-05T07:00Z', outcome: 'exists' }]);
    expect(runs(w)).toEqual([]);
  });

  it('sitemap at 09:00 only when value.steps is exactly ["sitemap"], and then content-daily never runs', async () => {
    const w = world();
    setFlag(w, 'agent.content_daily', true, { steps: ['sitemap'] });
    expect((await tick(w, t(7, 0))).fired.find((f) => f.job === 'content-daily')).toEqual({ job: 'content-daily', slot: '2026-10-05T07:00Z', outcome: 'flag_off' });
    expect(await active(tick(w, t(9, 0)))).toEqual([{ job: 'sitemap', slot: '2026-10-05T09:00Z', outcome: 'created' }]);
    expect(w.sitemap.created).toEqual([{ id: 'sitemap-2026-10-05', params: { date: '2026-10-05' } }]);
    expect(w.content.created).toEqual([]);
    setFlag(w, 'agent.content_daily', true, { steps: ['generate', 'sitemap'] });
    expect((await tick(w, t(9, 0, 1))).fired.find((f) => f.job === 'sitemap')).toEqual({ job: 'sitemap', slot: '2026-10-06T09:00Z', outcome: 'flag_off' });
    expect(w.sitemap.created).toHaveLength(1);
  });

  it('ops-digest on Monday 06:30 with the ISO week id and params', async () => {
    const w = world();
    setFlag(w, 'agent.ops_digest', true);
    expect(await active(tick(w, t(6, 30)))).toEqual([{ job: 'ops-digest', slot: '2026-10-05T06:30Z', outcome: 'created' }]);
    expect(w.digest.created).toEqual([{ id: 'ops-digest-2026-W41', params: { iso_week: '2026-W41', trigger: 'cron' } }]);
  });

  it('ISO weeks across year boundaries', () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01'); // Thursday
    expect(isoWeekKey(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53'); // Friday of 2026's week 53
    expect(isoWeekKey(new Date(Date.UTC(2027, 0, 4)))).toBe('2027-W01'); // Monday
    expect(isoWeekKey(new Date(Date.UTC(2025, 11, 29)))).toBe('2026-W01'); // Monday of 2026-W01
  });

  it('a missing Workflow binding is an error outcome naming config_missing (no value logged)', async () => {
    const w = world({ CONTENT_DAILY: undefined });
    setFlag(w, 'agent.content_daily', true, { steps: ['generate'] });
    expect(await active(tick(w, t(7, 0)))).toEqual([{ job: 'content-daily', slot: '2026-10-05T07:00Z', outcome: 'error' }]);
    expect(errors).toContain('[microns-ops] schedule content-daily 2026-10-05T07:00Z error config_missing');
  });
});

describe('catch-up (D-5)', () => {
  it('a lost 07:00 tick: content-daily is created at 07:01 for the 07:00 slot; the next ticks of the window add nothing', async () => {
    const w = world();
    setFlag(w, 'agent.content_daily', true, { steps: ['generate'] });
    expect(await active(tick(w, t(7, 1)))).toEqual([{ job: 'content-daily', slot: '2026-10-05T07:00Z', outcome: 'created' }]);
    for (let m = 2; m <= 60; m++) await tick(w, t(7, m));
    expect(w.content.created).toHaveLength(1);
  });

  it('a tick 61 minutes late does not fire', async () => {
    const w = world();
    setFlag(w, 'agent.content_daily', true, { steps: ['generate'] });
    expect(await active(tick(w, t(8, 1)))).toEqual([]);
    expect((await tick(w, t(8, 2))).fired.some((f) => f.job === 'content-daily')).toBe(false);
    expect(w.content.created).toEqual([]);
  });

  it('the per-isolate memo avoids repeated openRun calls during the window (one agent_run_begin per slot)', async () => {
    const w = world();
    setFlag(w, 'agent.growth.xometry', true);
    for (let m = 0; m <= 60; m++) await tick(w, t(6, m));
    const begins = w.ports.db.calls.filter((c) => c.method === 'rpc' && c.target === 'agent_run_begin');
    expect(begins).toHaveLength(1);
    expect(w.scrapes.sent).toHaveLength(1);
  });

  it('a flag switched on inside the window fires the slot then (catch-up), switched on after it never', async () => {
    const w = world();
    expect((await tick(w, t(6, 10))).fired.find((f) => f.job === 'tenders')?.outcome).toBe('flag_off');
    setFlag(w, 'agent.growth.tenders', true);
    w.ports.db.seed('tender_connectors', [{ country_code: 'NL', is_active: true, last_scan_at: null }]);
    expect((await tick(w, t(6, 20))).fired.find((f) => f.job === 'tenders')).toEqual({ job: 'tenders', slot: '2026-10-05T06:00Z', outcome: 'enqueued' });
    const evening = world();
    setFlag(evening, 'agent.content_daily', true, { steps: ['generate'] });
    expect((await tick(evening, t(19, 0))).fired.some((f) => f.job === 'content-daily')).toBe(false);
    expect(evening.content.created).toEqual([]);
  });
});

describe('tenders', () => {
  const CONNECTORS = [
    { country_code: 'NL', is_active: true, last_scan_at: null },
    { country_code: 'DE', is_active: true, last_scan_at: '2026-10-04T20:00:00.000Z' }, // 10 h before 06:00: due
    { country_code: 'FR', is_active: true, last_scan_at: '2026-10-05T01:00:00.000Z' }, // 5 h before: not due
    { country_code: 'IT', is_active: false, last_scan_at: null }, // inactive
    { country_code: 'ES', is_active: true, last_scan_at: '2026-10-04T23:59:00.000Z' }, // 6 h 1 min before: due
    { country_code: 'PT', is_active: true, last_scan_at: '2026-10-05T00:00:00.000Z' }, // exactly 6 h: not due (live: lt cutoff)
  ];

  it('parent run growth.tenders:<date>, one tender-scheduled message per due connector, parent closed succeeded with the counts', async () => {
    const w = world();
    setFlag(w, 'agent.growth.tenders', true);
    w.ports.db.seed('tender_connectors', CONNECTORS);
    const result = await tick(w, t(6, 0));
    expect(result.fired.find((f) => f.job === 'tenders')?.outcome).toBe('enqueued');
    const parent = runs(w).find((r) => r.agent === 'growth.tenders');
    expect(parent).toMatchObject({ idempotency_key: 'growth.tenders:2026-10-05', trigger: 'cron', status: 'succeeded', output: { due: 3, enqueued: 3, countries: null } });
    const tenders = w.scrapes.sent.map((s) => s.body).filter((b) => b.kind === 'tender-scheduled');
    expect(tenders.map((b) => b.params)).toEqual([
      { country_code: 'DE', date: '2026-10-05' },
      { country_code: 'ES', date: '2026-10-05' },
      { country_code: 'NL', date: '2026-10-05' },
    ]);
    for (const b of tenders) expect(b.run_id).toBe(parent?.id);
    expect(w.ports.db.calls.filter((c) => c.method === 'select' && c.target === 'tender_connectors')).toHaveLength(1);
  });

  it('value.countries narrows the due set (canary); the parent records the filter', async () => {
    const w = world();
    setFlag(w, 'agent.growth.tenders', true, { countries: ['nl', 'FR'] });
    w.ports.db.seed('tender_connectors', CONNECTORS);
    await tick(w, t(6, 0));
    expect(w.scrapes.sent.map((s) => (s.body.params as { country_code: string }).country_code)).toEqual(['NL']);
    expect(runs(w).find((r) => r.agent === 'growth.tenders')?.output).toEqual({ due: 3, enqueued: 1, countries: ['NL', 'FR'] });
    expect(countryFilter({ enabled: true, mode: 'assist', value: { countries: [] } })).toBeNull();
    expect(countryFilter({ enabled: true, mode: 'assist', value: { countries: ['NL', 3] } })).toBeNull();
  });

  it('a send failure part-way closes the parent failed with enqueue_failed and the counts so far', async () => {
    const w = world();
    setFlag(w, 'agent.growth.tenders', true);
    w.ports.db.seed('tender_connectors', CONNECTORS);
    const send = w.scrapes.send.bind(w.scrapes);
    let n = 0;
    vi.spyOn(w.scrapes, 'send').mockImplementation(async (body, options) => {
      if (n++ === 1) throw new Error('queue down');
      return send(body, options);
    });
    const result = await tick(w, t(6, 0));
    expect(result.fired.find((f) => f.job === 'tenders')?.outcome).toBe('error');
    expect(runs(w).find((r) => r.agent === 'growth.tenders')).toMatchObject({ status: 'failed', error: 'enqueue_failed', output: { due: 3, enqueued: 1, countries: null } });
  });

  it('no due connector: the parent still closes succeeded with zero counts', async () => {
    const w = world();
    setFlag(w, 'agent.growth.tenders', true);
    await tick(w, t(6, 0));
    expect(runs(w).find((r) => r.agent === 'growth.tenders')).toMatchObject({ status: 'succeeded', output: { due: 0, enqueued: 0, countries: null } });
  });
});

describe('inline marketing jobs', () => {
  it('follow-ups at minute 5: run marketing.followups:<slot>, enqueueDueFollowups(env, slot, {run_id, ports}), run closed with the counts', async () => {
    const w = world({ MARKETING_FOLLOWUPS_ENABLED: 'true' });
    expect(await active(tick(w, t(10, 5)))).toEqual([{ job: 'marketing-followups', slot: '2026-10-05T10:05Z', outcome: 'created' }]);
    const run = runs(w).find((r) => r.agent === 'marketing.followups');
    expect(run).toMatchObject({ idempotency_key: 'marketing.followups:2026-10-05T10:05Z', trigger: 'cron', status: 'succeeded', output: { due: 2, enqueued: 2 } });
    expect(spies.followups).toHaveBeenCalledExactlyOnceWith(w.env, '2026-10-05T10:05Z', { run_id: run?.id, ports: w.ports });
  });

  it('warm-up at 00:05: run marketing.warmup:<date>; a failure closes it failed with the error name (config names, no values)', async () => {
    const w = world({ MARKETING_WARMUP_ENABLED: 'true' });
    const { ConfigMissingError } = await import('../../../src/agents/config');
    spies.warmup.mockRejectedValueOnce(new ConfigMissingError(['SENDER_LIMITER']));
    expect(await active(tick(w, t(0, 5)))).toEqual([{ job: 'marketing-warmup', slot: '2026-10-05T00:05Z', outcome: 'error' }]);
    expect(runs(w).find((r) => r.agent === 'marketing.warmup')).toMatchObject({ idempotency_key: 'marketing.warmup:2026-10-05', status: 'failed', error: 'config_missing: SENDER_LIMITER' });
    expect(spies.warmup.mock.calls[0]?.[1]).toBe('2026-10-05');
    expect(errors).toContain('[microns-ops] schedule marketing-warmup 2026-10-05T00:05Z error config_missing');
  });

  it('errorName never returns a message', () => {
    expect(errorName(new Error('secret value inside'))).toBe('Error');
    expect(errorName({ toString: () => 'x' })).toBe('error');
    const odd = new Error('m');
    odd.name = 'has space';
    expect(errorName(odd)).toBe('error');
  });
});

describe('a simulated week of minute ticks (10,080) with every gate open', () => {
  it('fires reddit-t1 672, reddit-t2 336, reddit-t3 168, hn 336, tenders 7, xometry 49, content-daily 7, ops-digest 1, follow-ups 168, warm-up 7; sitemap 0', async () => {
    const w = world({ MARKETING_FOLLOWUPS_ENABLED: 'true', MARKETING_WARMUP_ENABLED: 'true' });
    for (const key of ALL_FLAGS) setFlag(w, key, true, key === 'agent.content_daily' ? { steps: ['generate', 'translate', 'fix_links', 'sitemap'] } : {});
    const counts: Record<string, number> = {};
    const firstAt: Record<string, string[]> = {};
    for (let i = 0; i < 7 * 24 * 60; i++) {
      const { fired } = await tick(w, MONDAY + i * MINUTE);
      for (const f of fired) {
        if (f.outcome !== 'created' && f.outcome !== 'enqueued') continue;
        counts[f.job] = (counts[f.job] ?? 0) + 1;
        (firstAt[f.job] ??= []).push(new Date(MONDAY + i * MINUTE).toISOString().slice(0, 16));
      }
    }
    expect(counts).toEqual({
      'reddit-t1': 672, 'reddit-t2': 336, 'reddit-t3': 168, hn: 336, tenders: 7, xometry: 49,
      'content-daily': 7, 'ops-digest': 1, 'marketing-followups': 168, 'marketing-warmup': 7,
    });
    expect(firstAt['ops-digest']).toEqual(['2026-10-05T06:30']);
    expect(w.content.created).toHaveLength(7);
    expect(w.sitemap.created).toHaveLength(0);
  }, 60_000);

  it('the same week with steps ["sitemap"]: sitemap 7 and content-daily 0 (never both)', async () => {
    const w = world();
    setFlag(w, 'agent.content_daily', true, { steps: ['sitemap'] });
    for (let i = 0; i < 7 * 24 * 60; i++) await tick(w, MONDAY + i * MINUTE);
    expect(w.sitemap.created.map((c) => c.id)).toEqual([5, 6, 7, 8, 9, 10, 11].map((d) => `sitemap-2026-10-${String(d).padStart(2, '0')}`));
    expect(w.content.created).toEqual([]);
  }, 60_000);

  it('without the vars the two marketing jobs never run', async () => {
    const w = world();
    for (let i = 0; i < 24 * 60; i++) await tick(w, MONDAY + i * MINUTE);
    expect(spies.followups).not.toHaveBeenCalled();
    expect(spies.warmup).not.toHaveBeenCalled();
  });
});
