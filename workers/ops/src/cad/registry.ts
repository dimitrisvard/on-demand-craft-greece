// CAD backend registry: HttpUnfoldBackend('vps') for STEP sheet metal, InlineBackend for DXF, STL and CNC STEP,
// the container slot (Phase 5) and, with AGENT_STUBS containing 'cad', the fake backend of the T2 profile.
//
// Rules
//   - 'vps' is registered only when CAD_UNFOLD_URL and CAD_SHARED_SECRET are configured (checked per use, so a
//     missing CAD secret fails CAD jobs only, never the Worker); missingCadConfig() names what is missing.
//   - candidates(job, kind): an explicit backend in the message is honoured when it is registered and supports the
//     job; 'auto' = CAD_BACKEND_DEFAULT (default 'vps'), then 'inline', each kept only when registered and
//     supporting (job_type, kind, process). Health and free slots are CadRouter's decision.

import { stubTokens } from '../agents/gateway';
import type { OpsEnv } from '../env';
import type { CadJobMessageV1 } from '../queues/messages';
import { ContainerBackend } from './backends/container';
import { FakeCadBackend } from './backends/fake';
import { HttpUnfoldBackend } from './backends/http-unfold';
import { InlineBackend } from './backends/inline';
import type { BackendName, CadBackend, CadBackendRegistry, CadKind, UnfoldFetcher } from './types';

/** Concurrency of the single-worker unfold service on the VPS. */
export const VPS_MAX_CONCURRENCY = 1;

/** Names of the secrets the VPS backend needs that are not configured (empty when it can be built). */
export function missingCadConfig(env: Pick<OpsEnv, 'CAD_UNFOLD_URL' | 'CAD_SHARED_SECRET'>): string[] {
  const missing: string[] = [];
  if (!env.CAD_UNFOLD_URL) missing.push('CAD_UNFOLD_URL');
  if (!env.CAD_SHARED_SECRET) missing.push('CAD_SHARED_SECRET');
  return missing;
}

export class MapCadRegistry implements CadBackendRegistry {
  private readonly backends = new Map<BackendName, CadBackend>();

  constructor(
    backends: CadBackend[],
    private readonly defaultBackend: BackendName = 'vps',
  ) {
    for (const b of backends) this.backends.set(b.name, b);
  }

  get(name: BackendName): CadBackend | undefined {
    return this.backends.get(name);
  }

  candidates(job: CadJobMessageV1, kind: CadKind): BackendName[] {
    const process = job.params?.process ?? 'other';
    const usable = (name: BackendName): boolean => this.backends.get(name)?.supports(job.job_type, kind, process) ?? false;
    if (job.backend !== 'auto') return usable(job.backend) ? [job.backend] : [];
    const order: BackendName[] = [this.defaultBackend, 'inline'];
    return order.filter((name, i) => order.indexOf(name) === i && usable(name));
  }
}

export function makeCadRegistry(env: OpsEnv, o?: { fetcher?: UnfoldFetcher }): CadBackendRegistry {
  if (stubTokens(env).has('cad')) return new MapCadRegistry([new FakeCadBackend('vps'), new InlineBackend()], 'vps');
  const backends: CadBackend[] = [new InlineBackend(), new ContainerBackend()];
  if (missingCadConfig(env).length === 0) {
    const fetcher: UnfoldFetcher = o?.fetcher ?? ((req) => fetch(req));
    backends.push(
      new HttpUnfoldBackend('vps', fetcher, {
        baseUrl: env.CAD_UNFOLD_URL as string,
        apiKey: env.CAD_SHARED_SECRET as string,
        maxConcurrency: VPS_MAX_CONCURRENCY,
        accessClientId: env.CAD_ACCESS_CLIENT_ID,
        accessClientSecret: env.CAD_ACCESS_CLIENT_SECRET,
      }),
    );
  }
  return new MapCadRegistry(backends, env.CAD_BACKEND_DEFAULT ?? 'vps');
}
