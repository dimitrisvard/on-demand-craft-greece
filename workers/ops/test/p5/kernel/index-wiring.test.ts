// Phase 5 wiring of the microns-ops entry module (unit K5): the queues translations and outbound-mail reach their
// consumers; a scrapes message with a Phase 5 kind reaches scrapesP5Consumer before the Phase 4 directory-scan branch
// and the Phase 2 consumer, while tender-scan and funded-scan stay with the Phase 2 consumer; the every-minute cron
// runs the schedule table beside the flags sync (a failure is logged, never rethrown); every class named in
// wrangler.jsonc is exported, and ContainerProxy is the object of the single '@cloudflare/containers' copy.

import { readFileSync } from 'node:fs';
import * as containers from '@cloudflare/containers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryScanMessage, P5ScrapeMessage, ScrapeMessage } from '../../../src/queues/messages';
import { opsEnv, testContext } from '../../helpers/ops';

const spies = vi.hoisted(() => ({
  handleMcp: vi.fn(async () => new Response('mcp', { status: 200 })),
  cadJobsConsumer: vi.fn(async () => {}),
  agentEventsConsumer: vi.fn(async () => {}),
  directoryScanConsumer: vi.fn(async () => {}),
  scrapesConsumer: vi.fn(async () => {}),
  scrapesP5Consumer: vi.fn(async () => {}),
  translationsConsumer: vi.fn(async () => {}),
  outboundMailConsumer: vi.fn(async () => {}),
  flagsSyncTick: vi.fn(async () => {}),
  dispatcherTick: vi.fn(async () => {}),
  runSchedule: vi.fn(async () => ({ fired: [] })),
}));

vi.mock('../../../src/mcp/index', () => ({ handleMcp: spies.handleMcp }));
vi.mock('../../../src/queues/cad-jobs', () => ({ cadJobsConsumer: spies.cadJobsConsumer }));
vi.mock('../../../src/queues/agent-events', () => ({ agentEventsConsumer: spies.agentEventsConsumer }));
vi.mock('../../../src/queues/directory-scan', () => ({ directoryScanConsumer: spies.directoryScanConsumer }));
vi.mock('../../../src/queues/scrapes', () => ({ scrapesConsumer: spies.scrapesConsumer }));
vi.mock('../../../src/queues/scrapes-p5', () => ({ scrapesP5Consumer: spies.scrapesP5Consumer }));
vi.mock('../../../src/queues/translations', () => ({ translationsConsumer: spies.translationsConsumer }));
vi.mock('../../../src/queues/outbound-mail', () => ({ outboundMailConsumer: spies.outboundMailConsumer }));
vi.mock('../../../src/cron/flags-sync', () => ({ flagsSyncTick: spies.flagsSyncTick }));
vi.mock('../../../src/cron/dispatcher', () => ({ dispatcherTick: spies.dispatcherTick }));
vi.mock('../../../src/cron/run-schedule', () => ({ runSchedule: spies.runSchedule }));

const index = await import('../../../src/index');
const worker = index.default;

const RUN_ID = '5e0c3f4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';
const ENQUEUED_AT = '2026-10-08T07:00:00.000Z';

const p5Messages: P5ScrapeMessage[] = [
  { v: 1, kind: 'reddit-tier', params: { tier: 1, max: 40, slot: '2026-10-08T07:00Z' }, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'schedule' },
  { v: 1, kind: 'hn-scan', params: { slot: '2026-10-08T07:00Z' }, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'schedule' },
  { v: 1, kind: 'tender-scheduled', params: { country_code: 'NL', date: '2026-10-08' }, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'schedule' },
  { v: 1, kind: 'xometry-scan', params: { slot: '2026-10-08T06:00Z' }, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'schedule' },
];
const phase2Messages: ScrapeMessage[] = [
  { v: 1, kind: 'tender-scan', params: { country_code: 'NL' }, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'MACHINE:collector' },
  { v: 1, kind: 'funded-scan', params: {}, run_id: RUN_ID, enqueued_at: ENQUEUED_AT, requested_by: 'STAFF' },
];
const directoryScan: DirectoryScanMessage = {
  v: 1,
  kind: 'directory-scan',
  params: { url: 'https://directory.example.com/search?q=laser', source: 'europages', max_pages: 2, enrich_profiles: false },
  run_id: RUN_ID,
  enqueued_at: ENQUEUED_AT,
  requested_by: 'MACHINE:mcp',
};

function batch(queue: string, bodies: unknown[]): MessageBatch<unknown> {
  const messages = bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(0), body, attempts: 1, ack() {}, retry() {} }));
  return { queue, messages, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>;
}

function controller(cron: string, scheduledTime = Date.UTC(2026, 9, 8, 7, 0)): ScheduledController {
  return { cron, scheduledTime, noRetry() {} } as unknown as ScheduledController;
}

let errors: string[];

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queue(): Phase 5 queues', () => {
  it('translations -> translationsConsumer with the batch, env and ctx', async () => {
    const b = batch('translations', [{ v: 1 }]);
    const env = opsEnv();
    const ctx = testContext();
    await worker.queue(b, env, ctx);
    expect(spies.translationsConsumer).toHaveBeenCalledExactlyOnceWith(b, env, ctx);
    for (const other of [spies.outboundMailConsumer, spies.scrapesConsumer, spies.scrapesP5Consumer, spies.directoryScanConsumer]) expect(other).not.toHaveBeenCalled();
  });

  it('outbound-mail -> outboundMailConsumer with the batch, env and ctx', async () => {
    const b = batch('outbound-mail', [{ v: 1 }]);
    const env = opsEnv();
    const ctx = testContext();
    await worker.queue(b, env, ctx);
    expect(spies.outboundMailConsumer).toHaveBeenCalledExactlyOnceWith(b, env, ctx);
    for (const other of [spies.translationsConsumer, spies.scrapesConsumer, spies.scrapesP5Consumer]) expect(other).not.toHaveBeenCalled();
  });
});

