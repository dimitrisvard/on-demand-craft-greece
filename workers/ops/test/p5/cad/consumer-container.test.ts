// cad-jobs consumer on the container backend (Phase 5 changes of src/queues/cad-jobs.ts): the lease is acquired
// with priority 'batch' and its slot reaches the container; a crash answer recycles the slot and is retried once
// (a second crash is final); a refused key recycles, fails at once and sends one plain-text alert per hour;
// CAD_BACKEND_DEFAULT 'container' without the container configured fails 'config_missing' with its names.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerBackend } from '../../../src/cad/backends/container';
import { InlineBackend } from '../../../src/cad/backends/inline';
import { MapCadRegistry } from '../../../src/cad/registry';
import type { CadRouterClient } from '../../../src/cad/router-client';
import { CAD_ALERT_TEXTS, resetCadAlerts } from '../../../src/cad-container/alerts';
import { enqueueCadJob, getCadJob, type CadJobRow } from '../../../src/db/repos/cad-jobs';
import type { OpsEnv } from '../../../src/env';
import { ScriptedContainer, TelegramTextRecorder, type ContainerScript } from '../../../src/ports/p5-stub/index';
import { cadJobsConsumer, MAX_DELIVERIES } from '../../../src/queues/cad-jobs';
import type { CadJobMessageV1 } from '../../../src/queues/messages';
import { FakeQueue, agentBindings, agentPorts } from '../../helpers/agent-env';
import { fakeNamespace } from '../../helpers/fake-do';
import { serviceJson, TEST_KEY, TestCadRouter } from './helpers';

// Compile-time (npm run typecheck): the CadRouter client takes the Phase 5 fields in object literals (priority on
// acquire, recycle on release), and a granted lease carries its slot.
type AcquireArg = Parameters<CadRouterClient['acquire']>[0];
type ReleaseArg = Parameters<CadRouterClient['release']>[1];
type Granted = Extract<Awaited<ReturnType<CadRouterClient['acquire']>>, { granted: true }>;
const ACQUIRE_WITH_PRIORITY: AcquireArg = { job_id: 'j', backend_candidates: ['container'], deadline_s: 1, priority: 'batch' };
const RELEASE_WITH_RECYCLE: ReleaseArg = { ok: false, retryable: true, backend_down: false, recycle: true };
const GRANTED_WITH_SLOT: Granted = { granted: true, lease_id: 'l', backend: 'container', slot: 'cad-0' };
void [ACQUIRE_WITH_PRIORITY, RELEASE_WITH_RECYCLE, GRANTED_WITH_SLOT];

const FIXTURES = new URL('../../fixtures/cad/', import.meta.url).pathname;
const FLAT = new Uint8Array(readFileSync(FIXTURES + 'unfold-flat.dxf'));
const TENANT = '00000000-0000-0000-0000-000000000001';
const RFQ = '22222222-2222-4222-8222-222222222222';

function okUnfold(): Response {
  return new Response(FLAT, { status: 200, headers: { 'content-type': 'application/dxf', 'x-part-thickness': '2.0', 'x-part-bends': '2', 'x-part-flat-width': '180.0', 'x-part-flat-height': '120.0' } });
}

