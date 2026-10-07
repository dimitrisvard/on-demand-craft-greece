// cad-jobs consumer (D-3): duplicate delivery, reuse of a succeeded job, retry versus final failure, the last
// delivery, lease waits, inline caps, outputs in R2, RfqThread.cadJobFinal exactly once per final state, the
// agent_runs row of every job, and the status and backend lists against the migration's CHECK constraints.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { InlineBackend } from '../../src/cad/backends/inline';
import { MapCadRegistry } from '../../src/cad/registry';
import type { CadRouterClient } from '../../src/cad/router-client';
import { CAD_BACKENDS, INLINE_TOO_LARGE, type BackendName, type CadBackend, type CadFinalStatus, type CadJobStatus, type CadOutcome } from '../../src/cad/types';
import { cadJobKey } from '../../src/agents/ids';
import { enqueueCadJob, getCadJob, type CadJobRow, type NewCadJob } from '../../src/db/repos/cad-jobs';
import { CadRouter } from '../../src/do/cad-router';
import type { OpsEnv } from '../../src/env';
import { MAX_DELIVERIES, cadJobsConsumer, isCadJobMessage } from '../../src/queues/cad-jobs';
import type { CadJobMessageV1 } from '../../src/queues/messages';
import { FakeQueue, agentBindings, agentPorts, type AgentTestPorts } from '../helpers/agent-env';
import { checkList, sorted } from '../helpers/check-lists';
import { fakeNamespace } from '../helpers/fake-do';

const FIXTURES = new URL('../fixtures/cad/', import.meta.url).pathname;
const TENANT = '00000000-0000-0000-0000-000000000001';
const RFQ = '22222222-2222-4222-8222-222222222222';
const RFQ2 = '44444444-4444-4444-8444-444444444444';
const sha = (c: string) => c.repeat(64);

