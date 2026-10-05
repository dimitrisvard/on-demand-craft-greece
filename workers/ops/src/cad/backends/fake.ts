// FakeCadBackend: a deterministic CAD backend selected only by the AGENT_STUBS token 'cad' of the generated T2
// configs (makePorts refuses AGENT_STUBS whenever the production bindings AI or QUOTES_INDEX exist). It reads no
// file and answers a fixed synthetic result per kind, so end-to-end tests can run without geometry.

import type { CadJobMessageV1 } from '../../queues/messages';
import type { CadBackend, CadInput, CadKind, CadOutcome, CadResultV1 } from '../types';

export function fakeResult(kind: CadKind): CadResultV1 {
  const base = { v: 1 as const, kind, source: 'inline-ts' as const, units: 'mm' as const, warnings: ['fake_cad_backend'], versions: { backend: 'fake' }, duration_ms: 1 };
  if (kind === 'stl') {
    return { ...base, thickness_mm: null, flat: null, bends: null, bbox_mm: { x: 100, y: 50, z: 20 }, volume_mm3: 60000 };
  }
  return {
    ...base,
    thickness_mm: kind === 'step' ? 2 : null,
    flat: { width_mm: 200, height_mm: 100, area_mm2: 19000, cut_length_mm: 700, pierces: 2 },
    bends: { count: 2, items: [{ angle_deg: 90, radius_mm: null }, { angle_deg: 90, radius_mm: null }] },
    bbox_mm: null,
    volume_mm3: null,
  };
}

export class FakeCadBackend implements CadBackend {
  readonly mode = 'sync' as const;
  readonly maxConcurrency = 1;

  constructor(readonly name: 'vps' | 'inline' = 'vps') {}

  supports(jobType: CadJobMessageV1['job_type'], kind: CadKind): boolean {
    return jobType === 'analyse' && kind !== 'other';
  }

  async health(): Promise<boolean> {
    return true;
  }

  async run(job: CadJobMessageV1, input: CadInput): Promise<CadOutcome> {
    if (!this.supports(job.job_type, input.kind)) return { ok: false, retryable: false, code: 'unsupported', message: 'fake backend: analyse only' };
    return { ok: true, result: fakeResult(input.kind), artefacts: [] };
  }
}
