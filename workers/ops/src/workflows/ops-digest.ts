// OpsDigestWorkflow ('ops-digest', instance ops-digest-<YYYY>-W<ww>, binding OPS_DIGEST): the weekly operations
// digest (PHASE5_SPEC §6.6, §5.5, §5.7; AGENTS.md §3.6). Started by the schedule on Monday 06:30 UTC with the ISO
// week of that Monday; the figures describe the ISO week before it (src/digest/collect.ts).
//
//   open-run        agent_runs ops_digest, key ops_digest:<iso_week>, prompt ops_digest.narrative@v1; a final run exits
//   flag            agent.ops_digest off -> 'skipped' (flag_off); assist/auto need value.recipient and DIGEST_FROM,
//                   shadow needs PRIVATE_FILES, else 'failed' with error config_missing and the names
//   collect         the weekly figures (PostgREST reads of plain columns, counted in the Worker)
//   stuck           runs open > 48 h, quotes awaiting approval, final queue failures, failed CAD jobs
//   narrative       Phase 4 llm port, route extract, prompt ops_digest.narrative@v1, input = the figures only,
//                   output {lines}; a refusal, schema or budget answer, or a provider still failing after the step
//                   retries, leaves the summary out ("Summary unavailable") and the digest still goes out
//   send            re-reads the flag; Resend (Phase 4 mailer) from DIGEST_FROM to value.recipient with
//                   Idempotency-Key digest/<iso_week>
//   telegram        re-reads the flag; one plain line through P5Ports.telegramText
//   ads-conversions value.ads_upload: not built in Phase 5 (no click id is captured); recorded, no call
//   purge           first Monday of a month (the Monday of iso_week) and value.purge not false: re-reads the flag,
//                   rpc agent_retention_purge()
//   close-run       {sent, recipient_set, sections, purge, report_week, narrative, telegram, ads_upload, ...}
// Shadow (D-23): every read and the narrative run, the rendered digest goes to R2 phase5-shadow/ops-digest/<iso_week>/
// only; no mail, no Telegram line, no purge.
// Rules
//   - The recipient address is read inside the send step and never leaves it: it is not a step result, not in the
//     run output and not in a log line.
//   - Step results are figures, ids and codes only (well below 1 MiB).
//   - A failure closes the run 'failed' with '<step>: <code>' and sends one plain alert line (not in shadow).

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { isConfigMissing, need } from '../agents/config';
import { DEFAULT_TENANT_ID, readFlag, type AgentFlag } from '../agents/flags';
import { loadPrompt, registerPromptSource, type PromptId } from '../agents/prompts/registry';
import { addUsage, closeRun, EMPTY_USAGE, isFinal, openRun, type UsageAcc } from '../agents/runs';
import { DbError } from '../db/postgrest';
import { collectMetrics, isFirstMondayOfMonth, reportWindow, type DigestMetrics, type DigestWindow } from '../digest/collect';
import { DIGEST_SECTIONS, narrativeInput, narrativeLines, renderDigest, telegramLine, type NarrativeResult } from '../digest/render';
import { collectStuck, type StuckReport } from '../digest/stuck';
import { LOG_PREFIX, type OpsDigestParams, type OpsEnv } from '../env';
import { makePorts, type JsonSchemaObject, type LlmUsage, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import { BLOB, DB, LLM_EXTRACT, NOTIFY, SEND } from './steps';
import narrativePrompt from '../agents/prompts/ops_digest/narrative.v1.md';
import narrativeSchema from '../agents/prompts/ops_digest/narrative.v1.schema.json';

registerPromptSource('ops_digest.narrative@v1', narrativePrompt, narrativeSchema as Record<string, unknown>);

export const DIGEST_AGENT = 'ops_digest' as const;
export const DIGEST_FLAG = 'agent.ops_digest' as const;
export const NARRATIVE_PROMPT: PromptId = 'ops_digest.narrative@v1';
/** Name of the missing flag field in config_missing errors. */
export const RECIPIENT_FIELD = 'agent.ops_digest.value.recipient';
/** Reads of a whole week (about 30 PostgREST requests). */
export const COLLECT_STEP: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' };

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export interface OpsDigestDeps {
  env: OpsEnv;
  ports: Ports;
  p5: P5Ports;
  step: WorkflowStep;
}

export interface OpsDigestResult {
  outcome: 'exists' | 'flag_off' | 'sent' | 'shadow' | 'failed';
  run_id: string;
  failed_step?: string;
}

export const digestAlerts = {
  failed: (week: string, step: string, code: string) => `Ops digest ${week}: run failed at step ${step} (${code}).`,
};

export class OpsDigestWorkflow extends WorkflowEntrypoint<OpsEnv, OpsDigestParams> {
  async run(event: Readonly<WorkflowEvent<OpsDigestParams>>, step: WorkflowStep): Promise<unknown> {
    return runOpsDigest(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), p5: makeP5Ports(this.env), step });
  }
}

