// CAD backend registry: HttpUnfoldBackend('vps') for STEP sheet metal, InlineBackend for DXF, STL and CNC STEP,
// the container backend (Phase 5) and, with AGENT_STUBS containing 'cad', the fake backend of the T2 profile.
//
// Rules
//   - 'vps' is registered only when CAD_UNFOLD_URL and CAD_SHARED_SECRET are configured (checked per use, so a
//     missing CAD secret fails CAD jobs only, never the Worker); missingCadConfig() names what is missing.
//   - The shared secret travels over HTTPS only: 'vps' is registered only for an https: CAD_UNFOLD_URL. Generated
//     test configs (AGENT_STUBS set, never in production, ports/index.ts) may point it at the local http: stub.
//     invalidCadConfig() names a configured value that may not be used, and CAD jobs that need it fail
//     'config_invalid'.
//   - 'container' (Phase 5) is configured only with the CAD_CONTAINER binding (or, in generated T2 configs, the
//     CAD_CONTAINER_BASE_URL override) and CAD_SHARED_SECRET; it reaches the container through P5Ports.container
//     (makeP5Ports(env).container unless a port is passed) with maxConcurrency = the slot count. Without that
//     configuration the unconfigured container backend is registered, which supports nothing;
//     missingContainerConfig() names what is missing.
//   - candidates(job, kind): an explicit backend in the message is honoured when it is registered and supports the
//     job; 'auto' = CAD_BACKEND_DEFAULT (default 'vps'), then 'inline', each kept only when registered and
//     supporting (job_type, kind, process). Health and free slots are CadRouter's decision.

import { stubTokens } from '../agents/gateway';
import { slotCount } from '../cad-container/slots';
import type { OpsEnv } from '../env';
import { makeP5Ports, type ContainerPort } from '../ports/p5';
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

/** True when the shared secret may be sent to this base URL: https:, or http: in a generated test config. */
export function unfoldUrlAllowed(url: string, env: Pick<OpsEnv, 'AGENT_STUBS'>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && Boolean(env.AGENT_STUBS?.trim());
}

/** Names of what the container backend needs that is not configured (empty when it can be built). */
export function missingContainerConfig(env: Pick<OpsEnv, 'CAD_CONTAINER' | 'CAD_CONTAINER_BASE_URL' | 'CAD_SHARED_SECRET'>): string[] {
  const missing: string[] = [];
  if (!env.CAD_CONTAINER && !env.CAD_CONTAINER_BASE_URL) missing.push('CAD_CONTAINER');
  if (!env.CAD_SHARED_SECRET) missing.push('CAD_SHARED_SECRET');
  return missing;
}

/** Names of configured CAD values that may not be used (empty when every configured value is usable). */
export function invalidCadConfig(env: Pick<OpsEnv, 'CAD_UNFOLD_URL' | 'AGENT_STUBS'>): string[] {
  return env.CAD_UNFOLD_URL && !unfoldUrlAllowed(env.CAD_UNFOLD_URL, env) ? ['CAD_UNFOLD_URL'] : [];
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

export function makeCadRegistry(env: OpsEnv, o?: { fetcher?: UnfoldFetcher; container?: ContainerPort }): CadBackendRegistry {
  if (stubTokens(env).has('cad')) return new MapCadRegistry([new FakeCadBackend('vps'), new InlineBackend()], 'vps');
  const container =
    missingContainerConfig(env).length === 0
      ? new ContainerBackend({ port: o?.container ?? makeP5Ports(env).container, apiKey: env.CAD_SHARED_SECRET as string, maxConcurrency: slotCount(env) })
      : new ContainerBackend();
  const backends: CadBackend[] = [new InlineBackend(), container];
  if (missingCadConfig(env).length === 0 && invalidCadConfig(env).length === 0) {
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