interface FakeMessage {
  id: string;
  timestamp: Date;
  body: CadJobMessageV1;
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function msg(body: CadJobMessageV1, attempts = 1): FakeMessage {
  return { id: `m-${attempts}`, timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

const batch = (...messages: FakeMessage[]) => ({ queue: 'cad-jobs', messages, retryAll: vi.fn(), ackAll: vi.fn() }) as unknown as MessageBatch<CadJobMessageV1>;

class ScriptedBackend implements CadBackend {
  readonly mode = 'sync' as const;
  readonly maxConcurrency = 1;
  readonly runs: string[] = [];
  outcomes: CadOutcome[] = [];
  constructor(readonly name: BackendName) {}
  supports(_jobType?: string, _kind?: string, _process?: string): boolean {
    return true;
  }
  async health(): Promise<boolean> {
    return true;
  }
  async run(job: CadJobMessageV1): Promise<CadOutcome> {
    this.runs.push(job.job_id);
    return this.outcomes.shift() ?? { ok: true, result: okResult(), artefacts: [{ name: 'flat.dxf', contentType: 'application/dxf', body: new TextEncoder().encode('0\nEOF\n').buffer as ArrayBuffer }] };
  }
}

function okResult() {
  return { v: 1 as const, kind: 'step' as const, source: 'unfold-service' as const, units: 'mm' as const, thickness_mm: 2, flat: { width_mm: 10, height_mm: 20, area_mm2: 200, cut_length_mm: 60, pierces: 0 }, bends: { count: 1, items: [] }, bbox_mm: null, volume_mm3: null, warnings: [], versions: {}, duration_ms: 1 };
}

interface Setup {
  env: OpsEnv;
  ports: AgentTestPorts;
  vps: ScriptedBackend;
  finals: Array<{ rfq: string; job: string; status: CadFinalStatus }>;
  queue: FakeQueue<CadJobMessageV1>;
  sleeps: number[];
  run(m: FakeMessage, o?: { router?: CadRouterClient; leaseWaitMs?: number }): Promise<void>;
  enqueue(o?: Partial<NewCadJob>): Promise<CadJobMessageV1>;
  row(id: string): Promise<CadJobRow>;
}

async function setup(o: { inline?: boolean } = {}): Promise<Setup> {
  const vps = new ScriptedBackend('vps');
  const backends: CadBackend[] = o.inline ? [vps, new InlineBackend()] : [vps];
  const ports = agentPorts({ cad: new MapCadRegistry(backends, 'vps') });
  const routerNs = fakeNamespace((state) => new CadRouter(state as unknown as DurableObjectState, {} as OpsEnv));
  const env = { SUPABASE_URL: 'https://db.example.test', ...agentBindings({ CAD_ROUTER: routerNs as unknown as OpsEnv['CAD_ROUTER'] }) } as unknown as OpsEnv;
  const queue = env.CAD_JOBS as unknown as FakeQueue<CadJobMessageV1>;
  const finals: Setup['finals'] = [];
  const sleeps: number[] = [];
  const requester = await ports.db.rpc<Array<{ run_id: string }>>('agent_run_begin', { p_agent: 'quote', p_trigger: 'workflow', p_idempotency_key: `${RFQ}:v1`, p_fields: {} });
  const s: Setup = {
    env,
    ports,
    vps,
    finals,
    queue,
    sleeps,
    run: (m, ro = {}) =>
      cadJobsConsumer(batch(m), env, {} as ExecutionContext, {
        ports,
        router: ro.router,
        leaseWaitMs: ro.leaseWaitMs ?? 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        notifyFinal: async (rfq, job, status) => {
          finals.push({ rfq, job, status });
        },
      }),
    enqueue: async (j = {}) => {
      const input = j.input ?? { r2_key: `rfq/${RFQ}/f1-bracket.step`, sha256: sha('a'), content_type: 'application/step', size_bytes: 318, file_name: 'bracket.step' };
      if (!ports.bucket.objects.has(input.r2_key)) await ports.bucket.put(input.r2_key, readFileSync(FIXTURES + 'bracket-sheet.step'));
      await enqueueCadJob(env, ports.db, {
        tenant_id: TENANT,
        rfq_id: RFQ,
        rfq_file_id: null,
        quote_workflow_id: null,
        job_type: 'analyse',
        params: { material: 'steel', thickness_override: 0, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal' },
        requested_by_run_id: requester[0].run_id,
        ...j,
        input,
      });
      return queue.sent[queue.sent.length - 1].body;
    },
    row: async (id) => (await getCadJob(ports.db, id)) as CadJobRow,
  };
  return s;
}

describe('reviewer reproductions (consumer)', () => {
  it('R5 a crashed delivery leaves the row running: with the real retry spacing the job is never taken over and the message dead-letters', async () => {
    const s = await setup();
    const body = await s.enqueue();
    // delivery 1 claimed the job and then the invocation died (deploy, CPU or memory limit): row running, lease held
    await s.ports.db.update('cad_jobs', { status: 'running', started_at: s.ports.clock.now().toISOString(), attempts: 1 }, { filters: [['id', 'eq', body.job_id]] });
    const d2 = msg(body, 2); // redelivered at once after the failed invocation
    await s.run(d2);
    console.log('delivery 2 retry args', JSON.stringify(d2.retry.mock.calls));
    s.ports.clock.advance(60_000); // the consumer's own delay
    const d3 = msg(body, 3); // the last delivery (max_retries 2)
    await s.run(d3);
    console.log('delivery 3 retry args', JSON.stringify(d3.retry.mock.calls), 'ack', d3.ack.mock.calls.length);
    expect(s.vps.runs).toEqual([]);
    expect(d3.retry).toHaveBeenCalled(); // on the last delivery: the message goes to cad-jobs-dlq
    expect((await s.row(body.job_id)).status).toBe('running');
    expect(s.finals).toEqual([]);
  });

  it('R6 a failed RfqThread.cadJobFinal call is swallowed: the job is final, the message acknowledged, no second notice', async () => {
    const s = await setup();
    const m = msg(await s.enqueue());
    let calls = 0;
    await cadJobsConsumer(batch(m), s.env, {} as ExecutionContext, {
      ports: s.ports,
      leaseWaitMs: 0,
      sleep: async () => {},
      notifyFinal: async () => {
        calls++;
        throw new Error('rfq thread unavailable');
      },
    });
    console.log('notify calls', calls, 'ack', m.ack.mock.calls.length, 'retry', m.retry.mock.calls.length);
    expect(calls).toBe(1);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
    expect((await s.row(m.body.job_id)).status).toBe('succeeded');
    const again = msg(m.body, 2);
    await s.run(again);
    expect(s.finals).toEqual([]); // a redelivery never repeats the notice either
  });
});