function msg(body: CadJobMessageV1, attempts = 1) {
  return { id: `m-${attempts}`, timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}
const batch = (...messages: ReturnType<typeof msg>[]) => ({ queue: 'cad-jobs', messages, retryAll: vi.fn(), ackAll: vi.fn() }) as unknown as MessageBatch<CadJobMessageV1>;

async function setup(o: { script?: ContainerScript; envOver?: Partial<OpsEnv>; registry?: MapCadRegistry } = {}) {
  const port = new ScriptedContainer(o.script ?? (() => okUnfold()));
  const registry = o.registry ?? new MapCadRegistry([new ContainerBackend({ port, apiKey: TEST_KEY, maxConcurrency: 3 }), new InlineBackend()], 'container');
  const ports = agentPorts({ cad: registry });
  const routerEnv = { CAD_SLOTS: '3' } as OpsEnv;
  const routers: TestCadRouter[] = [];
  const routerNs = fakeNamespace((state) => {
    const r = new TestCadRouter(state as unknown as DurableObjectState, routerEnv);
    r.port = port;
    routers.push(r);
    return r;
  });
  const env = { SUPABASE_URL: 'https://db.example.test', ...agentBindings({ CAD_ROUTER: routerNs as unknown as OpsEnv['CAD_ROUTER'] }), CAD_BACKEND_DEFAULT: 'container', ...o.envOver } as unknown as OpsEnv;
  const queue = env.CAD_JOBS as unknown as FakeQueue<CadJobMessageV1>;
  const telegram = new TelegramTextRecorder();
  const requester = await ports.db.rpc<Array<{ run_id: string }>>('agent_run_begin', { p_agent: 'quote', p_trigger: 'workflow', p_idempotency_key: `${RFQ}:v1`, p_fields: {} });
  const acquires: unknown[] = [];
  const releases: unknown[] = [];
  const spyRouter = (): CadRouterClient => {
    const real = routerNs.instance('global') as unknown as CadRouterClient;
    return {
      acquire: async (r) => {
        acquires.push(structuredClone(r));
        return real.acquire(r);
      },
      release: async (id, outcome) => {
        releases.push(structuredClone(outcome));
        return real.release(id, outcome);
      },
      report: (b, ok) => real.report(b, ok),
      snapshot: () => real.snapshot(),
    };
  };
  const run = (m: ReturnType<typeof msg>) =>
    cadJobsConsumer(batch(m), env, {} as ExecutionContext, { ports, router: spyRouter(), telegramText: telegram, leaseWaitMs: 0, sleep: async () => undefined, notifyFinal: async () => undefined });
  const enqueue = async (): Promise<CadJobMessageV1> => {
    const input = { r2_key: `rfq/${RFQ}/f1-bracket.step`, sha256: 'a'.repeat(64), content_type: 'application/step', size_bytes: 318, file_name: 'bracket.step' };
    await ports.bucket.put(input.r2_key, readFileSync(FIXTURES + 'bracket-sheet.step'));
    await enqueueCadJob(env, ports.db, {
      tenant_id: TENANT,
      rfq_id: RFQ,
      rfq_file_id: null,
      quote_workflow_id: null,
      job_type: 'analyse',
      params: { material: 'steel', thickness_override: 0, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal' },
      requested_by_run_id: requester[0].run_id,
      input,
    });
    return queue.sent[queue.sent.length - 1].body;
  };
  const row = async (id: string) => (await getCadJob(ports.db, id)) as CadJobRow;
  return { port, ports, env, telegram, acquires, releases, run, enqueue, row, routers };
}

beforeEach(() => {
  resetCadAlerts();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('cad-jobs consumer on the container backend', () => {
  it('acquires with priority batch, runs on the granted slot, releases ok', async () => {
    const s = await setup();
    const m = msg(await s.enqueue());
    await s.run(m);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(await s.row(m.body.job_id)).toMatchObject({ status: 'succeeded', backend: 'container' });
    expect(s.acquires).toEqual([{ job_id: m.body.job_id, backend_candidates: ['container'], deadline_s: 300, priority: 'batch' }]);
    expect(s.port.requests.map((r) => [r.slot, new URL(r.url).pathname])).toEqual([['cad-0', '/api/v1/unfold']]);
    expect(s.releases).toEqual([{ ok: true }]);
    expect(s.port.destroyed).toEqual([]);
    expect(s.telegram.texts()).toEqual([]);
  });

  it('a crash answer recycles the slot and is retried once; the second crash is final', async () => {
    const s = await setup({ script: () => serviceJson(500, { detail: 'Processing crashed (exit -11)' }) });
    const body = await s.enqueue();
    const first = msg(body, 1);
    await s.run(first);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(s.releases.at(-1)).toEqual({ ok: false, retryable: true, backend_down: false, recycle: true });
    expect(s.port.destroyed).toEqual(['cad-0']);
    expect(await s.row(body.job_id)).toMatchObject({ status: 'queued', error: 'backend_error: unfold 500 processing crashed' });

    const second = msg(body, 2);
    await s.run(second);
    expect(second.retry).not.toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalledOnce();
    expect(s.port.destroyed).toEqual(['cad-0', 'cad-0']);
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: 'backend_error: unfold 500 processing crashed' });
    // the second delivery is not the last one, so the final status comes from the crash rule
    expect(second.attempts).toBeLessThan(MAX_DELIVERIES);
  });

  it('a crash after another retryable failure is still retried once', async () => {
    let n = 0;
    const s = await setup({ script: () => (++n === 1 ? new Response('busy', { status: 502 }) : serviceJson(500, { detail: 'Processing crashed (exit -6)' })) });
    const body = await s.enqueue();
    await s.run(msg(body, 1));
    const second = msg(body, 2);
    await s.run(second);
    expect(second.retry).toHaveBeenCalledOnce();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'queued' });
  });

  it('a refused key: final at once, slot recycled, one alert per hour for many jobs', async () => {
    const s = await setup({ script: () => serviceJson(401, { error: 'Invalid API key' }) });
    const body = await s.enqueue();
    const m = msg(body);
    await s.run(m);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: 'backend_error: unfold 401 key refused' });
    expect(s.releases.at(-1)).toMatchObject({ ok: false, retryable: false, recycle: true });
    expect(s.telegram.texts()).toEqual([CAD_ALERT_TEXTS.key_mismatch('container')]);
    expect(s.telegram.texts()[0]).toBe('CAD key mismatch: the container unfold service refused the shared key (HTTP 401). CAD calls to it fail until CAD_SHARED_SECRET matches the service key.');
    // a second job within the hour: no second alert
    const t = await setup({ script: () => serviceJson(401, { error: 'Invalid API key' }) });
    await t.run(msg(await t.enqueue()));
    expect(t.telegram.texts()).toEqual([]);
    expect(JSON.stringify(s.telegram.messages)).not.toContain(TEST_KEY);
  });

  it('no key configured in the container: unavailable, final, one alert, released as backend down', async () => {
    const s = await setup({ script: () => serviceJson(503, { error: 'API key not configured' }) });
    const m = msg(await s.enqueue());
    await s.run(m);
    expect(await s.row(m.body.job_id)).toMatchObject({ status: 'failed', error: 'unavailable: unfold 503 key not configured' });
    expect(s.releases.at(-1)).toEqual({ ok: false, retryable: false, backend_down: true });
    expect(s.telegram.texts()).toEqual([CAD_ALERT_TEXTS.key_not_configured('container')]);
  });

  it("CAD_BACKEND_DEFAULT 'container' without the container configured fails config_missing with the container names", async () => {
    const s = await setup({ registry: new MapCadRegistry([new ContainerBackend(), new InlineBackend()], 'container'), envOver: { CAD_SHARED_SECRET: undefined, CAD_CONTAINER: undefined } });
    const m = msg(await s.enqueue());
    await s.run(m);
    expect(await s.row(m.body.job_id)).toMatchObject({ status: 'failed', error: 'config_missing: CAD_CONTAINER, CAD_SHARED_SECRET' });
    expect(s.port.requests).toEqual([]);
  });
});
