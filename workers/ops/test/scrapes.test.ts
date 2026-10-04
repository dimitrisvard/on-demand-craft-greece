// Queue "scrapes": enqueueScrape builds and sends one v1 JSON message; the consumer runs the same handler through
// the shim with a synthetic POST and maps its outcome to ack (status < 500) or retry after 300 s (5xx, 504, throw,
// failed module load, invalid message), naming the final delivery that goes to the dead-letter queue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelHandler } from '../../shared/src/compat/vercel-node';
import { MAX_MESSAGE_BYTES, enqueueScrape, type ScrapeMessage } from '../src/queues/messages';
import {
  CONSUMER_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_DELAY_SECONDS,
  SCRAPE_FUNCTION_PATHS,
  createScrapesConsumer,
  invalidMessageReason,
  scrapesConsumer,
} from '../src/queues/scrapes';
import { opsEnv, recordingQueue, testContext } from './helpers/ops';

const defaults = vi.hoisted(() => ({ seen: [] as Array<{ module: string; url: string; body: unknown }> }));

vi.mock('../../../api/tender-scan.js', () => ({
  default: (req: any, res: any) => {
    defaults.seen.push({ module: 'tender-scan', url: req.url, body: req.body });
    res.status(200).json({ success: true });
  },
}));
vi.mock('../../../api/funded-startups.js', () => ({
  default: (req: any, res: any) => {
    defaults.seen.push({ module: 'funded-startups', url: req.url, body: req.body });
    res.status(200).json({ success: true });
  },
}));

