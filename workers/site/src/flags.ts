// Feature flags from KV FLAGS (ARCHITECTURE.md §17; PLAN.md P1-4, P4-2).
// Value per key: JSON {"enabled": true|false, ...}. A missing key, a malformed value or any KV error returns
// the caller's fallback, so a flag can never fail a request. Set by hand until Phase 4, for example:
//   npx wrangler kv key put --binding FLAGS seo.strict_404 '{"enabled":false}' --remote

import type { Env } from './env';
import { LOG_PREFIX } from './env';

// KV edge cache for flag reads: a switch propagates within about a minute (SEO_PARITY.md §7).
const FLAG_CACHE_TTL_S = 60;

/** Parsed value of a flag that carries options besides `enabled` (e.g. api.forward_to_vercel, src/api/forward.ts). */
export interface FlagValue {
  enabled: boolean;
  value?: { paths?: string[]; hosts?: Array<'preview' | 'production'> };
}

const FLAG_HOSTS: ReadonlySet<string> = new Set(['preview', 'production']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// A value is well-formed when "enabled" is a boolean and, if present, "value" is an object whose "paths" is an
// array of strings and whose "hosts" is an array of "preview" / "production". Other keys are ignored.
function parseFlagValue(raw: unknown): FlagValue | null {
  if (!isPlainObject(raw) || typeof raw.enabled !== 'boolean') return null;
  const out: FlagValue = { enabled: raw.enabled };
  if (raw.value === undefined) return out;
  if (!isPlainObject(raw.value)) return null;
  const { paths, hosts } = raw.value;
  const value: NonNullable<FlagValue['value']> = {};
  if (paths !== undefined) {
    if (!isStringArray(paths)) return null;
    value.paths = [...paths];
  }
  if (hosts !== undefined) {
    if (!isStringArray(hosts) || !hosts.every((host) => FLAG_HOSTS.has(host))) return null;
    value.hosts = [...hosts] as Array<'preview' | 'production'>;
  }
  out.value = value;
  return out;
}

/** The parsed flag; null when the key is missing, the value is malformed or KV fails (the last two are logged). */
export async function getFlagValue(env: Env, key: string): Promise<FlagValue | null> {
  let raw: unknown;
  try {
    raw = await env.FLAGS.get(key, { type: 'json', cacheTtl: FLAG_CACHE_TTL_S });
  } catch (err) {
    console.error(`${LOG_PREFIX} flag ${key}: KV read failed, using the fallback`, err);
    return null;
  }
  if (raw === null) return null;
  const parsed = parseFlagValue(raw);
  if (!parsed) console.error(`${LOG_PREFIX} flag ${key}: malformed value, using the fallback`);
  return parsed;
}

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
