// /api endpoint catalogue and action resolution. The resolver follows each handler's own precedence exactly, so
// the gate decides on the same action the handler will run. Values starting with '#' are sentinels: the handler
// answers them before any side effect, so they are dispatched without a gate.

import type { BodyView } from '../../../shared/src/compat/vercel-node';
import type { EndpointId } from '../../../shared/src/http/rpc';

export type Sentinel = '#options' | '#method' | '#unknown' | '#unknown-step' | '#throws';

export interface ResolvedApi {
  endpoint: EndpointId;
  /** url.pathname as requested. */
  publicPath: string;
  /** functionUrlFor(url).functionUrl */
  functionUrl: string;
  /** Upper case. */
  method: string;
  /** parseQuery of functionUrl. */
  query: Record<string, string | string[]>;
  /** parseVercelBody(Content-Type, bodyBytes). */
  body: BodyView;
  /** Empty for GET/HEAD. */
  bodyBytes: Uint8Array;
  /** Normalised action, or a sentinel. */
  action: string | Sentinel;
  /** The value the handler switches on. */
  rawAction: unknown;
  /** s3 only. */
  scope?: 'rfq' | 'articles';
  /** marketing google-auth: 'error' | 'authorize' | 'callback' | 'refresh'. */
  step?: string;
}

/** Catalogue lookup by path only (incl. /api/track and /api/connector-status); null: forward with the body unread. */
export function endpointOfPath(pathname: string): EndpointId | null {
  throw new Error('not implemented: B');
}

/** Called only when endpointOfPath() is not null. */
export function resolveApi(request: Request, bodyBytes: Uint8Array): ResolvedApi {
  throw new Error('not implemented: B');
}

export function isSentinel(action: string): action is Sentinel {
  throw new Error('not implemented: B');
}
