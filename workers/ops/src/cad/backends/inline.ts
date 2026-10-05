// InlineBackend: geometry analysis inside the Worker with the TypeScript parsers copied from the
// generate-manufacturing-pdf edge function (src/cad/inline/*, identical apart from their import lines).
//
// Rules
//   - Supports 'analyse' of DXF (flat pattern + metrics), STL (bounding box, volume) and STEP for CNC or other
//     processes (bounding box, volume). STEP sheet metal is the unfold service's job.
//   - Input caps per kind (INLINE_CAPS: STEP 5 MB, DXF 3 MB, STL 0.75 MB) are checked against the stored size before
//     any byte is read; a larger input fails 'too_large' with message 'inline_too_large' (the quote prices it by
//     hand). The parsers hold the whole model in memory and the isolate has 128 MB.
//   - One inline parse per isolate at a time (module-level mutex); CadRouter also grants at most one inline lease.
//   - The parsers are synchronous: the job signal is checked before and after the parse.

import type { CadJobMessageV1 } from '../../queues/messages';
import { dxfMetrics } from '../dxf-metrics';
import { parseDXF } from '../inline/dxf-parser';
import { analyzeMesh } from '../inline/mesh-analyzer';
import { parseSTEP } from '../inline/step-parser';
import { parseSTL } from '../inline/stl-parser';
import { resultFromDxf, resultFromMesh } from '../result';
import { INLINE_CAPS, INLINE_TOO_LARGE, type CadBackend, type CadInput, type CadKind, type CadOutcome } from '../types';

/** Parser version recorded in CadResultV1.versions. */
export const INLINE_VERSION = 'generate-manufacturing-pdf parsers, copy of 2026-10-05';

let tail: Promise<void> = Promise.resolve();

/** Runs fn after every earlier inline job of this isolate has finished (module-level mutex). */
export async function withInlineLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/** Reads an input fully (inputs are capped far below the isolate memory). */
async function bytesOf(content: ReadableStream | ArrayBuffer): Promise<ArrayBuffer> {
  if (content instanceof ArrayBuffer) return content;
  return new Response(content).arrayBuffer();
}

export class InlineBackend implements CadBackend {
  readonly name = 'inline' as const;
  readonly mode = 'sync' as const;
  readonly maxConcurrency = 1;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  supports(jobType: CadJobMessageV1['job_type'], kind: CadKind, process: string): boolean {
    if (jobType !== 'analyse') return false;
    if (kind === 'dxf' || kind === 'stl') return true;
    return kind === 'step' && (process === 'cnc' || process === 'other');
  }

  async health(): Promise<boolean> {
    return true;
  }

  async run(job: CadJobMessageV1, input: CadInput, signal: AbortSignal): Promise<CadOutcome> {
    if (!this.supports(job.job_type, input.kind, job.params.process)) {
      return { ok: false, retryable: false, code: 'unsupported', message: `${job.job_type} of ${input.kind} is not supported inline` };
    }
    const kind = input.kind as 'dxf' | 'stl' | 'step';
    if (input.sizeBytes > INLINE_CAPS[kind]) return { ok: false, retryable: false, code: 'too_large', message: INLINE_TOO_LARGE };
    return withInlineLock(async () => {
      if (signal.aborted) return { ok: false, retryable: true, code: 'timeout', message: 'inline job timed out before the parse' };
      const started = this.clock();
      let bytes: ArrayBuffer;
      try {
        bytes = await bytesOf(await input.open());
      } catch {
        return { ok: false, retryable: true, code: 'unavailable', message: 'input could not be read' };
      }
      if (bytes.byteLength > INLINE_CAPS[kind]) return { ok: false, retryable: false, code: 'too_large', message: INLINE_TOO_LARGE };
      const versions = { backend: 'inline', parsers: INLINE_VERSION };
      try {
        let outcome: CadOutcome;
        if (kind === 'dxf') {
          const analysis = parseDXF(bytes);
          outcome = { ok: true, result: resultFromDxf(analysis, dxfMetrics(analysis), { duration_ms: this.clock() - started, versions }), artefacts: [] };
        } else if (kind === 'stl') {
          const stl = parseSTL(bytes);
          const mesh = analyzeMesh(stl.triangles);
          outcome = { ok: true, result: resultFromMesh('stl', mesh, { duration_ms: this.clock() - started, versions }), artefacts: [] };
        } else {
          const mesh = await parseSTEP(bytes);
          outcome = { ok: true, result: resultFromMesh('step', mesh, { duration_ms: this.clock() - started, versions }), artefacts: [] };
        }
        if (signal.aborted) return { ok: false, retryable: true, code: 'timeout', message: 'inline job passed its deadline' };
        return outcome;
      } catch {
        return { ok: false, retryable: false, code: 'invalid_input', message: `${kind} could not be parsed` };
      }
    });
  }
}
