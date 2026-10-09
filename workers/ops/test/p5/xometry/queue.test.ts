// handleXometryScan (scrapes kind 'xometry-scan'): runs the tick for the dispatcher's run and always acks (the next
// slot is the retry, PHASE5_SPEC §5.3); invalid params are acked without touching a run; the scrapes-p5 consumer
// routes the kind to it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRun } from '../../../src/agents/runs';
import type { Db } from '../../../src/db/postgrest';
import type { P5ScrapeMessage } from '../../../src/queues/messages';
import { makeScrapesP5Consumer, P5_SCRAPE_HANDLERS } from '../../../src/queues/scrapes-p5';
import { makeTestP5Ports, P5MemoryDb, ScriptedSources } from '../../../src/ports/p5-stub/index';
import { handleXometryScan } from '../../../src/xometry/queue';
import { agentBindings, agentPorts, FakeClock, FakeKV } from '../../helpers/agent-env';
import { opsEnv, testContext } from '../../helpers/ops';
import { RecordingLogger } from '../../helpers/recorders';
import { gqlPage, makeOffer } from './helpers';

const SLOT = '2026-10-08T08:00Z';

function setup() {
  const kv = new FakeKV();
  kv.setJson('agent.growth.xometry', { enabled: true, mode: 'assist', value: {}, rev: 1 });
  const clock = new FakeClock(Date.parse('2026-10-08T08:00:30Z'));
  const db = new P5MemoryDb({ clock: () => clock.now() });
  const ports = agentPorts({ db, clock });
  const sources = new ScriptedSources({ routes: [{ method: 'POST', match: 'https://xometry.test/partners/graphql', respond: Response.json(gqlPage([makeOffer('HJO-1')])) }] });
  const p5 = makeTestP5Ports({ sources });
  const env = opsEnv({ ...agentBindings({ FLAGS: kv as unknown as KVNamespace }), XOMETRY_TOKEN: ['t1', 'queue', 'value'].join('-') });
  return { env, db, ports, p5, sources };
}

function message(body: unknown, attempts = 1) {
  return { id: 'msg-1', timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() } as unknown as Message<P5ScrapeMessage> & { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
}

const bodyOf = (run_id: string, params: unknown = { slot: SLOT }): P5ScrapeMessage =>
  ({ v: 1, kind: 'xometry-scan', params, run_id, enqueued_at: '2026-10-08T08:00:00.000Z', requested_by: 'schedule' }) as P5ScrapeMessage;

let logger: RecordingLogger;
let restore: () => void;
beforeEach(() => {
  logger = new RecordingLogger();
  restore = logger.start();
});
afterEach(() => restore());

describe('handleXometryScan', () => {
  it('runs the tick for the run of the message and acks once (never retries)', async () => {
    const s = setup();
    const run = await openRun(s.db, { agent: 'growth.xometry', trigger: 'cron', idempotency_key: `growth.xometry:${SLOT}` });
    const m = message(bodyOf(run.run_id), 2);
    await handleXometryScan(m, s.env, testContext(), { ports: s.ports, p5: s.p5 });
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    const row = s.db.rows('agent_runs', ['id', 'eq', run.run_id])[0];
    expect(row.status).toBe('succeeded');
    expect(s.db.rows('xometry_offers').map((r) => r.code)).toEqual(['HJO-1']);
    expect(s.ports.events.points[0]).toMatchObject({ event: 'xometry_tick', attempt: 2 });
  });

  it('invalid params: logged with the message id only, acked, and the growth.xometry run closed failed (never another agent\'s run)', async () => {
    const s = setup();
    const run = await openRun(s.db, { agent: 'growth.xometry', trigger: 'cron', idempotency_key: `growth.xometry:${SLOT}` });
    const other = await openRun(s.db, { agent: 'growth.hn', trigger: 'cron', idempotency_key: `growth.hn:${SLOT}` });
    for (const [params, runId] of [[{ slot: '2026-10-08 08:00' }, run.run_id], [{}, run.run_id], [null, other.run_id]] as const) {
      const m = message(bodyOf(runId, params));
      await handleXometryScan(m, s.env, testContext(), { ports: s.ports, p5: s.p5 });
      expect(m.ack).toHaveBeenCalledTimes(1);
    }
    const m = message(bodyOf(''));
    await handleXometryScan(m, s.env, testContext(), { ports: s.ports, p5: s.p5 });
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(s.db.rows('agent_runs', ['id', 'eq', run.run_id])[0]).toMatchObject({ status: 'failed', error: 'invalid_params' });
    expect(s.db.rows('agent_runs', ['id', 'eq', other.run_id])[0].status).toBe('running');
    expect(s.sources.requests).toHaveLength(0);
    expect(logger.lines.filter((l) => l.includes('xometry-scan invalid params acked'))).toEqual(Array(4).fill('error [microns-ops] xometry-scan invalid params acked message_id=msg-1'));
  });

  it('acks even when the tick cannot close its run, and passes the error on to the consumer', async () => {
    const s = setup();
    const run = await openRun(s.db, { agent: 'growth.xometry', trigger: 'cron', idempotency_key: `growth.xometry:${SLOT}` });
    const memory = s.db;
    (s.ports as unknown as { db: Db }).db = {
      select: (t, o) => memory.select(t, o),
      insert: (t, r, o) => memory.insert(t, r, o),
      rpc: (n, a) => memory.rpc(n, a),
      update: async (t, p, o) => {
        if (t === 'agent_runs') throw new Error('database down');
        return memory.update(t, p, o);
      },
    };
    const m = message(bodyOf(run.run_id));
    await expect(handleXometryScan(m, s.env, testContext(), { ports: s.ports, p5: s.p5 })).rejects.toThrow('database down');
    expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it('the scrapes-p5 consumer routes xometry-scan to this handler (the fixed kind table)', async () => {
    expect(P5_SCRAPE_HANDLERS['xometry-scan']).toBe(handleXometryScan);
    const s = setup();
    const run = await openRun(s.db, { agent: 'growth.xometry', trigger: 'cron', idempotency_key: `growth.xometry:${SLOT}` });
    const consumer = makeScrapesP5Consumer({
      handlers: { ...P5_SCRAPE_HANDLERS, 'xometry-scan': (msg, env, ctx) => handleXometryScan(msg, env, ctx, { ports: s.ports, p5: s.p5 }) },
      ports: () => s.ports,
    });
    const m = message(bodyOf(run.run_id));
    await consumer({ queue: 'scrapes', messages: [m] } as unknown as MessageBatch<unknown>, s.env, testContext());
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(s.db.rows('agent_runs', ['id', 'eq', run.run_id])[0].status).toBe('succeeded');
  });
});
