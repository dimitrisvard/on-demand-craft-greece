// microns-ops default export (Phase 4 wiring): fetch answers 404 with no body except for the remote MCP host, queue
// dispatches by queue name and message envelope (the Phase 2 scrapes consumer stays the fallback), scheduled
// dispatches by cron expression; the Phase 4 classes are exported for the wrangler bindings.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDirectoryScanMessage, type DirectoryScanMessage, type ScrapeMessage } from '../../src/queues/messages';
import { opsEnv, testContext } from '../helpers/ops';

const spies = vi.hoisted(() => ({
  handleMcp: vi.fn(async () => new Response('mcp', { status: 200 })),
  cadJobsConsumer: vi.fn(async () => {}),
  agentEventsConsumer: vi.fn(async () => {}),
  directoryScanConsumer: vi.fn(async () => {}),
  scrapesConsumer: vi.fn(async () => {}),
  flagsSyncTick: vi.fn(async () => {}),
  dispatcherTick: vi.fn(async () => {}),
}));

vi.mock('../../src/mcp/index', () => ({ handleMcp: spies.handleMcp }));
vi.mock('../../src/queues/cad-jobs', () => ({ cadJobsConsumer: spies.cadJobsConsumer }));
vi.mock('../../src/queues/agent-events', () => ({ agentEventsConsumer: spies.agentEventsConsumer }));
vi.mock('../../src/queues/directory-scan', () => ({ directoryScanConsumer: spies.directoryScanConsumer }));
vi.mock('../../src/queues/scrapes', () => ({ scrapesConsumer: spies.scrapesConsumer }));
vi.mock('../../src/cron/flags-sync', () => ({ flagsSyncTick: spies.flagsSyncTick }));
vi.mock('../../src/cron/dispatcher', () => ({ dispatcherTick: spies.dispatcherTick }));

const index = await import('../../src/index');
const worker = index.default;

const MCP_HOST = 'mcp.micronshub.eu';
const RUN_ID = '5e0c3f4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';

const directoryScan: DirectoryScanMessage = {
  v: 1,
  kind: 'directory-scan',
  params: { url: 'https://directory.example.com/search?q=laser', source: 'europages', max_pages: 2, enrich_profiles: false },
  run_id: RUN_ID,
  enqueued_at: '2026-10-05T07:00:00.000Z',
  requested_by: 'MACHINE:mcp',
};
const scrape: ScrapeMessage = {
  v: 1,
  kind: 'tender-scan',
  params: { country_code: 'NL' },
  run_id: RUN_ID,
  enqueued_at: '2026-10-05T07:00:00.000Z',
  requested_by: 'MACHINE:collector',
};

function batch(queue: string, bodies: unknown[]): MessageBatch<unknown> {
  const messages = bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(0), body, attempts: 1, ack() {}, retry() {} }));
  return { queue, messages, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>;
}

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.UTC(2026, 9, 5, 7, 0), noRetry() {} } as unknown as ScheduledController;
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

