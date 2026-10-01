// Feature flags from KV FLAGS (ARCHITECTURE.md §17; PLAN.md P1-4, P4-2).
// Value per key: JSON {"enabled": true|false, ...}. A missing key, a malformed value or any KV error returns
// the caller's fallback, so a flag can never fail a request. Set by hand until Phase 4, for example:
//   npx wrangler kv key put --binding FLAGS seo.strict_404 '{"enabled":false}' --remote

import type { Env } from './env';
import { LOG_PREFIX } from './env';

// KV edge cache for flag reads: a switch propagates within about a minute (SEO_PARITY.md §7).
const FLAG_CACHE_TTL_S = 60;

export async function getFlag(env: Env, key: string, fallback: boolean): Promise<boolean> {
  try {
    const value = await env.FLAGS.get<{ enabled?: unknown }>(key, { type: 'json', cacheTtl: FLAG_CACHE_TTL_S });
    if (value === null) return fallback;
    if (typeof value === 'object' && typeof value.enabled === 'boolean') return value.enabled;
    console.error(`${LOG_PREFIX} flag ${key}: value has no boolean "enabled", using the fallback`);
    return fallback;
  } catch (err) {
    console.error(`${LOG_PREFIX} flag ${key}: KV read failed, using the fallback`, err);
    return fallback;
  }
}
