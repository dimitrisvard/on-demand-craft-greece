// API gate: one decision per resolved /api request (action IDs below). Each decision checks only the env names
// it needs (missingNames; a missing name answers 500 for that request only). Sentinels never reach the gate.

import type { Principal } from '../../../shared/src/http/rpc';
import type { ResolvedApi } from '../api/resolve';
import type { Env } from '../env';
import type { FileConstraints } from './constraints';

export type ActionId = 'EM-1' | 'EM-2' | 'EM-3' | 'EM-4' | 'S3-1' | 'S3-2' | 'S3-3' | 'S3-4' | 'S3-5' | 'S3-6'
  | 'MK-1' | 'MK-2' | 'MK-3' | 'MK-4' | 'MK-5' | 'MK-6' | 'MK-7' | 'NT-1' | 'NT-2' | 'NT-3' | 'NT-4' | 'NT-5' | 'NT-6' | 'NT-7'
  | 'GS-1' | 'TD-1' | 'TD-2' | 'TS-1' | 'FS-1' | 'FS-2' | 'FS-3' | 'SC-1' | 'SC-2' | 'SC-3';

export type GateOutcome =
  | {
    kind: 'allow';
    actionId: ActionId;
    principal: Principal;
    /** Overrides the function URL the handler sees. */
    functionUrl?: string;
    /** Overrides the body bytes the handler sees. */
    body?: Uint8Array;
    constraints?: FileConstraints;
    openerOrigin?: string;
  }
  /** The gate answers on the handler's behalf. */
  | { kind: 'respond'; actionId: ActionId; response: Response }
  | { kind: 'deny'; actionId: ActionId; response: Response };

/** null only for sentinels. */
export function actionIdOf(r: ResolvedApi): ActionId | null {
  throw new Error('not implemented: G');
}

export function applyGate(r: ResolvedApi, request: Request, env: Env, ctx: ExecutionContext): Promise<GateOutcome> {
  throw new Error('not implemented: G');
}