/** The fields of the flag the digest uses, without the recipient address. */
interface FlagSnap {
  enabled: boolean;
  mode: AgentFlag['mode'];
  recipient_set: boolean;
  ads_upload: boolean;
  purge: boolean;
}

function recipientOf(flag: AgentFlag): string | null {
  const r = flag.value.recipient;
  return typeof r === 'string' && EMAIL.test(r.trim()) ? r.trim() : null;
}

function snap(flag: AgentFlag): FlagSnap {
  return {
    enabled: flag.enabled,
    mode: flag.mode,
    recipient_set: recipientOf(flag) !== null,
    ads_upload: flag.value.ads_upload === true,
    purge: flag.value.purge !== false,
  };
}

/** A run started in runMode stops when its flag is off, or moved to shadow during an assist/auto run. */
function mustHalt(runMode: AgentFlag['mode'], live: AgentFlag): boolean {
  return !live.enabled || (runMode !== 'shadow' && live.mode === 'shadow');
}

/** Fixed code of a failure (never the text of a provider or database answer, never an address). */
export function digestErrorCode(e: unknown): string {
  if (isConfigMissing(e)) return 'config_missing';
  if (e instanceof DbError) return `db_error ${e.status}${e.code ? ` ${e.code}` : ''}`;
  const message = e instanceof Error ? e.message : String(e);
  const known = /\b(invalid_params|mail_[a-z0-9_]+|llm_[a-z_]+|purge_failed)\b/.exec(message);
  if (known) return known[1];
  return e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) && e.name !== 'Error' ? e.name : 'error';
}