describe('default fetch', () => {
  it('without arguments answers 404 with no body', async () => {
    const response = await worker.fetch();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('another host answers 404 with no body and never reaches the MCP handler', async () => {
    const env = opsEnv({ MCP_HOSTNAME: MCP_HOST });
    const response = await worker.fetch(new Request('https://microns-ops.example.workers.dev/mcp'), env, testContext());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(spies.handleMcp).not.toHaveBeenCalled();
  });

  it('the MCP host reaches handleMcp with the request, env and ctx', async () => {
    const env = opsEnv({ MCP_HOSTNAME: MCP_HOST });
    const ctx = testContext();
    const request = new Request(`https://${MCP_HOST}/mcp`, { method: 'POST' });
    const response = await worker.fetch(request, env, ctx);
    expect(await response.text()).toBe('mcp');
    expect(spies.handleMcp).toHaveBeenCalledExactlyOnceWith(request, env, ctx);
  });

  it('without MCP_HOSTNAME configured every host answers 404', async () => {
    const response = await worker.fetch(new Request(`https://${MCP_HOST}/mcp`), opsEnv(), testContext());
    expect(response.status).toBe(404);
    expect(spies.handleMcp).not.toHaveBeenCalled();
  });
});

describe('default queue', () => {
  it('cad-jobs -> cadJobsConsumer', async () => {
    const b = batch('cad-jobs', [{ v: 1 }]);
    await worker.queue(b, opsEnv(), testContext());
    expect(spies.cadJobsConsumer).toHaveBeenCalledOnce();
    expect(spies.cadJobsConsumer).toHaveBeenCalledWith(b, expect.anything(), expect.anything());
    expect(spies.scrapesConsumer).not.toHaveBeenCalled();
  });

  it('agent-events -> agentEventsConsumer', async () => {
    await worker.queue(batch('agent-events', [{ v: 1, type: 'resume-parked', run_id: RUN_ID }]), opsEnv(), testContext());
    expect(spies.agentEventsConsumer).toHaveBeenCalledOnce();
    expect(spies.scrapesConsumer).not.toHaveBeenCalled();
  });

  it('scrapes with a DirectoryScanMessage -> directoryScanConsumer', async () => {
    await worker.queue(batch('scrapes', [directoryScan]), opsEnv(), testContext());
    expect(spies.directoryScanConsumer).toHaveBeenCalledOnce();
    expect(spies.scrapesConsumer).not.toHaveBeenCalled();
  });

  it('scrapes with a Phase 2 ScrapeMessage -> scrapesConsumer, unchanged', async () => {
    const b = batch('scrapes', [scrape]);
    const env = opsEnv();
    const ctx = testContext();
    await worker.queue(b, env, ctx);
    expect(spies.scrapesConsumer).toHaveBeenCalledExactlyOnceWith(b, env, ctx);
    expect(spies.directoryScanConsumer).not.toHaveBeenCalled();
  });

  it('a mixed or empty scrapes batch and an invalid body go to the Phase 2 consumer', async () => {
    await worker.queue(batch('scrapes', [directoryScan, scrape]), opsEnv(), testContext());
    await worker.queue(batch('scrapes', []), opsEnv(), testContext());
    await worker.queue(batch('scrapes', ['not json']), opsEnv(), testContext());
    expect(spies.scrapesConsumer).toHaveBeenCalledTimes(3);
    expect(spies.directoryScanConsumer).not.toHaveBeenCalled();
  });
});

describe('isDirectoryScanMessage', () => {
  it('accepts v 1 with kind directory-scan only', () => {
    expect(isDirectoryScanMessage(directoryScan)).toBe(true);
    expect(isDirectoryScanMessage(scrape)).toBe(false);
    expect(isDirectoryScanMessage({ ...directoryScan, v: 2 })).toBe(false);
    expect(isDirectoryScanMessage({ ...directoryScan, v: '1' })).toBe(false);
    for (const body of [null, undefined, 'directory-scan', 1, []]) expect(isDirectoryScanMessage(body)).toBe(false);
  });
});

describe('default scheduled', () => {
  it("'* * * * *' runs flagsSyncTick in waitUntil", async () => {
    const ctx = testContext();
    const c = controller('* * * * *');
    const env = opsEnv();
    await worker.scheduled(c, env, ctx);
    await Promise.all(ctx.pending);
    expect(spies.flagsSyncTick).toHaveBeenCalledExactlyOnceWith(env, c);
    expect(spies.dispatcherTick).not.toHaveBeenCalled();
  });

  it("'*/10 * * * *' runs dispatcherTick in waitUntil", async () => {
    const ctx = testContext();
    const c = controller('*/10 * * * *');
    const env = opsEnv();
    await worker.scheduled(c, env, ctx);
    await Promise.all(ctx.pending);
    expect(spies.dispatcherTick).toHaveBeenCalledExactlyOnceWith(env, c);
    expect(spies.flagsSyncTick).not.toHaveBeenCalled();
  });

  it('a failing job is logged with its name and does not reject', async () => {
    spies.flagsSyncTick.mockRejectedValueOnce(new Error('kv unavailable'));
    const ctx = testContext();
    await worker.scheduled(controller('* * * * *'), opsEnv(), ctx);
    await expect(Promise.all(ctx.pending)).resolves.toBeDefined();
    expect(errors.join('\n')).toContain('cron job failed');
    expect(errors.join('\n')).toContain('flags-sync');
  });

  it('an unknown expression runs nothing and is logged', async () => {
    const ctx = testContext();
    await worker.scheduled(controller('0 3 * * *'), opsEnv(), ctx);
    expect(ctx.pending).toHaveLength(0);
    expect(spies.flagsSyncTick).not.toHaveBeenCalled();
    expect(spies.dispatcherTick).not.toHaveBeenCalled();
    expect(errors.join('\n')).toContain('cron without a handler');
  });
});

describe('class exports for the wrangler bindings', () => {
  it('every named export of the entry module is a class or function (workerd refuses any other value)', () => {
    for (const [name, value] of Object.entries(index)) {
      if (name !== 'default') expect(typeof value, name).toBe('function');
    }
    expect(Object.keys(worker).sort()).toEqual(['fetch', 'queue', 'scheduled']);
  });

  it('exports the Workflow, Durable Object and entrypoint classes named in wrangler.jsonc', () => {
    for (const name of ['RfqIntakeWorkflow', 'QuoteWorkflow', 'PostOrderWorkflow', 'RfqThread', 'MaterialStock', 'CadRouter', 'MailIngest', 'OpsApi'] as const) {
      expect(typeof index[name], name).toBe('function');
    }
  });
});
