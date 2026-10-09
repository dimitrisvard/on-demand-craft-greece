// Container backend (Phase 5, P5-6): the unfold service in the Cloudflare Container CadContainer, behind the same
// HttpUnfoldBackend as the VPS; only the fetcher changes. A job runs on the container of its lease's slot
// (P5Ports.container.fetch(slot, request)); the service is addressed as http://cad (the container's own port 8000,
// see src/cad-container/cad-container.ts).
//
// Rules
//   - Built unconfigured (no options) the backend supports nothing and every run answers 'unsupported', so
//     CAD_BACKEND_DEFAULT = 'container' never routes a job here while the container is not configured
//     (src/cad/registry.ts builds the configured one only with CAD_CONTAINER, or the T2 CAD_CONTAINER_BASE_URL, and
//     CAD_SHARED_SECRET).
//   - health() never sends a request: a probe would wake a sleeping instance and bill its idle tail, so the
//     container's health comes from job outcomes only (CadRouter.release / report).
//   - A run without a slot in its lease fails 'backend_error' (retryable) without a request; it never marks the
//     container down.
//   - maxConcurrency = the slot count (CAD_SLOTS).

import type { CadJobMessageV1 } from '../../queues/messages';
import type { ContainerPort } from '../../ports/p5';
import type { CadBackend, CadInput, CadKind, CadLease, CadOutcome } from '../types';
import { HttpUnfoldBackend } from './http-unfold';

/** Base URL of the service inside the container (any host reaches the container's default port). */
export const CONTAINER_BASE_URL = 'http://cad';

/** Phase 4 container concurrency, kept for the unconfigured backend. */
const DEFAULT_MAX_CONCURRENCY = 3;

export interface ContainerBackendOptions {
  /** P5Ports.container (production: getContainer(env.CAD_CONTAINER, slot)). */
  port: ContainerPort;
  /** CAD_SHARED_SECRET, sent as X-API-Key. */
  apiKey: string;
  /** The slot count (CAD_SLOTS). */
  maxConcurrency: number;
  /** Multipart boundary (tests); random by default. */
  boundary?: string;
  clock?: () => number;
}

export class ContainerBackend implements CadBackend {
  readonly name = 'container' as const;
  readonly mode = 'sync' as const;
  readonly maxConcurrency: number;
  private readonly http: HttpUnfoldBackend | null;

  constructor(o?: ContainerBackendOptions) {
    this.maxConcurrency = o?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.http = o
      ? new HttpUnfoldBackend(
          'container',
          (req, lease) => {
            if (!lease.slot) throw new Error('container lease without a slot');
            return o.port.fetch(lease.slot, req);
          },
          { baseUrl: CONTAINER_BASE_URL, apiKey: o.apiKey, maxConcurrency: o.maxConcurrency, boundary: o.boundary, clock: o.clock },
        )
      : null;
  }

  /** True when the backend was built with a container port and the shared key. */
  get configured(): boolean {
    return this.http !== null;
  }

  supports(jobType: CadJobMessageV1['job_type'], kind: CadKind, process: string): boolean {
    return this.http?.supports(jobType, kind, process) ?? false;
  }

  /** Never probes the container (see the rules above). */
  async health(): Promise<boolean> {
    return this.http !== null;
  }

  async run(job: CadJobMessageV1, input: CadInput, signal: AbortSignal, lease?: CadLease): Promise<CadOutcome> {
    if (!this.http) return { ok: false, retryable: false, code: 'unsupported', message: 'container backend is not configured' };
    if (!lease?.slot) return { ok: false, retryable: true, code: 'backend_error', message: 'container lease without a slot' };
    return this.http.run(job, input, signal, lease);
  }
}
