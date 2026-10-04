// Hono adapter over the shared shim core (workers/shared/src/compat/vercel-node.ts): runs an unchanged Vercel
// (req, res) handler for an ops route, with the function URL from the registered OpsCall.

import type { Context } from 'hono';
import type { VercelHandler } from '../../../shared/src/compat/vercel-node';
import type { OpsHono } from '../env';

/** Route handler that loads its module lazily on first use; timeout default 300,000 ms. */
export function vercelRoute(
  load: () => Promise<{ default: VercelHandler }>,
  o?: { timeoutMs?: number },
): (c: Context<OpsHono>) => Promise<Response> {
  throw new Error('not implemented: C');
}

export function runVercel(
  c: Context<OpsHono>,
  handler: VercelHandler,
  o?: { functionUrl?: string; body?: Uint8Array | null; timeoutMs?: number },
): Promise<Response> {
  throw new Error('not implemented: C');
}
