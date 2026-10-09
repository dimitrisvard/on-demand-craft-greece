// The Phase 5 envelope on the queue "scrapes" (src/queues/scrapes-p5.ts): the typed send (v 1, enqueued_at,
// requested_by, params checked against the kind, size limit), the kind table with its fixed handlers, an invalid
// body logged and acked, and the fallback when a handler throws instead of settling its message.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsEnv } from '../../../src/env';
import type { P5ScrapeKind, P5ScrapeMessage } from '../../../src/queues/messages';
import { agentBindings, agentPorts, FakeQueue } from '../../helpers/agent-env';
import { opsEnv, testContext } from '../../helpers/ops';

const handlers = vi.hoisted(() => ({
  reddit: vi.fn(async () => {}),
  hn: vi.fn(async () => {}),
  tenders: vi.fn(async () => {}),
  xometry: vi.fn(async () => {}),
}));
vi.mock('../../../src/collectors/reddit', () => ({ handleRedditTier: handlers.reddit }));
vi.mock('../../../src/collectors/hn', () => ({ handleHnScan: handlers.hn }));
vi.mock('../../../src/collectors/tenders', () => ({ handleTenderScheduled: handlers.tenders }));
vi.mock('../../../src/xometry/queue', () => ({ handleXometryScan: handlers.xometry }));

const mod = await import('../../../src/queues/scrapes-p5');
const { sendP5Scrape, makeScrapesP5Consumer, P5_SCRAPE_HANDLERS, p5ScrapeParamsValid, TENDER_RETRY_DELAY_S } = mod;

const RUN_ID = '5e0c3f4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';
const SLOT = '2026-10-08T07:00Z';

function envWith(queue: FakeQueue<P5ScrapeMessage>): OpsEnv {
  return opsEnv({ ...agentBindings(), SCRAPES: queue as unknown as OpsEnv['SCRAPES'] });
}

interface TestMessage {
  id: string;
  body: unknown;
  attempts: number;
  acked: number;
  retried: Array<{ delaySeconds?: number } | undefined>;
  ack(): void;
  retry(o?: { delaySeconds?: number }): void;
}

function message(body: unknown, id = 'm1'): TestMessage {
  const m: TestMessage = {
    id,
    body,
    attempts: 1,
    acked: 0,
    retried: [],
    ack() {
      m.acked++;
    },
    retry(o) {
      m.retried.push(o);
    },
  };
  return m;
}

