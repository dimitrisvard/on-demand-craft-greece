// Rate-limit keys over the Workers Rate Limiting bindings. Three bindings: default, mail (tighter) and bulk (for
// idempotent reads and upload presigns); a key's binding is derived from its shape.

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type RateKind = 'form' | 'rcpt' | 'upl' | 'u' | 'm' | 'trk' | 'oauth';

/** e.g. 'u:<uid>:nest', 'u:<uid>:s3:r' (idempotent read), 'u:<uid>:s3:up'. */
export function rateKey(kind: RateKind, ...parts: string[]): string {
  throw new Error('not implemented: G');
}

export type RateBinding = 'default' | 'mail' | 'bulk';

/** 'form:'/'rcpt:' -> mail; 'upl:' and keys ending ':r' or ':up' -> bulk; else default. */
export function bindingFor(key: string): RateBinding {
  throw new Error('not implemented: G');
}

export function allow(limiter: RateLimiter, key: string): Promise<boolean> {
  throw new Error('not implemented: G');
}
