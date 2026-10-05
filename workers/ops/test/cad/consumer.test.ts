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

describe('cad-jobs consumer', () => {
  it('runs a job once: outputs and result.json in R2, row succeeded, one final notice, a closed cad run', async () => {
    const s = await setup();
    const m = msg(await s.enqueue());
    await s.run(m);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
    const row = await s.row(m.body.job_id);
    expect(row).toMatchObject({ status: 'succeeded', backend: 'vps', attempts: 1, error: null });
    expect(row.output_r2_keys).toEqual([`cad/${row.id}/output/result.json`, `cad/${row.id}/output/flat.dxf`]);
    expect(JSON.parse(s.ports.bucket.text(`cad/${row.id}/output/result.json`) as string)).toEqual(okResult());
    expect(s.finals).toEqual([{ rfq: RFQ, job: row.id, status: 'succeeded' }]);
    const runs = s.ports.db.rows('agent_runs', ['agent', 'eq', 'cad']);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ idempotency_key: row.id, trigger: 'queue', status: 'succeeded', subject_type: 'cad_job', llm_calls: 0 });
    expect(s.ports.events.points.at(-1)).toMatchObject({ event: 'cad_job', agent: 'cad', route: 'vps', outcome: 'ok' });
    // duplicate delivery: acknowledged, nothing runs again, no second notice
    const again = msg(m.body, 2);
    await s.run(again);
    expect(again.ack).toHaveBeenCalledOnce();
    expect(s.vps.runs).toHaveLength(1);
    expect(s.finals).toHaveLength(1);
  });

  it('reuses a succeeded job with the same key (another RFQ) without calling a backend', async () => {
    const s = await setup();
    const first = msg(await s.enqueue());
    await s.run(first);
    const second = msg(await s.enqueue({ rfq_id: RFQ2 }));
    expect(second.body.job_id).not.toBe(first.body.job_id);
    await s.run(second);
    expect(s.vps.runs).toEqual([first.body.job_id]);
    const a = await s.row(first.body.job_id);
    const b = await s.row(second.body.job_id);
    expect(b).toMatchObject({ status: 'succeeded', backend: 'vps', result: a.result, output_r2_keys: a.output_r2_keys });
    expect(s.finals.map((f) => f.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('a retryable failure goes back to queued and is retried; the last delivery makes it final once', async () => {
    const s = await setup();
    const body = await s.enqueue();
    s.vps.outcomes = [
      { ok: false, retryable: true, code: 'timeout', message: 'slow' },
      { ok: false, retryable: true, code: 'timeout', message: 'slow' },
      { ok: false, retryable: true, code: 'timeout', message: 'slow' },
    ];
    for (let attempt = 1; attempt < MAX_DELIVERIES; attempt++) {
      const m = msg(body, attempt);
      await s.run(m);
      expect(m.retry).toHaveBeenCalledOnce();
      expect(m.ack).not.toHaveBeenCalled();
      expect(await s.row(body.job_id)).toMatchObject({ status: 'queued', attempts: attempt, error: 'timeout: slow' });
      expect(s.finals).toEqual([]);
    }
    const last = msg(body, MAX_DELIVERIES);
    await s.run(last);
    expect(last.ack).toHaveBeenCalledOnce();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'timed_out', attempts: MAX_DELIVERIES });
    expect(s.ports.bucket.text(`cad/${body.job_id}/output/log.txt`)).toBe('timeout: slow');
    expect(s.finals).toEqual([{ rfq: RFQ, job: body.job_id, status: 'timed_out' }]);
    expect(s.ports.db.rows('agent_runs', ['agent', 'eq', 'cad'])[0]).toMatchObject({ status: 'failed', error: 'timeout: slow' });
  });

  it('a non-retryable failure is final at once', async () => {
    const s = await setup();
    const body = await s.enqueue();
    s.vps.outcomes = [{ ok: false, retryable: false, code: 'invalid_input', message: 'unfold 400', httpStatus: 400 }];
    const m = msg(body);
    await s.run(m);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: 'invalid_input: unfold 400' });
    expect(s.finals).toEqual([{ rfq: RFQ, job: body.job_id, status: 'failed' }]);
  });

  it('waits for a free slot, then retries the message with the router delay; the last delivery fails unavailable', async () => {
    const s = await setup();
    const body = await s.enqueue();
    const busy: CadRouterClient = {
      acquire: vi.fn(async () => ({ granted: false as const, retry_after_s: 30 })),
      release: vi.fn(async () => {}),
      report: vi.fn(async () => {}),
      snapshot: vi.fn(),
    } as unknown as CadRouterClient;
    const m = msg(body, 1);
    await s.run(m, { router: busy, leaseWaitMs: 90_000 });
    expect(s.sleeps).toEqual([30_000, 30_000, 30_000]);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(await s.row(body.job_id)).toMatchObject({ status: 'queued', attempts: 0 });
    const last = msg(body, MAX_DELIVERIES);
    await s.run(last, { router: busy });
    expect(last.ack).toHaveBeenCalledOnce();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: 'unavailable: no backend slot' });
    expect(s.finals).toHaveLength(1);
    expect(s.vps.runs).toEqual([]);
  });

  it('an input above its inline cap fails inline_too_large without a lease or a parse', async () => {
    const s = await setup({ inline: true });
    s.vps.supports = (_t?: string, kind?: string) => kind === 'step';
    const key = `rfq/${RFQ}/f2-large.dxf`;
    await s.ports.bucket.put(key, new Uint8Array(3 * 1024 * 1024 + 10));
    const body = await s.enqueue({ input: { r2_key: key, sha256: sha('c'), content_type: 'application/dxf', size_bytes: 3 * 1024 * 1024 + 10, file_name: 'large.dxf' } });
    const router = { acquire: vi.fn(), release: vi.fn(), report: vi.fn(), snapshot: vi.fn() } as unknown as CadRouterClient;
    const m = msg(body);
    await s.run(m, { router });
    expect(router.acquire).not.toHaveBeenCalled();
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: `too_large: ${INLINE_TOO_LARGE}` });
    expect(s.ports.bucket.reads.filter((r) => r.key === key)).toEqual([]);
  });

  it('a missing input object, an unsupported kind and missing CAD secrets fail with their codes', async () => {
    const s = await setup();
    const body = await s.enqueue();
    s.ports.bucket.objects.delete(body.input.r2_key);
    await s.run(msg(body));
    expect(await s.row(body.job_id)).toMatchObject({ status: 'failed', error: 'invalid_input: input object missing' });

    const t = await setup();
    t.vps.supports = () => false;
    const step = await t.enqueue();
    await t.run(msg(step));
    expect((await t.row(step.job_id)).error).toBe('config_missing: CAD_UNFOLD_URL, CAD_SHARED_SECRET');
    t.env.CAD_UNFOLD_URL = 'https://cad.example.test';
    t.env.CAD_SHARED_SECRET = 't1-cad-key';
    const other = await t.enqueue({ input: { r2_key: `rfq/${RFQ}/f3-notes.txt`, sha256: sha('d'), content_type: 'text/plain', size_bytes: 318, file_name: 'notes.txt' } });
    await t.run(msg(other));
    expect((await t.row(other.job_id)).error).toBe('unsupported: analyse of other (sheet_metal)');
  });

  it('a delivery that finds the job running elsewhere is retried later; a stale running row is taken over', async () => {
    const s = await setup();
    const body = await s.enqueue();
    await s.ports.db.update('cad_jobs', { status: 'running', started_at: s.ports.clock.now().toISOString(), attempts: 1 }, { filters: [['id', 'eq', body.job_id]] });
    const m = msg(body, 2);
    await s.run(m);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(s.vps.runs).toEqual([]);
    s.ports.clock.advance(400_000);
    const later = msg(body, 3);
    await s.run(later);
    expect(s.vps.runs).toEqual([body.job_id]);
    expect(await s.row(body.job_id)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('an unexpected error releases the lease and retries the message', async () => {
    const s = await setup();
    const body = await s.enqueue();
    const release = vi.fn(async () => {});
    const router = { acquire: vi.fn(async () => ({ granted: true, lease_id: 'l1', backend: 'vps' })), release, report: vi.fn(), snapshot: vi.fn() } as unknown as CadRouterClient;
    const put = s.ports.blob.put.bind(s.ports.blob);
    s.ports.blob.put = async (key, b, o) => {
      if (key.endsWith('result.json')) throw new Error('r2 down');
      return put(key, b, o);
    };
    const m = msg(body);
    await s.run(m, { router });
    expect(m.retry).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('l1', { ok: false, retryable: true });
    expect(s.finals).toEqual([]);
  });

  it('acknowledges malformed messages and rows that do not exist', async () => {
    const s = await setup();
    const bad = msg({ v: 2 } as unknown as CadJobMessageV1);
    await s.run(bad);
    expect(bad.ack).toHaveBeenCalledOnce();
    expect(isCadJobMessage({ v: 1, job_id: 'not-a-uuid' })).toBe(false);
    const ghost = msg({ ...(await s.enqueue()), job_id: '99999999-9999-4999-8999-999999999999' });
    await s.run(ghost);
    expect(ghost.ack).toHaveBeenCalledOnce();
  });

  it('enqueueCadJob writes the row first, dedupes by (rfq_id, idempotency_key) and sends only while queued', async () => {
    const s = await setup();
    const first = await s.enqueue();
    expect(first.idempotency_key).toBe(await cadJobKey(sha('a'), 'analyse', first.params));
    await s.enqueue();
    expect(s.ports.db.rows('cad_jobs')).toHaveLength(1);
    expect(s.queue.sent).toHaveLength(2);
    await s.run(msg(first));
    await s.enqueue();
    expect(s.queue.sent).toHaveLength(2);
    expect(first).toMatchObject({ v: 1, backend: 'auto', deadline_s: 300, input: { store: 'r2', r2_key: `rfq/${RFQ}/f1-bracket.step` } });
  });
});

describe('lists against the migration', () => {
  it('cad_jobs.status and cad_jobs.backend (with inline) equal the CHECK lists', () => {
    const statuses: CadJobStatus[] = ['queued', 'dispatched', 'running', 'succeeded', 'failed', 'timed_out', 'dead_letter', 'cancelled'];
    expect(sorted(statuses)).toEqual(sorted(checkList('cad_jobs_status_check')));
    expect(sorted(CAD_BACKENDS)).toEqual(sorted(checkList('cad_jobs_backend_check')));
    expect(CAD_BACKENDS).toContain('inline');
  });

  it('MAX_DELIVERIES is the queue max_retries + 1 of wrangler.jsonc', () => {
    const text = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    const m = /"queue":\s*"cad-jobs",[^}]*"max_retries":\s*(\d+)/.exec(text);
    expect(m).not.toBeNull();
    expect(MAX_DELIVERIES).toBe(Number(m?.[1]) + 1);
  });
});
