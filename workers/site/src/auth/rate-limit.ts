// Site adapter over the shared rate-limit keys: picks the binding for a key (mail and bulk keys fall back to
// API_RATE_LIMIT when their own binding is absent). Needs API_RATE_LIMIT unless the key's own binding is bound.
// A binding that throws lets the request through (logged): the limits are a throttle, the other checks of the
// gate still apply.

import { allow, bindingFor, type RateLimiter } from '../../../shared/src/auth/rate-limit';
import type { Env } from '../env';

export type RateCheck = { kind: 'ok' } | { kind: 'limited' } | { kind: 'config'; missing: string[] };

export function limiterFor(env: Env, key: string): RateLimiter | undefined {
  switch (bindingFor(key)) {
    case 'mail':
      return env.API_RATE_LIMIT_MAIL ?? env.API_RATE_LIMIT;
    case 'bulk':
      return env.API_RATE_LIMIT_BULK ?? env.API_RATE_LIMIT;
    default:
      return env.API_RATE_LIMIT;
  }
}

export async function checkRate(env: Env, key: string): Promise<RateCheck> {
  const limiter = limiterFor(env, key);
  if (!limiter) return { kind: 'config', missing: ['API_RATE_LIMIT'] };
  try {
    return (await allow(limiter, key)) ? { kind: 'ok' } : { kind: 'limited' };
  } catch {
    console.error(`[microns-site] gate rate_limit_error ${bindingFor(key)}`);
    return { kind: 'ok' };
  }
}
