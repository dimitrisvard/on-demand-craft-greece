// Rate-limit keys over the Workers Rate Limiting bindings. Three bindings: default, mail (tighter) and bulk (for
// idempotent reads and upload presigns); a key's binding is derived from its shape, so one key always counts
// against the same limit.
//
// Key shapes (one binding = one limit, so the key carries the class):
//   form:<ip>                  public form mail, per client address            -> mail
//   rcpt:<sha256(lower(e-mail))> public form mail, per recipient                -> mail
//   upl:<ip>                   anonymous upload presign                         -> bulk
//   u:<uid>:<scope>            signed-in user, writes and mail                  -> default
//   u:<uid>:<scope>:r          signed-in user, idempotent reads                 -> bulk
//   u:<uid>:<scope>:up         signed-in user, upload presigns                  -> bulk
//   m:<name>:<scope>           machine caller                                   -> default
//   trk:<event id>             e-mail link side effects                         -> default
//   oauth:<ip>                 OAuth callback                                   -> default

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type RateKind = 'form' | 'rcpt' | 'upl' | 'u' | 'm' | 'trk' | 'oauth';

/** e.g. 'u:<uid>:nest', 'u:<uid>:s3:r' (idempotent read), 'u:<uid>:s3:up'. */
export function rateKey(kind: RateKind, ...parts: string[]): string {
  return [kind, ...parts].join(':');
}

export type RateBinding = 'default' | 'mail' | 'bulk';

/** 'form:'/'rcpt:' -> mail; 'upl:' and keys ending ':r' or ':up' -> bulk; else default. */
export function bindingFor(key: string): RateBinding {
  if (key.startsWith('form:') || key.startsWith('rcpt:')) return 'mail';
  if (key.startsWith('upl:') || key.endsWith(':r') || key.endsWith(':up')) return 'bulk';
  return 'default';
}

/** true when the request may proceed (the key is within its limit). */
export async function allow(limiter: RateLimiter, key: string): Promise<boolean> {
  const outcome = await limiter.limit({ key });
  return outcome.success === true;
}