export async function runOpsDigest(p: OpsDigestParams, instanceId: string, d: OpsDigestDeps): Promise<OpsDigestResult> {
  const win: DigestWindow | null = p && typeof p.iso_week === 'string' ? reportWindow(p.iso_week) : null;
  if (!win) throw new NonRetryableError('invalid_params');
  const { env, ports, p5, step } = d;
  const db = ports.db;
  const tenant = env.AGENT_TENANT_ID || DEFAULT_TENANT_ID;
  let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  let current = 'open-run';
  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
    current = name;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };

  const opened = await run('open-run', DB, () =>
    openRun(db, {
      agent: DIGEST_AGENT,
      trigger: p.trigger === 'manual' ? 'manual' : 'cron',
      idempotency_key: `${DIGEST_AGENT}:${win.iso_week}`,
      workflow_name: 'ops-digest',
      workflow_instance_id: instanceId,
      prompt_version: NARRATIVE_PROMPT,
      tenant_id: tenant,
    }),
  );
  const runId = opened.run_id;
  if (!opened.created && isFinal(opened.status)) return { outcome: 'exists', run_id: runId };

  let shadow = false;
  try {
    const flag = await run('flag', DB, async () => snap(await readFlag(env, DIGEST_FLAG, tenant)));
    if (!flag.enabled) {
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { reason: 'flag_off', report_week: win.report_week } }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }
    shadow = flag.mode === 'shadow';
    const missing: string[] = [];
    if (shadow) {
      if (!env.PRIVATE_FILES) missing.push('PRIVATE_FILES');
    } else {
      if (!env.DIGEST_FROM) missing.push('DIGEST_FROM');
      if (!flag.recipient_set) missing.push(RECIPIENT_FIELD);
    }
    if (missing.length > 0) {
      await run('close-config-missing', DB, () =>
        closeRun(db, runId, { status: 'failed', error: 'config_missing', output: { missing, recipient_set: flag.recipient_set, report_week: win.report_week } }, acc),
      );
      console.error(formatLogLine(LOG_PREFIX, 'ops digest config missing', { week: win.iso_week, names: missing.join(',') }));
      return { outcome: 'failed', run_id: runId, failed_step: 'flag' };
    }

    const metrics = await run('collect', COLLECT_STEP, () => collectMetrics(db, win));
    const stuck = await run('stuck', DB, () => collectStuck(db, win, ports.clock.now()));

    // ----- narrative (never blocks the digest) -----
    let narrative: NarrativeResult;
    try {
      const r = await run<{ ok: true; lines: string[]; usage: LlmUsage } | { ok: false; code: string; usage: LlmUsage | null }>('narrative', LLM_EXTRACT, async () => {
        const loaded = await loadPrompt(NARRATIVE_PROMPT);
        const res = await ports.llm.call<{ lines: string[] }>({
          prompt: NARRATIVE_PROMPT,
          route: loaded.entry.route,
          system: loaded.system,
          user: [{ type: 'text', text: `<metrics>\n${JSON.stringify(narrativeInput(metrics, stuck))}\n</metrics>` }],
          schema: loaded.schema as unknown as JsonSchemaObject,
          maxTokens: loaded.entry.max_tokens,
          meta: { agent: DIGEST_AGENT, run_id: runId, tenant_id: tenant, step: 'narrative' },
        });
        if (res.ok) {
          const lines = narrativeLines(res.value);
          return lines ? { ok: true as const, lines, usage: res.usage } : { ok: false as const, code: 'llm_schema', usage: res.usage };
        }
        if (res.retryable && res.code !== 'budget') throw new Error(`llm_unavailable: ${res.code}`);
        return { ok: false as const, code: `llm_${res.code}`, usage: res.usage ?? null };
      });
      if (r.usage) acc = addUsage(acc, r.usage, 'narrative');
      narrative = r.ok ? { ok: true, lines: r.lines } : { ok: false, lines: [], code: r.code };
    } catch {
      narrative = { ok: false, lines: [], code: 'llm_unavailable' };
    }

    const base = {
      report_week: win.report_week,
      sections: [...DIGEST_SECTIONS],
      narrative: narrative.ok ? 'ok' : narrative.code ?? 'unavailable',
      rfqs: metrics.pipeline.rfqs,
      quotes_sent: metrics.quotes.sent,
      win_rate_pct: metrics.quotes.win_rate_pct,
      stuck_runs: stuck.stale_runs.count,
      ads_upload: flag.ads_upload ? 'not_built' : 'off',
    };

    if (shadow) {
      const key = `phase5-shadow/ops-digest/${win.iso_week}/digest.html`;
      await run('shadow-copy', BLOB, async () => {
        const rendered = renderDigest({ metrics, stuck, narrative, siteOrigin: env.SITE_ORIGIN });
        const bytes = new TextEncoder().encode(rendered.html);
        await ports.blob.put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
          contentType: 'text/html; charset=utf-8',
          meta: { report_week: win.report_week, subject: rendered.subject },
        });
        return true;
      });
      await run('close-run', DB, () =>
        closeRun(db, runId, { status: 'succeeded', output: { ...base, shadow: true, sent: false, recipient_set: flag.recipient_set, telegram: false, purge: 'shadow', shadow_key: key } }, acc),
      );
      return { outcome: 'shadow', run_id: runId };
    }

    // ----- send -----
    const sent = await run('send', SEND, async () => {
      const live = await readFlag(env, DIGEST_FLAG, tenant);
      if (mustHalt(flag.mode, live)) return { halted: true as const };
      const to = recipientOf(live);
      need(env, 'DIGEST_FROM');
      if (!to) throw new NonRetryableError('mail_recipient_missing');
      const rendered = renderDigest({ metrics, stuck, narrative, siteOrigin: env.SITE_ORIGIN });
      const res = await ports.mailer.send({
        from: env.DIGEST_FROM,
        to: [to],
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotency_key: `digest/${win.iso_week}`,
      });
      if (res.ok) return { halted: false as const, provider_id: res.provider_id };
      if (res.retryable) throw new Error(`mail_unavailable ${res.status}`);
      throw new NonRetryableError(`mail_rejected_${res.status}`);
    });
    if (sent.halted) {
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { ...base, reason: 'flag_off', halted_at: 'send', sent: false, recipient_set: true } }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }

    const telegram = await run('telegram', NOTIFY, async () => {
      const live = await readFlag(env, DIGEST_FLAG, tenant);
      if (mustHalt(flag.mode, live)) return { sent: false, skipped: 'flag_off' };
      const r = await p5.telegramText.send(telegramLine(metrics));
      return { sent: r.ok, skipped: null };
    });

    let purge: Record<string, unknown> | string = 'not_due';
    if (!flag.purge) purge = 'off';
    else if (isFirstMondayOfMonth(win.iso_week)) {
      purge = await run('purge', DB, async () => {
        const live = await readFlag(env, DIGEST_FLAG, tenant);
        if (mustHalt(flag.mode, live)) return 'flag_off';
        const result = await db.rpc<unknown>('agent_retention_purge', {});
        const row = Array.isArray(result) ? result[0] : result;
        if (typeof row !== 'object' || row === null) throw new Error('purge_failed');
        return row as Record<string, unknown>;
      });
    }

    await run('close-run', DB, () =>
      closeRun(db, runId, { status: 'succeeded', output: { ...base, sent: true, recipient_set: true, telegram: telegram.sent, purge } }, acc),
    );
    console.log(formatLogLine(LOG_PREFIX, 'ops digest sent', { week: win.iso_week, report_week: win.report_week }));
    return { outcome: 'sent', run_id: runId };
  } catch (e) {
    const failedStep = current;
    const code = digestErrorCode(e);
    console.error(formatLogLine(LOG_PREFIX, 'ops digest failed', { week: win.iso_week, step: failedStep, code }));
    await run('close-failed', DB, () =>
      closeRun(db, runId, { status: 'failed', error: `${failedStep}: ${code}`, output: { report_week: win.report_week, ...(shadow ? { shadow: true } : {}) } }, acc),
    );
    if (!shadow) {
      await run('alert-failed', NOTIFY, async () => {
        await p5.telegramText.send(digestAlerts.failed(win.report_week, failedStep, code));
        return true;
      });
    }
    return { outcome: 'failed', run_id: runId, failed_step: failedStep };
  }
}

/** Types re-exported for tests. */
export type { DigestMetrics, StuckReport };