interface FakeMessage {
  id: string;
  timestamp: Date;
  body: unknown;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function message(body: unknown, attempts = 1, id = 'msg-1'): FakeMessage {
  return { id, timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function batchOf(...messages: FakeMessage[]): MessageBatch<ScrapeMessage> {
  return { messages, queue: 'scrapes', metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, retryAll: vi.fn(), ackAll: vi.fn() } as unknown as MessageBatch<ScrapeMessage>;
}

function job(kind: ScrapeMessage['kind'], params: Record<string, unknown>, runId = '11111111-2222-4333-8444-555555555555'): ScrapeMessage {
  return { v: 1, kind, params, run_id: runId, enqueued_at: '2026-10-04T06:00:00.000Z', requested_by: 'MACHINE:collector' };
}

interface HandlerRun { url: string; method: string; contentType: string | undefined; body: unknown }

let runs: HandlerRun[];
let logs: string[];
let errors: string[];

function recording(answer: (res: any) => unknown): VercelHandler {
  return (req, res) => {
    runs.push({ url: req.url, method: req.method, contentType: req.headers['content-type'], body: req.body });
    return answer(res);
  };
}

function consumerWith(tenderScan: VercelHandler, fundedScan: VercelHandler = recording((res) => res.status(200).json({}))) {
  return createScrapesConsumer({
    'tender-scan': async () => ({ default: tenderScan }),
    'funded-scan': async () => ({ default: fundedScan }),
  });
}

beforeEach(() => {
  runs = [];
  logs = [];
  errors = [];
  defaults.seen = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('enqueueScrape', () => {
  it('sends one v1 JSON message and returns its run_id', async () => {
    const queue = recordingQueue();
    const before = Date.now();
    const runId = await enqueueScrape(opsEnv({ SCRAPES: queue.binding }), 'tender-scan', { country_code: 'NL' }, 'MACHINE:collector');
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(queue.sent).toHaveLength(1);
    const { body, options } = queue.sent[0];
    expect(options).toEqual({ contentType: 'json' });
    expect(body).toEqual({ v: 1, kind: 'tender-scan', params: { country_code: 'NL' }, run_id: runId, enqueued_at: body.enqueued_at, requested_by: 'MACHINE:collector' });
    expect(Date.parse(body.enqueued_at)).toBeGreaterThanOrEqual(before - 1);
    expect(logs.join('\n')).toContain(`[microns-ops] scrapes enqueued kind=tender-scan run_id=${runId} requested_by=MACHINE:collector`);
  });

  it('every run_id is new', async () => {
    const queue = recordingQueue();
    const env = opsEnv({ SCRAPES: queue.binding });
    const ids = await Promise.all([1, 2, 3].map(() => enqueueScrape(env, 'funded-scan', { priority: 2 }, 'STAFF')));
    expect(new Set(ids).size).toBe(3);
  });

  it('refuses a message over the size limit before sending it', async () => {
    const queue = recordingQueue();
    const params = { blob: 'x'.repeat(MAX_MESSAGE_BYTES) };
    await expect(enqueueScrape(opsEnv({ SCRAPES: queue.binding }), 'tender-scan', params, 'MACHINE:collector')).rejects.toThrow(/too large/);
    expect(queue.sent).toEqual([]);
    expect(MAX_MESSAGE_BYTES).toBeLessThanOrEqual(128_000 - 100);
  });
});

describe('consumer: one synthetic POST through the same handler', () => {
  it('tender-scan: POST /api/tender-scan with the params as JSON; 200 -> ack and a log line with the counts', async () => {
    const consumer = consumerWith(recording((res) => res.status(200).json({ success: true, tenders_found: 7, tenders_new: 2, tenders_relevant: 1, errors: ['a'] })));
    const m = message(job('tender-scan', { country_code: 'NL' }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(runs).toEqual([{ url: '/api/tender-scan', method: 'POST', contentType: 'application/json', body: { country_code: 'NL' } }]);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(logs).toContain(
      '[microns-ops] scrapes tender-scan country_code=NL status=200 found=7 new=2 relevant=1 errors=1 run_id=11111111-2222-4333-8444-555555555555 attempts=1 outcome=ack',
    );
  });

  it('funded-scan: POST /api/funded-startups through its handler', async () => {
    const funded = recording((res) => res.status(200).json({ success: true, feeds_scanned: 9, articles_found: 40, articles_relevant: 5, startups_new: 3 }));
    const consumer = consumerWith(recording((res) => res.status(500).end()), funded);
    const m = message(job('funded-scan', { priority: 2 }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(runs).toEqual([{ url: '/api/funded-startups', method: 'POST', contentType: 'application/json', body: { priority: 2 } }]);
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(logs.find((l) => l.startsWith('[microns-ops] scrapes funded-scan'))).toBe(
      '[microns-ops] scrapes funded-scan priority=2 status=200 feeds=9 articles=40 relevant=5 new=3 run_id=11111111-2222-4333-8444-555555555555 attempts=1 outcome=ack',
    );
  });

  it('4xx -> ack (the job can never succeed)', async () => {
    const consumer = consumerWith(recording((res) => res.status(400).json({ error: 'No connector for country: ZZ' })));
    const m = message(job('tender-scan', { country_code: 'ZZ' }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it('5xx -> retry after 300 s, no ack', async () => {
    const consumer = consumerWith(recording((res) => res.status(500).json({ error: 'portal down', country_code: 'NL' })));
    const m = message(job('tender-scan', { country_code: 'NL' }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(m.ack).not.toHaveBeenCalled();
    expect(logs.find((l) => l.includes('scrapes tender-scan'))).toContain('status=500');
    expect(logs.find((l) => l.includes('scrapes tender-scan'))).toContain('outcome=retry');
  });

  it('a thrown error -> retry', async () => {
    const consumer = consumerWith(() => {
      throw new TypeError('boom');
    });
    const m = message(job('tender-scan', { country_code: 'NL' }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: RETRY_DELAY_SECONDS });
    expect(m.ack).not.toHaveBeenCalled();
    expect(logs.find((l) => l.includes('scrapes tender-scan'))).toContain('status=threw error=TypeError');
  });

  it('a module that fails to load -> retry, no handler runs', async () => {
    const consumer = createScrapesConsumer({
      'tender-scan': async () => {
        throw new Error('module-scope failure');
      },
      'funded-scan': async () => ({ default: recording((res) => res.status(200).end()) }),
    });
    const m = message(job('tender-scan', { country_code: 'NL' }));
    await consumer(batchOf(m), opsEnv(), testContext());
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(runs).toEqual([]);
  });

  it('a handler that never ends -> the shim answers 504 after 840 s -> retry', async () => {
    vi.useFakeTimers();
    const consumer = consumerWith(recording(() => new Promise(() => {})));
    const m = message(job('tender-scan', { country_code: 'NL' }));
    let done = false;
    const run = consumer(batchOf(m), opsEnv(), testContext()).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(CONSUMER_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(logs.find((l) => l.includes('scrapes tender-scan'))).toContain('status=504');
    expect(CONSUMER_TIMEOUT_MS).toBe(840_000);
  });

  it('the delivery after the last retry is logged as going to the dead-letter queue', async () => {
    const consumer = consumerWith(recording((res) => res.status(502).end()));
    const third = message(job('tender-scan', { country_code: 'NL' }), MAX_RETRIES);
    const last = message(job('tender-scan', { country_code: 'NL' }), MAX_RETRIES + 1);
    await consumer(batchOf(third), opsEnv(), testContext());
    await consumer(batchOf(last), opsEnv(), testContext());
    const lines = logs.filter((l) => l.includes('scrapes tender-scan'));
    expect(lines[0]).toContain(`attempts=${MAX_RETRIES} outcome=retry`);
    expect(lines[1]).toContain(`attempts=${MAX_RETRIES + 1} outcome=dead-letter`);
    expect(last.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it('each message of a batch is acked or retried on its own, in order', async () => {
    let n = 0;
    const consumer = consumerWith(recording((res) => res.status(n++ === 0 ? 200 : 503).end()));
    const a = message(job('tender-scan', { country_code: 'NL' }), 1, 'a');
    const b = message(job('tender-scan', { country_code: 'DE' }), 1, 'b');
    await consumer(batchOf(a, b), opsEnv(), testContext());
    expect(a.ack).toHaveBeenCalledTimes(1);
    expect(b.retry).toHaveBeenCalledTimes(1);
    expect(runs.map((r) => (r.body as { country_code: string }).country_code)).toEqual(['NL', 'DE']);
  });

  it('work after the answer is handed to ctx.waitUntil', async () => {
    const ctx = testContext();
    const consumer = consumerWith((_req, res) => {
      res.status(200).json({ success: true });
      return new Promise((resolve) => setTimeout(resolve, 5));
    });
    await consumer(batchOf(message(job('tender-scan', { country_code: 'NL' }))), opsEnv(), ctx);
    expect(ctx.pending).toHaveLength(1);
    await Promise.all(ctx.pending);
  });
});

describe('consumer: invalid messages run no handler and are retried (end in the DLQ)', () => {
  const invalid: Array<[string, unknown, string]> = [
    ['not an object', 'tender-scan NL', 'not an object'],
    ['null', null, 'not an object'],
    ['version 2', { ...job('tender-scan', { country_code: 'NL' }), v: 2 }, 'unsupported version'],
    ['unknown kind', { ...job('tender-scan', {}), kind: 'gsc-bulk-inspect' }, 'unknown kind'],
    ['prototype kind', { ...job('tender-scan', {}), kind: 'toString' }, 'unknown kind'],
    ['params array', { ...job('tender-scan', {}), params: ['NL'] }, 'params not an object'],
    ['run_id missing', { ...job('tender-scan', {}), run_id: undefined }, 'missing run_id'],
  ];
  for (const [name, body, reason] of invalid) {
    it(name, async () => {
      expect(invalidMessageReason(body)).toBe(reason);
      const consumer = consumerWith(recording((res) => res.status(200).end()));
      const m = message(body);
      await consumer(batchOf(m), opsEnv(), testContext());
      expect(runs).toEqual([]);
      expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
      expect(m.ack).not.toHaveBeenCalled();
      expect(errors.join('\n')).toContain('[microns-ops] scrapes rejected message id=msg-1');
    });
  }
});

describe('default consumer', () => {
  it('maps tender-scan to api/tender-scan.js and funded-scan to api/funded-startups.js', async () => {
    expect(SCRAPE_FUNCTION_PATHS).toEqual({ 'tender-scan': '/api/tender-scan', 'funded-scan': '/api/funded-startups' });
    const a = message(job('tender-scan', { country_code: 'NL' }), 1, 'a');
    const b = message(job('funded-scan', { priority: 1 }), 1, 'b');
    await scrapesConsumer(batchOf(a, b), opsEnv(), testContext());
    expect(defaults.seen).toEqual([
      { module: 'tender-scan', url: '/api/tender-scan', body: { country_code: 'NL' } },
      { module: 'funded-startups', url: '/api/funded-startups', body: { priority: 1 } },
    ]);
    expect(a.ack).toHaveBeenCalledTimes(1);
    expect(b.ack).toHaveBeenCalledTimes(1);
  });
});
