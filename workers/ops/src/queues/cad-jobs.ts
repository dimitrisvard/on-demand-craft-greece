// Consumer of the queue "cad-jobs": one CAD job per delivery (lease from CadRouter, backend run under the job
// deadline, outputs to R2 cad/<job_id>/output/, cad_jobs row final, RfqThread.cadJobFinal exactly once).
//
// Steps per message
//   1 Load     the cad_jobs row by job_id (the row is the record; the message only names it). A missing row or a
//              malformed message is acknowledged and logged; a final row is acknowledged (duplicate delivery), after
//              repeating the final notice when the job's run is still open (an earlier delivery made the row final but
//              did not get its notice through). A row another delivery is running (dispatched/running within the
//              deadline plus LEASE_GRACE_S) is retried once that window has passed (delay = the rest of the window);
//              the last delivery waits for the end of the window in its own invocation instead, then takes the job
//              over unless it became final meanwhile. A row whose window has passed is taken over at once.
//   2 Run row  agent_runs (agent 'cad', trigger 'queue', idempotency key = job id) through rpc/agent_run_begin.
//   3 Reuse    a succeeded job with the same idempotency key (any RFQ): its result and outputs are copied (the R2
//              objects are referenced, not copied).
//   4 Input    R2 head of the input: missing -> failed 'invalid_input'; above 50 MB -> failed 'too_large'; an input
//              above its inline cap is never parsed (failed 'too_large: inline_too_large' when inline was the only
//              backend for it); a STEP sheet-metal analysis without a usable unfold backend fails 'config_missing'
//              or 'config_invalid' with the names of the values concerned (cad/registry.ts).
//   5 Lease    CadRouter.acquire; while no slot is free the consumer waits up to LEASE_WAIT_MS in this invocation,
//              then retries the message with the router's delay (the last delivery fails 'unavailable' instead).
//   6 Claim    conditional update queued -> dispatched (attempts + 1, backend), then running.
//   7 Run      backend.run under AbortSignal.timeout(min(deadline_s, 300) s), input streamed from R2.
//   8 Store    artefacts and result.json to cad/<job_id>/output/; on failure log.txt (code and short message).
//   9 Finish   succeeded / failed (not retryable) / back to queued with message.retry() (retryable, deliveries
//              left) / timed_out or failed on the last delivery; release the lease (backend_down for unreachable
//              services); RfqThread(rfq_id).cadJobFinal(job_id, status) once the row is final; closeRun; one
//              Analytics Engine point (event 'cad_job'). When cadJobFinal throws, the message is retried with the
//              run left open (the redelivery repeats the notice, step 1); on the last delivery the run closes with
//              notice 'failed' and the quote's CAD wait ends by its own timeout.
// Rules
//   - A row becomes final exactly once, and cadJobFinal is called until one call succeeds (RfqThread stores the
//     final status per job, so a repeated call changes nothing); retries never pass through a final status.
//     Messages that throw unexpectedly are retried; after the queue's retries they land in cad-jobs-dlq and the
//     dispatcher marks the row dead_letter.
//   - Retry delays stay within the queue limit of 24 hours (CF docs (fetched 2026-10-03)
//     https://developers.cloudflare.com/queues/platform/limits/, delaySeconds); the last-delivery wait stays far
//     below the 15-minute wall time of a consumer invocation (same page).
//   - Log lines carry ids, codes and sizes only (never file names or service answers).
// Phase 5 (P5-6)
//   - The lease is acquired with priority 'batch' (CadRouter keeps one container slot for the compat path), and
//     its slot travels to backend.run as the 4th argument (the container backend runs the job on that slot).
//   - An outcome with recycle (the service crashed, or the container refused the key) releases the lease with
//     {recycle: true}, so CadRouter destroys that slot's container. A crash answer is retried once: when the job's
//     previous delivery already ended in a crash, the second crash is final.
//   - An outcome with an alert sends one plain-text Telegram line through P5Ports.telegramText (at most one per
//     alert kind and backend per isolate and hour): CAD key mismatch, or no key configured.
//   - With CAD_BACKEND_DEFAULT = 'container', a STEP sheet-metal analysis without a usable backend fails
//     'config_missing' with the container's missing names (missingContainerConfig).