function batch(messages: TestMessage[]): MessageBatch<unknown> {
  return { queue: 'scrapes', messages, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>;
}

const bodyOf = (kind: P5ScrapeKind): P5ScrapeMessage => ({
  v: 1,
  kind,
  params: kind === 'reddit-tier' ? { tier: 1, max: 40, slot: SLOT } : kind === 'tender-scheduled' ? { country_code: 'NL', date: '2026-10-08' } : { slot: SLOT },
  run_id: RUN_ID,
  enqueued_at: '2026-10-08T07:00:01.000Z',
  requested_by: 'schedule',
});

let errors: string[];
let logs: string[];
beforeEach(() => {
  for (const h of Object.values(handlers)) h.mockReset();
  errors = [];
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => vi.restoreAllMocks());

describe('sendP5Scrape', () => {
  it('sends {v: 1, kind, params, run_id, enqueued_at, requested_by: schedule} as JSON and logs kind and run id only', async () => {
    const queue = new FakeQueue<P5ScrapeMessage>();
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 8, 7, 0, 3), toFake: ['Date'] });
    try {
      await sendP5Scrape(envWith(queue), { kind: 'reddit-tier', params: { tier: 2, max: 40, slot: SLOT }, run_id: RUN_ID });
    } finally {
      vi.useRealTimers();
    }
    expect(queue.sent).toEqual([
      { body: { v: 1, kind: 'reddit-tier', params: { tier: 2, max: 40, slot: SLOT }, run_id: RUN_ID, enqueued_at: '2026-10-08T07:00:03.000Z', requested_by: 'schedule' }, options: { contentType: 'json' } },
    ]);
    expect(logs).toEqual([`[microns-ops] scrapes enqueued kind=reddit-tier run_id=${RUN_ID} requested_by=schedule`]);
  });

  it("requested_by 'manual' is kept", async () => {
    const queue = new FakeQueue<P5ScrapeMessage>();
    await sendP5Scrape(envWith(queue), { kind: 'hn-scan', params: { slot: SLOT }, run_id: RUN_ID, requested_by: 'manual' });
    expect(queue.sent[0]?.body.requested_by).toBe('manual');
  });

  it('refuses params of the wrong shape, an unknown kind or an empty run id before sending', async () => {
    const queue = new FakeQueue<P5ScrapeMessage>();
    const env = envWith(queue);
    const bad: Array<Parameters<typeof sendP5Scrape>[1]> = [
      { kind: 'reddit-tier', params: { tier: 4 as 1, max: 40, slot: SLOT }, run_id: RUN_ID },
      { kind: 'reddit-tier', params: { tier: 1, max: 50 as 40, slot: SLOT }, run_id: RUN_ID },
      { kind: 'hn-scan', params: { slot: '2026-10-08T07:00:00Z' }, run_id: RUN_ID },
      { kind: 'tender-scheduled', params: { country_code: 'N', date: '2026-10-08' }, run_id: RUN_ID },
      { kind: 'tender-scheduled', params: { country_code: 'NL', date: '08.10.2026' }, run_id: RUN_ID },
      { kind: 'xometry-scan', params: { slot: SLOT }, run_id: '' },
      { kind: 'tender-scan' as P5ScrapeKind, params: { slot: SLOT }, run_id: RUN_ID },
    ];
    for (const m of bad) await expect(sendP5Scrape(env, m), JSON.stringify(m)).rejects.toThrow(/invalid/);
    expect(queue.sent).toEqual([]);
  });

  it('refuses a body above the message limit', async () => {
    const queue = new FakeQueue<P5ScrapeMessage>();
    const huge = { slot: SLOT, pad: 'x'.repeat(130_000) } as unknown as P5ScrapeMessage['params'];
    await expect(sendP5Scrape(envWith(queue), { kind: 'hn-scan', params: huge, run_id: RUN_ID })).rejects.toThrow(/too large/);
    expect(queue.sent).toEqual([]);
  });

  it('a queue error propagates (the dispatcher closes the run enqueue_failed)', async () => {
    const queue = new FakeQueue<P5ScrapeMessage>();
    queue.failWith = new Error('queue down');
    await expect(sendP5Scrape(envWith(queue), { kind: 'hn-scan', params: { slot: SLOT }, run_id: RUN_ID })).rejects.toThrow('queue down');
  });

  it('params check per kind', () => {
    expect(p5ScrapeParamsValid('reddit-tier', { tier: 3, max: 40, slot: SLOT })).toBe(true);
    expect(p5ScrapeParamsValid('hn-scan', null)).toBe(false);
    expect(p5ScrapeParamsValid('xometry-scan', [SLOT])).toBe(false);
    expect(p5ScrapeParamsValid('tender-scheduled', { country_code: 'GR', date: '2026-10-08' })).toBe(true);
  });
});

