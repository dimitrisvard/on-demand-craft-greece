// Access to the CadRouter Durable Object (one object, name 'global') and to the RfqThread of an RFQ, for the
// cad-jobs consumer. Both are RPC stubs of the Durable Object namespaces in OpsEnv.

import { need } from '../agents/config';
import type { AcquireResult, CadRouterSnapshot } from '../do/cad-router';
import type { OpsEnv } from '../env';
import type { BackendName, CadFinalStatus } from './types';

export const CAD_ROUTER_NAME = 'global';

export interface CadRouterClient {
  acquire(r: { job_id: string; backend_candidates: BackendName[]; deadline_s: number }): Promise<AcquireResult>;
  release(lease_id: string, outcome: { ok: boolean; retryable?: boolean; backend_down?: boolean }): Promise<void>;
  report(backend: BackendName, ok: boolean): Promise<void>;
  snapshot(): Promise<CadRouterSnapshot>;
}

export function cadRouter(env: OpsEnv): CadRouterClient {
  need(env, 'CAD_ROUTER');
  const ns = env.CAD_ROUTER;
  return ns.get(ns.idFromName(CAD_ROUTER_NAME)) as unknown as CadRouterClient;
}

/** RfqThread(<rfq_id>).cadJobFinal(job_id, status). */
export async function notifyCadJobFinal(env: OpsEnv, rfqId: string, jobId: string, status: CadFinalStatus): Promise<void> {
  need(env, 'RFQ_THREAD');
  const ns = env.RFQ_THREAD;
  const thread = ns.get(ns.idFromName(rfqId)) as unknown as { cadJobFinal(jobId: string, status: CadFinalStatus): Promise<void> };
  await thread.cadJobFinal(jobId, status);
}