import { formatLogLine } from '../../../shared/src/http/log';
import { EMPTY_USAGE, closeRun, openRun } from '../agents/runs';
import { isBackendDown, isCrashOutcome } from '../cad/backends/http-unfold';
import { invalidCadConfig, missingCadConfig, missingContainerConfig } from '../cad/registry';
import { cadRouter, notifyCadJobFinal, type CadRouterClient } from '../cad/router-client';
import {
  INLINE_CAPS,
  INLINE_TOO_LARGE,
  JOB_DEADLINE_S,
  MAX_INPUT_BYTES,
  cadKindOf,
  cadOutputKey,
  isFinalCadStatus,
  type BackendName,
  type CadFinalStatus,
  type CadInput,
  type CadKind,
  type CadOutcome,
  type ReleaseOutcome,
} from '../cad/types';
import { claimCadJob, findReusable, getCadJob, patchCadJob, type CadJobRow } from '../db/repos/cad-jobs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { makeP5Ports, type TelegramTextPort } from '../ports/p5';
import { sendCadAlert } from '../cad-container/alerts';
import { LEASE_GRACE_S } from '../do/cad-router';
import type { AcquireRequest } from '../cad/types';
import type { CadJobMessageV1 } from './messages';

/** Deliveries of one message: the queue's max_retries (2, wrangler.jsonc) + 1. */
export const MAX_DELIVERIES = 3;
/** Longest in-invocation wait for a free backend slot before the message is retried. */
export const LEASE_WAIT_MS = 120_000;
/** Added to the rest of the lease window when a delivery finds the job running elsewhere. */
export const BUSY_MARGIN_S = 5;
/** Longest delaySeconds of a queue retry (24 hours, CF docs Queues limits, fetched 2026-10-03). */
export const MAX_RETRY_DELAY_S = 86_400;
/** Delay of a retry after a failed RfqThread.cadJobFinal call. */
export const NOTIFY_RETRY_S = 30;

/** Retry delay of a delivery that finds the job running elsewhere: the rest of the lease window plus a margin. */
export function busyRetryDelayS(remainingMs: number): number {
  return Math.min(MAX_RETRY_DELAY_S, Math.max(1, Math.ceil(remainingMs / 1000)) + BUSY_MARGIN_S);
}
/** log.txt and the stored error stay short. */
export const LOG_MAX_CHARS = 4000;

/** The error text a crash outcome leaves on the job row (a later delivery reads it). */
function isCrashError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith('backend_error: unfold 500 processing crashed');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CadConsumerDeps {
  ports?: Ports;
  router?: CadRouterClient;
  /** Phase 5: the plain-text Telegram port of the CAD alerts (default makeP5Ports(env).telegramText). */
  telegramText?: TelegramTextPort;
  /** Waits ms (default setTimeout); tests pass a virtual clock. */
  sleep?: (ms: number) => Promise<void>;
  leaseWaitMs?: number;
  notifyFinal?: (rfqId: string, jobId: string, status: CadFinalStatus) => Promise<void>;
}

