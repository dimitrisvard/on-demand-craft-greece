// public.cad_jobs through the Db port (service role), and the producer helper that writes a job row and then sends
// its queue message.
//
// Rules
//   - One job per (rfq_id, idempotency_key) (NULLS NOT DISTINCT): idempotency_key = '<input sha256>:<job_type>:
//     <sha256 of the canonical JSON of params>' (src/agents/ids.ts cadJobKey). A second enqueue of the same work
//     returns the existing row.
//   - The row is written first, then the message is sent; a message is sent only while the row is 'queued' (an
//     existing final row is reused as it is).
//   - The consumer claims a job with a conditional update (status 'queued' -> 'dispatched'), so two deliveries of one
//     message never both run it.
//   - Status values are the CHECK list of the migration (cad_jobs_status_check).

import { cadJobKey } from '../../agents/ids';
import type { BackendName, CadJobStatus, CadResultV1 } from '../../cad/types';
import { JOB_DEADLINE_S } from '../../cad/types';
import type { OpsEnv } from '../../env';
import type { CadJobMessageV1 } from '../../queues/messages';
import type { Db, Filter } from '../postgrest';

export interface CadJobRow {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
  job_type: CadJobMessageV1['job_type'];
  backend: BackendName | null;
  rfq_id: string | null;
  rfq_file_id: string | null;
  quote_workflow_id: string | null;
  input_r2_key: string;
  input_sha256: string;
  params: Record<string, unknown>;
  output_r2_keys: string[];
  result: CadResultV1 | null;
  status: CadJobStatus;
  attempts: number;
  requested_by_run_id: string | null;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

export type CadJobPatch = Partial<
  Pick<CadJobRow, 'backend' | 'output_r2_keys' | 'result' | 'status' | 'attempts' | 'started_at' | 'finished_at' | 'duration_ms' | 'error'>
>;

export async function getCadJob(db: Db, id: string): Promise<CadJobRow | null> {
  const rows = await db.select<CadJobRow & Record<string, unknown>>('cad_jobs', { filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

/** A succeeded job with the same key (any RFQ) other than `excludeId`: its result and outputs can be reused. */
export async function findReusable(db: Db, idempotencyKey: string, excludeId: string): Promise<CadJobRow | null> {
  const rows = await db.select<CadJobRow & Record<string, unknown>>('cad_jobs', {
    filters: [
      ['idempotency_key', 'eq', idempotencyKey],
      ['status', 'eq', 'succeeded'],
    ],
    order: [{ column: 'finished_at', ascending: false }],
    limit: 5,
  });
  return rows.find((r) => r.id !== excludeId && r.result !== null) ?? null;
}

export async function patchCadJob(db: Db, id: string, patch: CadJobPatch): Promise<void> {
  await db.update('cad_jobs', patch as Record<string, unknown>, { filters: [['id', 'eq', id]] });
}

/** status 'queued' -> 'dispatched' (attempts + 1, backend, started_at) only if the row is still queued. */
export async function claimCadJob(db: Db, row: Pick<CadJobRow, 'id' | 'attempts'>, backend: BackendName, now: Date): Promise<boolean> {
  const updated = await db.update(
    'cad_jobs',
    { status: 'dispatched', attempts: row.attempts + 1, backend, started_at: now.toISOString(), error: null },
    { filters: [['id', 'eq', row.id], ['status', 'eq', 'queued']], returning: 'id' },
  );
  return updated.length > 0;
}

/** Final jobs of an RFQ (or of the given ids). */
export async function cadJobsOf(db: Db, o: { rfq_id?: string; ids?: string[] }): Promise<CadJobRow[]> {
  const filters: Filter[] = [];
  if (o.rfq_id) filters.push(['rfq_id', 'eq', o.rfq_id]);
  if (o.ids) {
    if (o.ids.length === 0) return [];
    filters.push(['id', 'in', o.ids]);
  }
  if (filters.length === 0) throw new Error('cadJobsOf needs rfq_id or ids');
  return db.select<CadJobRow & Record<string, unknown>>('cad_jobs', { filters, order: [{ column: 'created_at', ascending: true }] });
}

export interface NewCadJob {
  tenant_id: string;
  rfq_id: string | null;
  rfq_file_id: string | null;
  quote_workflow_id: string | null;
  job_type: CadJobMessageV1['job_type'];
  input: { r2_key: string; sha256: string; content_type: string; size_bytes: number; file_name: string };
  params: CadJobMessageV1['params'];
  backend?: CadJobMessageV1['backend'];
  deadline_s?: number;
  /** agent_runs id of the run that asked for the job. */
  requested_by_run_id: string;
}

/** The queue message of a job row. */
export function cadJobMessage(row: Pick<CadJobRow, 'id' | 'idempotency_key' | 'job_type' | 'tenant_id' | 'rfq_id' | 'rfq_file_id' | 'quote_workflow_id' | 'input_r2_key' | 'input_sha256'>, j: Pick<NewCadJob, 'input' | 'params' | 'backend' | 'deadline_s' | 'requested_by_run_id'>): CadJobMessageV1 {
  return {
    v: 1,
    job_id: row.id,
    idempotency_key: row.idempotency_key,
    job_type: row.job_type,
    tenant_id: row.tenant_id,
    rfq_id: row.rfq_id,
    rfq_file_id: row.rfq_file_id,
    quote_workflow_id: row.quote_workflow_id,
    input: { store: 'r2', r2_key: row.input_r2_key, sha256: row.input_sha256, content_type: j.input.content_type, size_bytes: j.input.size_bytes, file_name: j.input.file_name },
    params: j.params,
    backend: j.backend ?? 'auto',
    deadline_s: Math.min(j.deadline_s ?? JOB_DEADLINE_S, JOB_DEADLINE_S),
    run_id: j.requested_by_run_id,
  };
}

/**
 * Writes the job row (or finds the existing one) and, while the row is queued, sends its message on CAD_JOBS.
 * Returns the job id, whether the row is new and its status.
 */
export async function enqueueCadJob(env: Pick<OpsEnv, 'CAD_JOBS'>, db: Db, j: NewCadJob): Promise<{ job_id: string; created: boolean; status: CadJobStatus; sent: boolean }> {
  const idempotency_key = await cadJobKey(j.input.sha256, j.job_type, j.params);
  const inserted = await db.insert<CadJobRow & Record<string, unknown>>(
    'cad_jobs',
    {
      tenant_id: j.tenant_id,
      idempotency_key,
      job_type: j.job_type,
      rfq_id: j.rfq_id,
      rfq_file_id: j.rfq_file_id,
      quote_workflow_id: j.quote_workflow_id,
      input_r2_key: j.input.r2_key,
      input_sha256: j.input.sha256,
      params: j.params,
      requested_by_run_id: j.requested_by_run_id,
    },
    { onConflict: ['rfq_id', 'idempotency_key'], ignoreDuplicates: true, returning: true },
  );
  let row: CadJobRow | undefined = inserted[0];
  const created = row !== undefined;
  if (!row) {
    const existing = await db.select<CadJobRow & Record<string, unknown>>('cad_jobs', {
      filters: [j.rfq_id === null ? ['rfq_id', 'is', null] : ['rfq_id', 'eq', j.rfq_id], ['idempotency_key', 'eq', idempotency_key]],
      limit: 1,
    });
    row = existing[0];
    if (!row) throw new Error('cad job row neither inserted nor found');
  }
  if (row.status !== 'queued') return { job_id: row.id, created, status: row.status, sent: false };
  if (!env.CAD_JOBS) throw new Error('config_missing: CAD_JOBS');
  await env.CAD_JOBS.send(cadJobMessage(row, j), { contentType: 'json' });
  return { job_id: row.id, created, status: row.status, sent: true };
}