describe('scrapesP5Consumer kind table', () => {
  it('the fixed table: reddit-tier, hn-scan, tender-scheduled, xometry-scan -> the four unit handlers', () => {
    expect(P5_SCRAPE_HANDLERS).toEqual({ 'reddit-tier': handlers.reddit, 'hn-scan': handlers.hn, 'tender-scheduled': handlers.tenders, 'xometry-scan': handlers.xometry });
    expect(Object.isFrozen(P5_SCRAPE_HANDLERS)).toBe(true);
  });

  it.each([
    ['reddit-tier', 'reddit'],
    ['hn-scan', 'hn'],
    ['tender-scheduled', 'tenders'],
    ['xometry-scan', 'xometry'],
  ] as const)('%s is handed to its handler with the message, env and ctx (the handler settles it)', async (kind, name) => {
    const consumer = mod.scrapesP5Consumer;
    const m = message(bodyOf(kind));
    const env = envWith(new FakeQueue());
    const ctx = testContext();
    await consumer(batch([m]), env, ctx);
    expect(handlers[name]).toHaveBeenCalledExactlyOnceWith(m, env, ctx);
    for (const [other, spy] of Object.entries(handlers)) if (other !== name) expect(spy).not.toHaveBeenCalled();
    expect(m.acked).toBe(0);
    expect(m.retried).toEqual([]);
  });

  it('an invalid body is logged by message id and acked; no handler runs', async () => {
    const bodies = [{ ...bodyOf('hn-scan'), v: 2 }, { kind: 'hn-scan' }, null, 'hn-scan'];
    const messages = bodies.map((b, i) => message(b, `bad-${i}`));
    await mod.scrapesP5Consumer(batch(messages), envWith(new FakeQueue()), testContext());
    for (const m of messages) expect(m.acked).toBe(1);
    for (const spy of Object.values(handlers)) expect(spy).not.toHaveBeenCalled();
    expect(errors).toEqual(messages.map((m) => `[microns-ops] scrapes-p5 invalid message acked message_id=${m.id}`));
  });

  it('messages of a batch are handled one after another', async () => {
    const order: string[] = [];
    handlers.hn.mockImplementation(async () => {
      order.push('hn start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('hn end');
    });
    handlers.reddit.mockImplementation(async () => void order.push('reddit'));
    await mod.scrapesP5Consumer(batch([message(bodyOf('hn-scan'), 'a'), message(bodyOf('reddit-tier'), 'b')]), envWith(new FakeQueue()), testContext());
    expect(order).toEqual(['hn start', 'hn end', 'reddit']);
  });
});

describe('a handler that throws instead of settling its message', () => {
  async function seededRun(status: 'running' | 'succeeded') {
    const ports = agentPorts();
    const { openRun, closeRun, EMPTY_USAGE } = await import('../../../src/agents/runs');
    const run = await openRun(ports.db, { agent: 'growth.hn', trigger: 'cron', idempotency_key: `growth.hn:${SLOT}` });
    if (status === 'succeeded') await closeRun(ports.db, run.run_id, { status: 'succeeded', output: { scanned: 1 } }, { ...EMPTY_USAGE, by_step: {} });
    return { ports, runId: run.run_id };
  }

  it('hn-scan: its still running run is closed failed with handler_error and the message is acked', async () => {
    const { ports, runId } = await seededRun('running');
    handlers.hn.mockRejectedValueOnce(new TypeError('cannot read'));
    const consumer = makeScrapesP5Consumer({ ports: () => ports });
    const m = message({ ...bodyOf('hn-scan'), run_id: runId });
    await consumer(batch([m]), envWith(new FakeQueue()), testContext());
    expect(m.acked).toBe(1);
    expect(m.retried).toEqual([]);
    expect((ports.db.tables.agent_runs as Array<Record<string, unknown>>).find((r) => r.id === runId)).toMatchObject({ status: 'failed', error: 'handler_error' });
    expect(errors).toContain(`[microns-ops] scrapes-p5 handler threw kind=hn-scan run_id=${runId} message_id=m1 error=TypeError`);
  });

  it('a run the handler already closed is left as it is', async () => {
    const { ports, runId } = await seededRun('succeeded');
    handlers.hn.mockRejectedValueOnce(new Error('after close'));
    const m = message({ ...bodyOf('hn-scan'), run_id: runId });
    await makeScrapesP5Consumer({ ports: () => ports })(batch([m]), envWith(new FakeQueue()), testContext());
    expect((ports.db.tables.agent_runs as Array<Record<string, unknown>>).find((r) => r.id === runId)).toMatchObject({ status: 'succeeded', output: { scanned: 1 } });
    expect(m.acked).toBe(1);
  });

  it('tender-scheduled is retried after 300 s (its own rule for a throw); no run is touched', async () => {
    handlers.tenders.mockRejectedValueOnce(new Error('handler crashed'));
    const portsFactory = vi.fn(() => agentPorts());
    const m = message(bodyOf('tender-scheduled'));
    await makeScrapesP5Consumer({ ports: portsFactory })(batch([m]), envWith(new FakeQueue()), testContext());
    expect(TENDER_RETRY_DELAY_S).toBe(300);
    expect(m.retried).toEqual([{ delaySeconds: 300 }]);
    expect(m.acked).toBe(0);
    expect(portsFactory).not.toHaveBeenCalled();
  });

  it('a failing fallback close is logged and the message is still acked', async () => {
    handlers.xometry.mockRejectedValueOnce(new Error('x'));
    const m = message(bodyOf('xometry-scan'));
    await makeScrapesP5Consumer({ ports: () => { throw new Error('no ports'); } })(batch([m]), envWith(new FakeQueue()), testContext());
    expect(m.acked).toBe(1);
    expect(errors.some((e) => e.startsWith('[microns-ops] scrapes-p5 run close failed kind=xometry-scan'))).toBe(true);
  });
});