/** v 1 with a uuid job_id (everything else is read from the row). */
export function isCadJobMessage(body: unknown): body is CadJobMessageV1 {
  if (typeof body !== 'object' || body === null) return false;
  const m = body as Partial<CadJobMessageV1>;
  return m.v === 1 && typeof m.job_id === 'string' && UUID.test(m.job_id);
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

function errorText(outcome: Extract<CadOutcome, { ok: false }>): string {
  return `${outcome.code}: ${outcome.message}`.slice(0, LOG_MAX_CHARS);
}

/** The message as the job row describes it (row values win over message values). */
function jobFromRow(row: CadJobRow, m: CadJobMessageV1): CadJobMessageV1 {
  const params = row.params as Partial<CadJobMessageV1['params']>;
  return {
    ...m,
    idempotency_key: row.idempotency_key,
    job_type: row.job_type,
    tenant_id: row.tenant_id,
    rfq_id: row.rfq_id,
    rfq_file_id: row.rfq_file_id,
    quote_workflow_id: row.quote_workflow_id,
    input: { ...m.input, store: 'r2', r2_key: row.input_r2_key, sha256: row.input_sha256 },
    params: {
      material: typeof params.material === 'string' ? params.material : m.params?.material ?? 'steel',
      thickness_override: typeof params.thickness_override === 'number' ? params.thickness_override : 0,
      k_factor_override: typeof params.k_factor_override === 'number' ? params.k_factor_override : 0,
      drawing_size: params.drawing_size === 'A4' ? 'A4' : 'A3',
      process: params.process ?? m.params?.process ?? 'other',
    },
    backend: m.backend ?? 'auto',
    deadline_s: Math.min(Number.isFinite(m.deadline_s) && m.deadline_s > 0 ? m.deadline_s : JOB_DEADLINE_S, JOB_DEADLINE_S),
  };
}

interface Finish {
  status: CadFinalStatus;
  backend: BackendName | null;
  outcome: string;
  error?: string;
  duration_ms: number;
}

class Job {
  private lease: { id: string; backend: BackendName; slot?: string } | null = null;
  private runId: string | null = null;

  constructor(
    private readonly env: OpsEnv,
    private readonly ports: Ports,
    private readonly deps: Required<Pick<CadConsumerDeps, 'sleep' | 'leaseWaitMs' | 'notifyFinal'>> & { router: () => CadRouterClient; telegramText: () => TelegramTextPort },
    private readonly message: Message<CadJobMessageV1>,
  ) {}

  private now(): Date {
    return this.ports.clock.now();
  }

  async handle(): Promise<void> {
    const body = this.message.body;
    if (!isCadJobMessage(body)) {
      log('cad job message rejected', { reason: 'shape' });
      this.message.ack();
      return;
    }
    let row = await getCadJob(this.ports.db, body.job_id);
    if (!row) {
      log('cad job row missing', { job_id: body.job_id });
      this.message.ack();
      return;
    }
    const job = jobFromRow(row, body);
    if (isFinalCadStatus(row.status)) return this.finalRow(row, job);
    if (row.status === 'dispatched' || row.status === 'running') {
      const started = row.started_at ? Date.parse(row.started_at) : NaN;
      const remainingMs = Number.isFinite(started) ? started + (job.deadline_s + LEASE_GRACE_S) * 1000 - this.now().getTime() : 0;
      if (remainingMs > 0) {
        if (this.message.attempts < MAX_DELIVERIES) {
          this.message.retry({ delaySeconds: busyRetryDelayS(remainingMs) });
          return;
        }
        // The last delivery: no later one would take the job over, so this one waits for the window to end.
        await this.deps.sleep(remainingMs + BUSY_MARGIN_S * 1000);
        const again = await getCadJob(this.ports.db, row.id);
        if (!again) {
          this.message.ack();
          return;
        }
        if (isFinalCadStatus(again.status)) return this.finalRow(again, job);
        row = again;
      }
      if (row.status === 'dispatched' || row.status === 'running') {
        // An earlier delivery stopped without finishing (its lease has expired): the job is queued again.
        await this.ports.db.update('cad_jobs', { status: 'queued' }, { filters: [['id', 'eq', row.id], ['status', 'in', ['dispatched', 'running']]] });
        row.status = 'queued';
      }
    }

    const run = await openRun(this.ports.db, {
      agent: 'cad',
      trigger: 'queue',
      idempotency_key: row.id,
      subject_type: 'cad_job',
      subject_id: row.id,
      parent_run_id: row.requested_by_run_id ?? undefined,
      tenant_id: row.tenant_id,
    });
    this.runId = run.run_id;

    // 3 Reuse
    const reusable = await findReusable(this.ports.db, row.idempotency_key, row.id);
    if (reusable) {
      await patchCadJob(this.ports.db, row.id, {
        status: 'succeeded',
        backend: reusable.backend,
        result: reusable.result,
        output_r2_keys: reusable.output_r2_keys,
        finished_at: this.now().toISOString(),
        duration_ms: 0,
        error: null,
      });
      await this.finish(row, job, { status: 'succeeded', backend: reusable.backend, outcome: 'reused', duration_ms: 0 }, { reused_from: reusable.id });
      return;
    }

    // 4 Input
    const head = await this.ports.blob.head(row.input_r2_key);
    if (!head) return this.failFinal(row, job, 'invalid_input', 'input object missing', null);
    if (head.size > MAX_INPUT_BYTES) return this.failFinal(row, job, 'too_large', 'input above 50 MB', null);
    const kind: CadKind = cadKindOf(job.input.file_name || row.input_r2_key, job.input.content_type ?? '');
    let candidates = this.ports.cad.candidates(job, kind);
    const inlineCapped = kind !== 'other' && head.size > INLINE_CAPS[kind];
    if (inlineCapped && candidates.includes('inline')) {
      candidates = candidates.filter((c) => c !== 'inline');
      if (candidates.length === 0) return this.failFinal(row, job, 'too_large', INLINE_TOO_LARGE, null);
    }
    if (candidates.length === 0) {
      const needsVps = kind === 'step' && job.job_type === 'analyse' && ['sheet_metal', 'mixed'].includes(job.params.process);
      const wantsContainer = job.backend === 'container' || (job.backend === 'auto' && this.env.CAD_BACKEND_DEFAULT === 'container');
      const missing = needsVps ? (wantsContainer ? missingContainerConfig(this.env) : missingCadConfig(this.env)) : [];
      if (missing.length > 0) return this.failFinal(row, job, 'config_missing', missing.join(', '), null);
      const invalid = needsVps ? invalidCadConfig(this.env) : [];
      if (invalid.length > 0) return this.failFinal(row, job, 'config_invalid', invalid.join(', '), null);
      return this.failFinal(row, job, 'unsupported', `${job.job_type} of ${kind} (${job.params.process})`, null);
    }

    // 5 Lease
    const router = this.deps.router();
    const request: AcquireRequest = { job_id: row.id, backend_candidates: candidates, deadline_s: job.deadline_s, priority: 'batch' };
    let waited = 0;
    for (;;) {
      const granted = await router.acquire(request);
      if (granted.granted) {
        this.lease = granted.slot ? { id: granted.lease_id, backend: granted.backend, slot: granted.slot } : { id: granted.lease_id, backend: granted.backend };
        break;
      }
      if (waited >= this.deps.leaseWaitMs) {
        if (this.message.attempts >= MAX_DELIVERIES) return this.failFinal(row, job, 'unavailable', 'no backend slot', null);
        this.message.retry({ delaySeconds: granted.retry_after_s });
        return;
      }
      const pause = Math.min(granted.retry_after_s * 1000, this.deps.leaseWaitMs - waited);
      await this.deps.sleep(pause);
      waited += pause;
    }
    const backendName = this.lease.backend;
    const backend = this.ports.cad.get(backendName);
    if (!backend) {
      await this.releaseLease({ ok: false });
      return this.failFinal(row, job, 'unsupported', `backend ${backendName} not registered`, null);
    }

    // 6 Claim
    if (!(await claimCadJob(this.ports.db, row, backendName, this.now()))) {
      await this.releaseLease({ ok: false });
      this.message.ack();
      return;
    }
    await patchCadJob(this.ports.db, row.id, { status: 'running' });

    // 7 Run
    const started = Date.now();
    const blob = this.ports.blob;
    const input: CadInput = {
      fileName: job.input.file_name || row.input_r2_key.split('/').pop() || 'input',
      kind,
      contentType: job.input.content_type || 'application/octet-stream',
      sizeBytes: head.size,
      sha256: row.input_sha256,
      open: async () => {
        const object = await blob.get(row.input_r2_key);
        if (!object) throw new Error('input object missing');
        return object.body;
      },
    };
    let outcome: CadOutcome;
    const lease = this.lease.slot ? { lease_id: this.lease.id, slot: this.lease.slot } : { lease_id: this.lease.id };
    try {
      outcome = await backend.run(job, input, AbortSignal.timeout(job.deadline_s * 1000), lease);
    } catch {
      outcome = { ok: false, retryable: true, code: 'backend_error', message: 'backend threw' };
    }
    const duration_ms = Date.now() - started;

    // 8 Store
    if (outcome.ok) {
      const keys: string[] = [];
      for (const a of outcome.artefacts) {
        const key = cadOutputKey(row.id, a.name);
        await blob.put(key, a.body, { contentType: a.contentType });
        keys.push(key);
      }
      const resultKey = cadOutputKey(row.id, 'result.json');
      await blob.put(resultKey, new TextEncoder().encode(JSON.stringify(outcome.result)).buffer as ArrayBuffer, { contentType: 'application/json' });
      keys.unshift(resultKey);
      await patchCadJob(this.ports.db, row.id, {
        status: 'succeeded',
        result: outcome.result,
        output_r2_keys: keys,
        finished_at: this.now().toISOString(),
        duration_ms,
        error: null,
      });
      await this.releaseLease({ ok: true });
      await this.finish(row, job, { status: 'succeeded', backend: backendName, outcome: 'ok', duration_ms });
      return;
    }

    await blob.put(cadOutputKey(row.id, 'log.txt'), new TextEncoder().encode(errorText(outcome)).buffer as ArrayBuffer, { contentType: 'text/plain; charset=utf-8' });
    await this.releaseLease({ ok: false, retryable: outcome.retryable, backend_down: isBackendDown(outcome), ...(outcome.recycle ? { recycle: true } : {}) });
    if (outcome.alert) await sendCadAlert(this.deps.telegramText, outcome.alert, backendName, this.now().getTime());
    // A crash is retried once: the second crash of the same job is final.
    if (isCrashOutcome(outcome) && isCrashError(row.error)) outcome = { ...outcome, retryable: false };
    if (outcome.retryable && this.message.attempts < MAX_DELIVERIES) {
      await patchCadJob(this.ports.db, row.id, { status: 'queued', error: errorText(outcome), duration_ms });
      this.ports.events.point({ event: 'cad_job', run_id: this.runId ?? row.id, agent: 'cad', step: job.job_type, route: backendName, outcome: `retry_${outcome.code}`, tenant_id: row.tenant_id, latency_ms: duration_ms, attempt: this.message.attempts, bytes: head.size });
      this.message.retry();
      return;
    }
    const status: CadFinalStatus = outcome.code === 'timeout' ? 'timed_out' : 'failed';
    await patchCadJob(this.ports.db, row.id, { status, error: errorText(outcome), finished_at: this.now().toISOString(), duration_ms, output_r2_keys: [cadOutputKey(row.id, 'log.txt')] });
    await this.finish(row, job, { status, backend: backendName, outcome: outcome.code, error: errorText(outcome), duration_ms });
  }

  private async releaseLease(outcome: ReleaseOutcome): Promise<void> {
    const lease = this.lease;
    if (!lease) return;
    this.lease = null;
    try {
      await this.deps.router().release(lease.id, outcome);
    } catch {
      log('cad lease release failed', { backend: lease.backend });
    }
  }

  /** Releases a held lease after an unexpected error (the message is retried by the caller). */
  async abandon(): Promise<void> {
    await this.releaseLease({ ok: false, retryable: true });
  }

  private async failFinal(row: CadJobRow, job: CadJobMessageV1, code: string, message: string, backend: BackendName | null): Promise<void> {
    const error = `${code}: ${message}`.slice(0, LOG_MAX_CHARS);
    await patchCadJob(this.ports.db, row.id, { status: 'failed', error, finished_at: this.now().toISOString(), duration_ms: 0 });
    await this.finish(row, job, { status: 'failed', backend, outcome: code, error, duration_ms: 0 });
  }

  /** A row that is already final: the final notice is repeated when the job's run is still open, then the message
   *  is acknowledged (a duplicate delivery of a finished job changes nothing). */
  private async finalRow(row: CadJobRow, job: CadJobMessageV1): Promise<void> {
    const open = (
      await this.ports.db.select<{ id: string; status: string }>('agent_runs', {
        columns: 'id,status',
        filters: [['agent', 'eq', 'cad'], ['idempotency_key', 'eq', row.id], ['status', 'eq', 'running']],
        limit: 1,
      })
    )[0];
    if (!open) {
      this.message.ack();
      return;
    }
    this.runId = open.id;
    const status = row.status as CadFinalStatus;
    await this.finish(row, job, { status, backend: row.backend, outcome: 'notice_repeated', ...(status === 'succeeded' ? {} : { error: row.error ?? status }), duration_ms: row.duration_ms ?? 0 });
  }

  private async finish(row: CadJobRow, job: CadJobMessageV1, f: Finish, extra: Record<string, unknown> = {}): Promise<void> {
    let notice: 'sent' | 'failed' | 'none' = 'none';
    if (row.rfq_id) {
      try {
        await this.deps.notifyFinal(row.rfq_id, row.id, f.status);
        notice = 'sent';
      } catch {
        log('cad job final notice failed', { job_id: row.id, attempt: this.message.attempts });
        if (this.message.attempts < MAX_DELIVERIES) {
          // The run stays open: the redelivery finds the final row and repeats the notice (finalRow).
          this.message.retry({ delaySeconds: NOTIFY_RETRY_S });
          return;
        }
        notice = 'failed';
      }
    }
    if (this.runId) {
      await closeRun(
        this.ports.db,
        this.runId,
        {
          status: f.status === 'succeeded' ? 'succeeded' : 'failed',
          ...(f.error ? { error: f.error } : {}),
          output: { job_id: row.id, job_type: job.job_type, backend: f.backend, status: f.status, outcome: f.outcome, duration_ms: f.duration_ms, notice, ...extra },
        },
        { ...EMPTY_USAGE, by_step: {} },
      );
    }
    this.ports.events.point({
      event: 'cad_job',
      run_id: this.runId ?? row.id,
      agent: 'cad',
      step: job.job_type,
      route: f.backend ?? 'none',
      outcome: f.outcome,
      tenant_id: row.tenant_id,
      latency_ms: f.duration_ms,
      attempt: this.message.attempts,
    });
    log('cad job finished', { job_id: row.id, status: f.status, backend: f.backend ?? 'none', outcome: f.outcome, ms: f.duration_ms });
    this.message.ack();
  }
}

export async function cadJobsConsumer(batch: MessageBatch<CadJobMessageV1>, env: OpsEnv, ctx: ExecutionContext, deps: CadConsumerDeps = {}): Promise<void> {
  void ctx;
  const ports = deps.ports ?? makePorts(env);
  let router: CadRouterClient | undefined = deps.router;
  let telegramText: TelegramTextPort | undefined = deps.telegramText;
  const resolved = {
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    leaseWaitMs: deps.leaseWaitMs ?? LEASE_WAIT_MS,
    notifyFinal: deps.notifyFinal ?? ((rfqId: string, jobId: string, status: CadFinalStatus) => notifyCadJobFinal(env, rfqId, jobId, status)),
    router: () => (router ??= cadRouter(env)),
    telegramText: () => (telegramText ??= makeP5Ports(env).telegramText),
  };
  for (const message of batch.messages) {
    const job = new Job(env, ports, resolved, message);
    try {
      await job.handle();
    } catch (error) {
      await job.abandon();
      const name = error instanceof Error ? error.name : 'error';
      log('cad job delivery failed', { error: name, attempt: message.attempts });
      message.retry();
    }
  }
}
