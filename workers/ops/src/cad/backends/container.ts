// Container backend slot (Phase 5, P5-6): the unfold service in a Cloudflare Container behind the same
// HttpUnfoldBackend, with only the fetcher changed. Until then this backend supports nothing and every run answers
// 'unsupported', so CAD_BACKEND_DEFAULT = 'container' never routes a job here by mistake.

import type { CadJobMessageV1 } from '../../queues/messages';
import type { CadBackend, CadInput, CadKind, CadOutcome } from '../types';

export class ContainerBackend implements CadBackend {
  readonly name = 'container' as const;
  readonly mode = 'sync' as const;
  readonly maxConcurrency = 3;

  supports(_jobType: CadJobMessageV1['job_type'], _kind: CadKind, _process: string): boolean {
    return false;
  }

  async health(): Promise<boolean> {
    return false;
  }

  async run(_job: CadJobMessageV1, _input: CadInput, _signal: AbortSignal): Promise<CadOutcome> {
    return { ok: false, retryable: false, code: 'unsupported', message: 'container backend arrives with Phase 5' };
  }
}
