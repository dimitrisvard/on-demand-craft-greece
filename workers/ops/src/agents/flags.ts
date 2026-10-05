// Agent flag reads from the KV mirror FLAGS of public.feature_flags (src/cron/flags-sync.ts keeps it in step).
//
// Rules
//   - KV get with cacheTtl 30 s (the KV minimum), so a switched-off flag stops new runs within about two minutes.
//   - Fail closed: a missing binding, a missing or malformed value, or a KV error reads as
//     {enabled: false, mode: 'shadow', value: {}}.
//   - A record is well formed when it is a JSON object whose `enabled` is a boolean and whose `value`, when present,
//     is a JSON object; anything else is malformed.
//   - mode = value.mode, else the KV record's mode, else 'shadow'; a mode outside shadow/assist/auto reads as
//     'shadow'.
//   - Only agent.* keys and 'mcp.remote' are read here; seo.* and api.* belong to microns-site and read as off.
//   - KV key: the flag key for the default tenant, 't:<tenant_id>:<key>' otherwise.
//   - Log lines carry the flag key and the reason only, never the stored value.

import type { FlagKey } from '../../../shared/src/agent-types';
import { formatLogLine } from '../../../shared/src/http/log';
import { LOG_PREFIX, type OpsEnv } from '../env';

export interface AgentFlag {
  enabled: boolean;
  mode: 'shadow' | 'assist' | 'auto';
  value: Record<string, unknown>;
  rev?: number;
}

/** The keys microns-ops reads: every agent.* key and 'mcp.remote'. */
export type AgentFlagKey = Exclude<FlagKey, `seo.${string}` | `api.${string}`>;

export const FLAG_CACHE_TTL_SECONDS = 30;

/** Tenant of the bare KV keys (the only tenant that owns RFQs today). */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** The value every failed read answers. */
export const FLAG_OFF: Readonly<AgentFlag> = Object.freeze({ enabled: false, mode: 'shadow', value: Object.freeze({}) as Record<string, unknown> });

const MODES: ReadonlySet<string> = new Set(['shadow', 'assist', 'auto']);
const READABLE_KEY = /^(agent\.[a-z0-9_]+(\.[a-z0-9_]+)*|mcp\.remote)$/;

/** KV key of a flag for a tenant: the bare key for the default tenant, 't:<tenant_id>:<key>' otherwise. */
export function flagKvKey(key: string, tenantId?: string): string {
  return !tenantId || tenantId === DEFAULT_TENANT_ID ? key : `t:${tenantId}:${key}`;
}

function off(): AgentFlag {
  return { enabled: false, mode: 'shadow', value: {} };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Pure: the AgentFlag of a KV record, or null when the record is malformed. */
export function parseFlagRecord(raw: unknown): AgentFlag | null {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean') return null;
  if (raw.value !== undefined && raw.value !== null && !isRecord(raw.value)) return null;
  const value = isRecord(raw.value) ? raw.value : {};
  const candidate = value.mode ?? raw.mode ?? 'shadow';
  const mode = typeof candidate === 'string' && MODES.has(candidate) ? (candidate as AgentFlag['mode']) : 'shadow';
  const flag: AgentFlag = { enabled: raw.enabled, mode, value };
  if (typeof raw.rev === 'number' && Number.isSafeInteger(raw.rev)) flag.rev = raw.rev;
  return flag;
}

/**
 * The flag as microns-ops sees it (fail closed). tenantId defaults to env.AGENT_TENANT_ID (bare key for the
 * default tenant).
 */
export async function readFlag(env: OpsEnv, key: AgentFlagKey, tenantId?: string): Promise<AgentFlag> {
  if (!READABLE_KEY.test(key)) {
    console.error(formatLogLine(LOG_PREFIX, 'flag read refused', { key: 'invalid' }));
    return off();
  }
  if (!env.FLAGS) return off();
  let raw: unknown;
  try {
    raw = await env.FLAGS.get(flagKvKey(key, tenantId ?? env.AGENT_TENANT_ID), { type: 'json', cacheTtl: FLAG_CACHE_TTL_SECONDS });
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'flag read failed', { key, reason: 'kv_error' }));
    return off();
  }
  if (raw === null || raw === undefined) return off();
  const flag = parseFlagRecord(raw);
  if (!flag) {
    console.error(formatLogLine(LOG_PREFIX, 'flag read failed', { key, reason: 'malformed' }));
    return off();
  }
  return flag;
}

/** Same read with the annex's narrower key type; Phase 5 imports readFlag. */
export async function readAgentFlag(env: OpsEnv, key: `agent.${string}`, tenantId?: string): Promise<AgentFlag> {
  return readFlag(env, key as AgentFlagKey, tenantId);
}
