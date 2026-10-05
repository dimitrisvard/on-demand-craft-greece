// CAD contract (Phase 4): backends, inputs, results and outcomes of CAD jobs. Imported by the cad-jobs consumer,
// CadRouter, the intake and quote Workflows and post-order. The interfaces below are the Phase 5 seam: P5-6 adds
// the container backend (and an optional lease argument) without changing them.
//
// Rules
//   - Units are millimetres; CadResultV1 is versioned (v: 1) and stored as cad/<job_id>/output/result.json.
//   - STEP sheet-metal 'analyse' goes to the unfold service (POST /api/v1/unfold, multipart upload of the R2 object
//     with a sanitised file name, X-API-Key); DXF, STL and CNC STEP run on the inline TypeScript backend with
//     per-kind input caps (STEP 5 MB, DXF 3 MB, STL 0.75 MB) and one inline job per isolate.
//   - Phase 5 adds the container backend behind the same interface (only the fetcher changes).

import type { CadJobMessageV1 } from '../queues/messages';

export type BackendName = 'vps' | 'container' | 'inline' | 'mac_mini';

export type CadKind = 'step' | 'stl' | 'dxf' | 'other';

export interface CadInput {
  fileName: string;
  kind: CadKind;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  open(): Promise<ReadableStream | ArrayBuffer>;
}

export interface CadResultV1 {
  v: 1;
  kind: CadKind;
  source: 'unfold-service' | 'inline-ts';
  units: 'mm';
  thickness_mm: number | null;
  flat: { width_mm: number; height_mm: number; area_mm2: number | null; cut_length_mm: number | null; pierces: number | null } | null;
  bends: { count: number; items: Array<{ angle_deg: number; radius_mm: number | null }> } | null;
  bbox_mm: { x: number; y: number; z: number } | null;
  volume_mm3: number | null;
  warnings: string[];
  versions: Record<string, string>;
  duration_ms: number;
}

export interface CadArtefact {
  name: 'flat.dxf' | 'drawing.pdf' | 'flat.svg' | 'log.txt';
  contentType: string;
  body: ArrayBuffer;
}

export type CadOutcome =
  | { ok: true; result: CadResultV1; artefacts: CadArtefact[] }
  | {
      ok: false;
      retryable: boolean;
      code: 'invalid_input' | 'unsupported' | 'timeout' | 'unavailable' | 'backend_error' | 'too_large';
      message: string;
      httpStatus?: number;
    };

export interface CadBackend {
  readonly name: BackendName;
  /** async = 202 + signed callback (a later backend); every Phase 4 backend is sync. */
  readonly mode: 'sync' | 'async';
  /** vps 1, inline 1, container 3 (Phase 5), mac_mini 1. */
  readonly maxConcurrency: number;
  supports(jobType: CadJobMessageV1['job_type'], kind: CadKind, process: string): boolean;
  health(signal: AbortSignal): Promise<boolean>;
  run(job: CadJobMessageV1, input: CadInput, signal: AbortSignal): Promise<CadOutcome>;
}

export interface CadBackendRegistry {
  get(name: BackendName): CadBackend | undefined;
  /** Backends to try for a job, in order ('auto' = CAD_BACKEND_DEFAULT, then inline where it supports the pair). */
  candidates(job: CadJobMessageV1, kind: CadKind): BackendName[];
}

/** Sends one request to an unfold service (fetch for the VPS; the Container's fetch in Phase 5). */
export type UnfoldFetcher = (req: Request) => Promise<Response>;

/** Final cad_jobs.status values. */
export type CadFinalStatus = 'succeeded' | 'failed' | 'timed_out' | 'dead_letter' | 'cancelled';

/** = cad_jobs_status_check (agent-layer migration). */
export type CadJobStatus = 'queued' | 'dispatched' | 'running' | CadFinalStatus;

/** = cad_jobs_backend_check (agent-layer migration, with 'inline'). */
export const CAD_BACKENDS: readonly BackendName[] = ['vps', 'container', 'inline', 'mac_mini'];

export const CAD_FINAL_STATUSES: readonly CadFinalStatus[] = ['succeeded', 'failed', 'timed_out', 'dead_letter', 'cancelled'];

export function isFinalCadStatus(status: unknown): status is CadFinalStatus {
  return typeof status === 'string' && (CAD_FINAL_STATUSES as readonly string[]).includes(status);
}

/** 1 MB as the input caps count it (MiB). */
export const MB = 1024 * 1024;

/** Largest input of any CAD job: the unfold service accepts at most 50 MB (sheet-metal-service/config.py:36). */
export const MAX_INPUT_BYTES = 50 * MB;

/**
 * Inline backend input caps per kind: half of the largest synthetic worst-case input that the unchanged parsers
 * handled under a 96 MB V8 heap (STEP 10 MB, DXF 6 MB, binary STL 1.5 MB), so one parse fits the 128 MB isolate.
 */
export const INLINE_CAPS: Readonly<Record<'step' | 'dxf' | 'stl', number>> = Object.freeze({
  step: 5 * MB,
  dxf: 3 * MB,
  stl: 0.75 * MB,
});

/** Warning (and failure message) of an input above its inline cap; the quote prices that part by hand. */
export const INLINE_TOO_LARGE = 'inline_too_large';

/** Wall-clock limit of one CAD job, enforced by the consumer (the unfold service does not enforce its own). */
export const JOB_DEADLINE_S = 300;

/** CAD kind of a file by its extension, else by its content type. */
export function cadKindOf(fileName: string, contentType = ''): CadKind {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1]?.toLowerCase() ?? '';
  if (ext === 'step' || ext === 'stp') return 'step';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'stl') return 'stl';
  const type = contentType.toLowerCase();
  if (type.includes('step') || type.includes('iso-10303')) return 'step';
  if (type.includes('dxf')) return 'dxf';
  if (type.includes('stl')) return 'stl';
  return 'other';
}

/** Output file names of a job under cad/<job_id>/output/. */
export const CAD_OUTPUT_NAMES = ['result.json', 'flat.dxf', 'drawing.pdf', 'flat.svg', 'log.txt'] as const;

/** R2 key of one output of a job. */
export function cadOutputKey(jobId: string, name: (typeof CAD_OUTPUT_NAMES)[number]): string {
  return `cad/${jobId}/output/${name}`;
}