describe('queue(): the Phase 5 envelope on scrapes', () => {
  it.each(p5Messages.map((m) => [m.kind, m] as const))('%s -> scrapesP5Consumer (not the Phase 2 or Phase 4 consumer)', async (_kind, message) => {
    const b = batch('scrapes', [message]);
    const env = opsEnv();
    const ctx = testContext();
    await worker.queue(b, env, ctx);
    expect(spies.scrapesP5Consumer).toHaveBeenCalledExactlyOnceWith(b, env, ctx);
    expect(spies.scrapesConsumer).not.toHaveBeenCalled();
    expect(spies.directoryScanConsumer).not.toHaveBeenCalled();
  });

  it('a Phase 5 kind with a malformed envelope still reaches scrapesP5Consumer, which logs and acks it', async () => {
    await worker.queue(batch('scrapes', [{ ...p5Messages[1], v: 2 }]), opsEnv(), testContext());
    expect(spies.scrapesP5Consumer).toHaveBeenCalledOnce();
    expect(spies.scrapesConsumer).not.toHaveBeenCalled();
  });

  it.each(phase2Messages.map((m) => [m.kind, m] as const))('%s stays with the Phase 2 scrapesConsumer', async (_kind, message) => {
    const b = batch('scrapes', [message]);
    const env = opsEnv();
    const ctx = testContext();
    await worker.queue(b, env, ctx);
    expect(spies.scrapesConsumer).toHaveBeenCalledExactlyOnceWith(b, env, ctx);
    expect(spies.scrapesP5Consumer).not.toHaveBeenCalled();
  });

  it('directory-scan stays with directoryScanConsumer; a mixed or empty batch goes to the Phase 2 consumer', async () => {
    await worker.queue(batch('scrapes', [directoryScan]), opsEnv(), testContext());
    expect(spies.directoryScanConsumer).toHaveBeenCalledOnce();
    await worker.queue(batch('scrapes', [p5Messages[0], phase2Messages[0]]), opsEnv(), testContext());
    await worker.queue(batch('scrapes', []), opsEnv(), testContext());
    await worker.queue(batch('scrapes', [{ kind: 42 }]), opsEnv(), testContext());
    expect(spies.scrapesConsumer).toHaveBeenCalledTimes(3);
    expect(spies.scrapesP5Consumer).not.toHaveBeenCalled();
  });
});

describe('scheduled(): the schedule table on the every-minute cron', () => {
  it("'* * * * *' runs flagsSyncTick and runSchedule(env, scheduledTime), each in its own waitUntil", async () => {
    const ctx = testContext();
    const c = controller('* * * * *');
    const env = opsEnv();
    await worker.scheduled(c, env, ctx);
    expect(ctx.pending).toHaveLength(2);
    await Promise.all(ctx.pending);
    expect(spies.flagsSyncTick).toHaveBeenCalledExactlyOnceWith(env, c);
    expect(spies.runSchedule).toHaveBeenCalledExactlyOnceWith(env, c.scheduledTime);
  });

  it("'*/10 * * * *' does not run the schedule table", async () => {
    const ctx = testContext();
    await worker.scheduled(controller('*/10 * * * *'), opsEnv(), ctx);
    await Promise.all(ctx.pending);
    expect(spies.dispatcherTick).toHaveBeenCalledOnce();
    expect(spies.runSchedule).not.toHaveBeenCalled();
  });

  it('a failing schedule tick is logged with its job name, never rejects and never stops the flags sync', async () => {
    spies.runSchedule.mockRejectedValueOnce(new Error('kv unavailable'));
    const ctx = testContext();
    await worker.scheduled(controller('* * * * *'), opsEnv(), ctx);
    await expect(Promise.all(ctx.pending)).resolves.toBeDefined();
    expect(spies.flagsSyncTick).toHaveBeenCalledOnce();
    expect(errors.join('\n')).toContain('cron job failed');
    expect(errors.join('\n')).toContain('schedule');
  });
});

describe('class exports for the Phase 5 bindings', () => {
  it('every class named in wrangler.jsonc (Workflows, Durable Objects, containers) is exported by the entry module', () => {
    const text = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
    const named = [...text.matchAll(/"class_name":\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
    for (const name of ['ContentDailyWorkflow', 'SitemapWorkflow', 'OpsDigestWorkflow', 'SenderLimiter', 'CadContainer']) expect(named).toContain(name);
    const exported = index as unknown as Record<string, unknown>;
    for (const name of named) expect(typeof exported[name], name).toBe('function');
  });

  it('every named export is a class or function (workerd refuses any other value)', () => {
    for (const [name, value] of Object.entries(index)) {
      if (name !== 'default') expect(typeof value, name).toBe('function');
    }
  });

  it('ContainerProxy is the object of the single @cloudflare/containers copy that CadContainer extends', () => {
    expect(index.ContainerProxy).toBe(containers.ContainerProxy);
    expect(Object.getPrototypeOf(index.CadContainer.prototype)).toBe(containers.Container.prototype);
  });
});
