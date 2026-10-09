// The collectors behind the real Phase 5 dispatcher (src/cron/run-schedule.ts, unit K5) in T1: one 06:00 tick with
// the reddit, hn and tender flags on sends the scrapes messages; each message, handed to the G5 handler of its kind,
// closes the run the dispatcher opened (reddit t1-t3, hn) or opens one child per due connector under the tender
// parent (6 h rule and value.countries). This pins the message contract between the two units.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VercelHandler } from '../../../../shared/src/compat/vercel-node';
import { makeHnScanHandler } from '../../../src/collectors/hn';
import { makeRedditTierHandler } from '../../../src/collectors/reddit';
import { makeTenderScheduledHandler } from '../../../src/collectors/tenders';
import { runSchedule } from '../../../src/cron/run-schedule';
import type { OpsEnv } from '../../../src/env';
import type { P5ScrapeMessage } from '../../../src/queues/messages';
import { FakeQueue } from '../../helpers/agent-env';
import { testContext } from '../../helpers/ops';
import { collectorHarness, scriptAlgolia, scriptPullpush, seedKeywords, subredditRow, testMessage, type CollectorHarness } from './harness';

const SIX = Date.UTC(2026, 9, 8, 6, 0, 0);
const SLOT = '2026-10-08T06:00Z';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

function world(countries?: string[]): { h: CollectorHarness; scrapes: FakeQueue<P5ScrapeMessage> } {
  const scrapes = new FakeQueue<P5ScrapeMessage>();
  const h = collectorHarness({ now: SIX, env: { SCRAPES: scrapes as unknown as OpsEnv['SCRAPES'] } });
  seedKeywords(h.db);
  h.db.seed('monitored_subreddits', [
    subredditRow('machining', 1, null, { now: SIX }),
    subredditRow('engineering', 2, null, { now: SIX }),
    subredditRow('hardware', 3, 40, { now: SIX }),
  ].map((r, i) => ({ id: i + 1, ...r })));
  h.db.seed('tender_connectors', [
    { country_code: 'NL', is_active: true, last_scan_at: null },
    { country_code: 'DE', is_active: true, last_scan_at: '2026-10-07T12:00:00.000Z' },
    { country_code: 'FR', is_active: true, last_scan_at: '2026-10-08T05:00:00.000Z' },
    { country_code: 'IT', is_active: false, last_scan_at: null },
  ]);
  scriptPullpush(h.sources);
  scriptAlgolia(h.sources);
  h.setFlag('agent.growth.reddit', { mode: 'assist' });
  h.setFlag('agent.growth.hn', { mode: 'assist' });
  h.setFlag('agent.growth.tenders', { mode: 'assist', value: countries ? { countries } : {} });
  return { h, scrapes };
}

async function deliver(h: CollectorHarness, scrapes: FakeQueue<P5ScrapeMessage>, seen: string[]) {
  const tenderHandler: VercelHandler = (req, res) => {
    seen.push(String((req.body as { country_code: string }).country_code));
    return res.status(200).json({ success: true, country_code: req.body.country_code, tenders_found: 1, tenders_new: 0, tenders_relevant: 0, errors: [], duration_ms: 3 });
  };
  const handlers = {
    'reddit-tier': makeRedditTierHandler({ sleep: h.sleep }),
    'hn-scan': makeHnScanHandler({ sleep: h.sleep }),
    'tender-scheduled': makeTenderScheduledHandler({ load: async () => ({ default: tenderHandler }) }),
  } as const;
  const messages = scrapes.sent.map((s) => testMessage(s.body));
  for (const m of messages) {
    const handler = handlers[m.body.kind as keyof typeof handlers];
    if (handler) await handler(m, h.env, testContext(), h.deps);
  }
  return messages;
}

describe('06:00 tick -> scrapes messages -> G5 handlers', () => {
  it('every dispatcher run is closed by its handler; tender children per due connector under the parent', async () => {
    const { h, scrapes } = world();
    const tick = await runSchedule(h.env, SIX, { ports: h.ports, memo: new Set() });
    expect(tick.fired.filter((f) => f.outcome === 'enqueued').map((f) => f.job).sort()).toEqual(['hn', 'reddit-t1', 'reddit-t2', 'reddit-t3', 'tenders']);
    const seen: string[] = [];
    const messages = await deliver(h, scrapes, seen);
    for (const m of messages) expect(m.acked, m.body.kind).toBe(1);

    const runs = h.db.rows('agent_runs');
    const byKey = (k: string) => runs.find((r) => r.idempotency_key === k);
    for (const k of [`growth.reddit:t1:${SLOT}`, `growth.reddit:t2:${SLOT}`, `growth.reddit:t3:${SLOT}`, `growth.hn:${SLOT}`]) {
      expect(byKey(k)?.status, k).toBe('succeeded');
    }
    const parent = byKey('growth.tenders:2026-10-08');
    expect(parent).toMatchObject({ status: 'succeeded', output: { due: 2, enqueued: 2, countries: null } });
    expect(seen.sort()).toEqual(['DE', 'NL']);
    const children = runs.filter((r) => r.parent_run_id === parent?.id);
    expect(children.map((r) => r.idempotency_key).sort()).toEqual(['growth.tenders:2026-10-08:DE', 'growth.tenders:2026-10-08:NL']);
    for (const c of children) expect(c).toMatchObject({ status: 'succeeded', trigger: 'queue', output: { status: 200, tenders_found: 1 } });

    // the reddit tiers share subreddits: each due subreddit is fetched once, by the first tier tick that reaches it
    const fetched = h.sources.requests.filter((r) => r.url.includes('pullpush')).map((r) => new URL(r.url).searchParams.get('subreddit'));
    expect(fetched.sort()).toEqual(['engineering', 'hardware', 'machining']);
  });

  it('value.countries narrows the fan-out to the canary connectors', async () => {
    const { h, scrapes } = world(['nl']);
    await runSchedule(h.env, SIX, { ports: h.ports, memo: new Set() });
    const seen: string[] = [];
    await deliver(h, scrapes, seen);
    expect(seen).toEqual(['NL']);
    expect(h.db.rows('agent_runs').filter((r) => String(r.idempotency_key).startsWith('growth.tenders:2026-10-08:')).map((r) => r.idempotency_key)).toEqual(['growth.tenders:2026-10-08:NL']);
  });
});
