// handleTenderScheduled (src/collectors/tenders.ts): one child run per connector (growth.tenders:<date>:<CC>, trigger
// queue, parent = the dispatcher's run) with the handler's counts; 5xx, the shim's deadline and throws retry after
// 300 s under the same child; the final delivery closes the child failed and dead-letters; 4xx fails and acks; flag
// off and shadow close the child skipped without running the handler; a final child acks without work. The last
// block runs the real api/tender-scan.js in-process (no network: an unknown country is refused before any I/O).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelHandler } from '../../../../shared/src/compat/vercel-node';
import { closeRun, EMPTY_USAGE } from '../../../src/agents/runs';
import { CONSUMER_TIMEOUT_MS, MAX_RETRIES, makeTenderScheduledHandler, RETRY_DELAY_SECONDS, tenderChildKey, tenderCounts } from '../../../src/collectors/tenders';
import * as phase2 from '../../../src/queues/scrapes';
import { testContext } from '../../helpers/ops';
import { collectorHarness, DATE, dispatcherRun, runRow, scrapeBody, testMessage, type CollectorHarness } from './harness';

interface Seen {
  method: string;
  url: string;
  contentType: string | undefined;
  body: unknown;
}

function fakeHandler(answer: (n: number) => { status: number; body?: unknown } | 'throw' | 'hang', seen: Seen[] = []): { load: () => Promise<{ default: VercelHandler }>; seen: Seen[] } {
  const handler: VercelHandler = (req, res) => {
    seen.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], body: req.body });
    const a = answer(seen.length);
    if (a === 'throw') throw new Error('handler exploded');
    if (a === 'hang') return new Promise(() => {});
    return res.status(a.status).json(a.body ?? {});
  };
  return { load: async () => ({ default: handler }), seen };
}

const OK_BODY = { success: true, country_code: 'NL', tenders_found: 4, tenders_new: 2, tenders_relevant: 1, errors: ['portal said: no'], duration_ms: 12 };

let h: CollectorHarness;
let parent: string;
let logs: string[];

beforeEach(async () => {
  h = collectorHarness();
  h.setFlag('agent.growth.tenders', { mode: 'assist' });
  parent = await dispatcherRun(h.db, 'growth.tenders', `growth.tenders:${DATE}`);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
});

function msgFor(cc: string, attempts = 1) {
  return testMessage(scrapeBody('tender-scheduled', { country_code: cc, date: DATE }, parent), attempts);
}

function child(cc: string) {
  return h.db.rows('agent_runs', ['idempotency_key', 'eq', tenderChildKey(DATE, cc)]);
}

describe('a due connector', () => {
  it('2xx: child run growth.tenders:<date>:<CC> (trigger queue, parent set) closed succeeded with the counts; acked', async () => {
    const f = fakeHandler(() => ({ status: 200, body: OK_BODY }));
    const msg = msgFor('nl');
    await makeTenderScheduledHandler({ load: f.load })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(msg.retried).toEqual([]);
    expect(f.seen).toEqual([{ method: 'POST', url: '/api/tender-scan', contentType: 'application/json', body: { country_code: 'nl' } }]);
    const rows = child('NL');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: 'growth.tenders', trigger: 'queue', parent_run_id: parent, status: 'succeeded', error: null });
    expect(rows[0].output).toEqual({ status: 200, country_code: 'NL', tenders_found: 4, tenders_new: 2, tenders_relevant: 1, errors: 1, duration_ms: 12 });
    expect(JSON.stringify(rows[0].output)).not.toContain('portal said');
    expect(runRow(h.db, parent).status).toBe('running'); // the dispatcher owns the parent
  });

  it('5xx: retry after 300 s under the same child; the next delivery continues it and succeeds', async () => {
    const f = fakeHandler((n) => (n === 1 ? { status: 500, body: { error: 'boom', country_code: 'DE' } } : { status: 200, body: { ...OK_BODY, country_code: 'DE' } }));
    const handler = makeTenderScheduledHandler({ load: f.load });
    const first = msgFor('DE', 1);
    await handler(first, h.env, testContext(), h.deps);
    expect(first.retried).toEqual([{ delaySeconds: 300 }]);
    expect(first.acked).toBe(0);
    const [running] = child('DE');
    expect(running.status).toBe('running');

    const second = msgFor('DE', 2);
    await handler(second, h.env, testContext(), h.deps);
    expect(second.acked).toBe(1);
    const rows = child('DE');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(running.id);
    expect(rows[0]).toMatchObject({ status: 'succeeded', output: { status: 200, tenders_new: 2 } });
    expect(f.seen).toHaveLength(2);
  });

  it('the final delivery (attempts 4) of a 5xx closes the child failed and dead-letters (retry without delay)', async () => {
    const f = fakeHandler(() => ({ status: 503 }));
    const msg = msgFor('FR', 4);
    await makeTenderScheduledHandler({ load: f.load })(msg, h.env, testContext(), h.deps);
    expect(msg.retried).toEqual([undefined]);
    expect(msg.acked).toBe(0);
    expect(child('FR')[0]).toMatchObject({ status: 'failed', error: 'handler_503' });
  });

  it('a throw retries after 300 s; on the final delivery the child closes failed (handler_threw)', async () => {
    const f = fakeHandler(() => 'throw');
    const handler = makeTenderScheduledHandler({ load: f.load });
    const m1 = msgFor('IT', 1);
    await handler(m1, h.env, testContext(), h.deps);
    expect(m1.retried).toEqual([{ delaySeconds: 300 }]);
    expect(child('IT')[0].status).toBe('running');
    const m4 = msgFor('IT', 4);
    await handler(m4, h.env, testContext(), h.deps);
    expect(m4.retried).toEqual([undefined]);
    expect(child('IT')[0]).toMatchObject({ status: 'failed', error: 'handler_threw' });
    expect(logs.join('\n')).not.toContain('handler exploded');
  });

  it('a module that fails to load retries like a throw', async () => {
    const msg = msgFor('ES');
    await makeTenderScheduledHandler({ load: () => Promise.reject(new Error('load failed')) })(msg, h.env, testContext(), h.deps);
    expect(msg.retried).toEqual([{ delaySeconds: 300 }]);
  });

  it('the shim deadline (504) retries', async () => {
    const f = fakeHandler(() => 'hang');
    const msg = msgFor('PL');
    await makeTenderScheduledHandler({ load: f.load, timeoutMs: 30 })(msg, h.env, testContext(), h.deps);
    expect(msg.retried).toEqual([{ delaySeconds: 300 }]);
    expect(child('PL')[0].status).toBe('running');
  });

  it('4xx: child failed handler_<status>, acked (the scan can never succeed)', async () => {
    const f = fakeHandler(() => ({ status: 400, body: { error: 'No connector for country: ZZ' } }));
    const msg = msgFor('ZZ');
    await makeTenderScheduledHandler({ load: f.load })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(child('ZZ')[0]).toMatchObject({ status: 'failed', error: 'handler_400', output: { status: 400, country_code: 'ZZ' } });
  });
});

