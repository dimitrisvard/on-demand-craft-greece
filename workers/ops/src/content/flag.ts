// The flag agent.content_daily as the content pipeline reads it, and the shared helpers of its runs.
//
// Flag value (set by the owner, PHASE5 flag-values template): {mode, model, steps, backfill_per_language_per_day,
// shadow_generate}. Missing or malformed fields take the defaults below.
//
// Rules
//   - steps: the known names of value.steps; a missing or non-array value means every step (the schedule runs
//     content-daily for any steps value other than exactly ["sitemap"]).
//   - mode shadow: run and record, write nothing to business tables, send no Telegram text and no queue message;
//     only R2 phase5-shadow/... is written.
//   - A run whose flag is switched off (or switched to shadow while it runs in assist/auto) stops before its next
//     side-effecting step and closes 'skipped' with reason 'flag_off'.
//   - errorCode() names a fixed code or the error's class, never the message of a provider or database answer.

import { isConfigMissing } from '../agents/config';
import { DEFAULT_TENANT_ID, type AgentFlag } from '../agents/flags';
import { DbError } from '../db/postgrest';
import type { OpsEnv } from '../env';
import { backfillCap } from './backfill';
import { DEFAULT_GENERATE_MODEL } from './generate-en';

export const CONTENT_FLAG = 'agent.content_daily' as const;

export type ContentStep = 'generate' | 'translate' | 'fix_links' | 'sitemap';
export const ALL_CONTENT_STEPS: readonly ContentStep[] = Object.freeze(['generate', 'translate', 'fix_links', 'sitemap'] as const);

export interface ContentFlagSnap {
  enabled: boolean;
  mode: AgentFlag['mode'];
  steps: ContentStep[];
  model: string;
  backfill_per_language_per_day: number;
  shadow_generate: boolean;
}

/** Pure: the fields of the flag this pipeline uses (structured-cloneable, for step results). */
export function snapshotFlag(f: AgentFlag): ContentFlagSnap {
  const raw = f.value.steps;
  const steps = Array.isArray(raw)
    ? ALL_CONTENT_STEPS.filter((s) => raw.includes(s))
    : [...ALL_CONTENT_STEPS];
  const model = typeof f.value.model === 'string' && f.value.model.trim() ? f.value.model.trim() : DEFAULT_GENERATE_MODEL;
  return {
    enabled: f.enabled,
    mode: f.mode,
    steps,
    model,
    backfill_per_language_per_day: backfillCap(f.value),
    shadow_generate: f.value.shadow_generate === true,
  };
}

/** True when a run started in `runMode` must stop: the flag is off, or it moved to shadow during an assist run. */
export function mustHalt(runMode: AgentFlag['mode'], live: ContentFlagSnap): boolean {
  return !live.enabled || (runMode !== 'shadow' && live.mode === 'shadow');
}

export function tenantOf(env: OpsEnv): string {
  return env.AGENT_TENANT_ID || DEFAULT_TENANT_ID;
}

/** Fixed error code of a failure (never provider or database text). */
export function errorCode(e: unknown): string {
  if (isConfigMissing(e)) return `config_missing: ${e.names.join(', ')}`.slice(0, 200);
  if (e instanceof DbError) return `db_error ${e.status}${e.code ? ` ${e.code}` : ''}`;
  const name = e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) ? e.name : 'Error';
  const message = e instanceof Error ? e.message : String(e);
  const known = /\b(llm_[a-z_]+|title_missing|title_processed|invalid_params|upload_failed(?: [0-9]{3})?|sitemap_regression|master_missing)\b/.exec(message);
  if (known) return known[1];
  return name === 'Error' ? 'error' : name;
}

/** A UTC day YYYY-MM-DD that exists. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