describe('flag, shadow and redelivery', () => {
  it('flag off: child skipped {reason: flag_off}; the handler is never loaded', async () => {
    h.setFlag('agent.growth.tenders', { enabled: false });
    const load = vi.fn();
    const msg = msgFor('NL');
    await makeTenderScheduledHandler({ load })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(load).not.toHaveBeenCalled();
    expect(child('NL')[0]).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', country_code: 'NL' }, parent_run_id: parent });
  });

  it('shadow: child skipped {reason: shadow}; the handler never runs (it writes and alerts itself)', async () => {
    h.setFlag('agent.growth.tenders', { mode: 'shadow' });
    const load = vi.fn();
    const msg = msgFor('DE');
    await makeTenderScheduledHandler({ load })(msg, h.env, testContext(), h.deps);
    expect(load).not.toHaveBeenCalled();
    expect(child('DE')[0]).toMatchObject({ status: 'skipped', output: { reason: 'shadow', country_code: 'DE' } });
  });

  it('a child that is already final is acked without running the handler', async () => {
    const f = fakeHandler(() => ({ status: 200, body: OK_BODY }));
    const handler = makeTenderScheduledHandler({ load: f.load });
    await handler(msgFor('NL'), h.env, testContext(), h.deps);
    const again = msgFor('NL', 2);
    await handler(again, h.env, testContext(), h.deps);
    expect(again.acked).toBe(1);
    expect(f.seen).toHaveLength(1);
  });

  it('a child closed by the operator (cancelled) is not re-run', async () => {
    const f = fakeHandler(() => ({ status: 200, body: OK_BODY }));
    const handler = makeTenderScheduledHandler({ load: f.load });
    const first = msgFor('SE', 1);
    await makeTenderScheduledHandler({ load: fakeHandler(() => ({ status: 502 })).load })(first, h.env, testContext(), h.deps);
    await closeRun(h.db, String(child('SE')[0].id), { status: 'cancelled' }, { ...EMPTY_USAGE, by_step: {} });
    const second = msgFor('SE', 2);
    await handler(second, h.env, testContext(), h.deps);
    expect(second.acked).toBe(1);
    expect(f.seen).toHaveLength(0);
  });

  it('invalid params are acked without a run', async () => {
    const msg = testMessage(scrapeBody('tender-scheduled', { country_code: 'N1', date: DATE }, parent));
    const load = vi.fn();
    await makeTenderScheduledHandler({ load })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(load).not.toHaveBeenCalled();
    expect(h.db.rows('agent_runs').filter((r) => r.parent_run_id === parent)).toEqual([]);
  });
});

describe('the Phase 2 consumer values', () => {
  it('deadline 840 s, retry delay 300 s and 3 retries equal src/queues/scrapes.ts', () => {
    expect({ CONSUMER_TIMEOUT_MS, RETRY_DELAY_SECONDS, MAX_RETRIES }).toEqual({
      CONSUMER_TIMEOUT_MS: phase2.CONSUMER_TIMEOUT_MS,
      RETRY_DELAY_SECONDS: phase2.RETRY_DELAY_SECONDS,
      MAX_RETRIES: phase2.MAX_RETRIES,
    });
    expect(phase2.SCRAPE_FUNCTION_PATHS['tender-scan']).toBe('/api/tender-scan');
  });
});

describe('tenderCounts', () => {
  it('keeps numbers and the country code only', async () => {
    const res = new Response(JSON.stringify({ ...OK_BODY, country_code: 'nl<script>', extra: 'x' }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    expect(await tenderCounts(res)).toEqual({ tenders_found: 4, tenders_new: 2, tenders_relevant: 1, duration_ms: 12, errors: 1 });
    expect(await tenderCounts(new Response('oops', { headers: { 'content-type': 'text/plain' } }))).toEqual({});
  });
});

describe('the real api/tender-scan.js, in-process', () => {
  let network: string[];
  beforeEach(() => {
    network = [];
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-value');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      network.push(String(input instanceof Request ? input.url : input));
      throw new Error('network is not allowed in this test');
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('an unknown country is refused by the handler (400) before any I/O: child failed handler_400, acked', async () => {
    const msg = msgFor('XX');
    await makeTenderScheduledHandler()(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(child('XX')[0]).toMatchObject({ status: 'failed', error: 'handler_400', output: { status: 400 } });
    expect(network).toEqual([]);
  });
});
