// Approval requests and human waits of Workflow runs.
//
// Rules
//   - request(): a new single-use token (only its SHA-256 hex is stored). The card goes to Telegram first (callback
//     buttons only when AGENT_APPROVAL_SECRET is configured, since the relay's decisions are verified with it; else
//     the "Open" button only), then one PATCH sets status 'waiting_human', approval_token_sha256 and
//     output.{card_kind, allowed_verbs, card, telegram_message_id}. A Telegram failure is logged and the run still
//     waits with telegram_message_id null: the dashboard shows every waiting card. The raw token goes only into the
//     Telegram buttons and the return value, never into a log line, a step result or agent_runs.
//   - waitWithReminder(): waitForEvent(type, first) in try/catch; on timeout a step 'remind-<type>' issues a new
//     token (the old hash is replaced, so a stale card answers 409; the old Telegram card loses its buttons) with a
//     reminder card, then a second wait; on the second timeout onTimeout() runs and { timedOut: true } is returned.
//     Step names: 'wait-<type>', 'remind-<type>', 'wait-<type>-reminded'. An error other than the wait timeout is
//     rethrown (the Workflow's fail-run step handles it).

import type { WorkflowStep, WorkflowTimeoutDuration } from 'cloudflare:workers';
import { formatLogLine } from '../../../shared/src/http/log';
import { getRun, patchRun, type AgentRunPatch } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { Ports } from '../ports/index';
import { NOTIFY } from '../workflows/steps';
import { clampCard, decidedCard, type CardV1 } from './cards/index';
import { newApprovalToken } from './ids';

export interface RequestExtra {
  /** Further columns of the same PATCH (e.g. parked_reason, error, usage columns). */
  patch?: AgentRunPatch;
  /** Further output fields stored beside the card fields (e.g. candidates of a reply_pick card). */
  output?: Record<string, unknown>;
}

export async function request(
  env: OpsEnv,
  ports: Ports,
  r: { run_id: string; card: CardV1 },
  extra: RequestExtra = {},
): Promise<{ token: string; telegram_message_id: number | null }> {
  const card = clampCard({ ...r.card, run_id: r.run_id });
  const { token, sha256 } = newApprovalToken();
  const tokenHash = await sha256;
  let telegram_message_id: number | null = null;
  try {
    const sent = await ports.telegram.sendCard(card, env.AGENT_APPROVAL_SECRET ? token : null);
    telegram_message_id = sent.message_id;
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'card send failed', { run_id: r.run_id, kind: card.kind }));
  }
  await patchRun(ports.db, r.run_id, {
    ...extra.patch,
    status: 'waiting_human',
    finished_at: null,
    approval_token_sha256: tokenHash,
    output: {
      ...extra.output,
      card_kind: card.kind,
      allowed_verbs: card.allowed_verbs,
      card,
      telegram_message_id,
    },
  });
  return { token, telegram_message_id };
}

export interface WaitOptions {
  run_id: string;
  /** Workflow event type, e.g. 'quote-approved'. */
  type: string;
  first: WorkflowTimeoutDuration;
  second: WorkflowTimeoutDuration;
  /** The reminder card (built when the first wait times out). */
  card: () => CardV1;
  onTimeout: () => Promise<void>;
}

/** True for the error a waitForEvent throws when its timeout passes ('Execution timed out after <ms>ms'). */
export function isWaitTimeout(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /timed out|timeout/i.test(text);
}

/** Removes the buttons of the run's current Telegram card (best effort; the stored hash is replaced anyway). */
async function retireCurrentCard(ports: Ports, runId: string, label: string): Promise<void> {
  try {
    const run = await getRun(ports.db, runId);
    const output = run?.output ?? null;
    const messageId = output?.telegram_message_id;
    const card = output?.card as CardV1 | undefined;
    if (typeof messageId === 'number' && card && typeof card === 'object') {
      await ports.telegram.editCard(messageId, decidedCard(card, { label, actor: 'system', at: ports.clock.now() }));
    }
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'card edit failed', { run_id: runId }));
  }
}

/** env and ports issue the reminder (request()) inside step 'remind-<type>'. */
export async function waitWithReminder<T>(
  step: WorkflowStep,
  o: WaitOptions,
  deps: { env: OpsEnv; ports: Ports },
): Promise<{ event: T } | { timedOut: true }> {
  try {
    const event = await step.waitForEvent<Rpc.Serializable<T>>(`wait-${o.type}`, { type: o.type, timeout: o.first });
    return { event: event.payload as T };
  } catch (error) {
    if (!isWaitTimeout(error)) throw error;
  }
  await step.do(`remind-${o.type}`, NOTIFY, async () => {
    await retireCurrentCard(deps.ports, o.run_id, 'Replaced by a reminder');
    const reminder = o.card();
    const { telegram_message_id } = await request(deps.env, deps.ports, { run_id: o.run_id, card: reminder });
    return { reminded: true, telegram_message_id };
  });
  try {
    const event = await step.waitForEvent<Rpc.Serializable<T>>(`wait-${o.type}-reminded`, { type: o.type, timeout: o.second });
    return { event: event.payload as T };
  } catch (error) {
    if (!isWaitTimeout(error)) throw error;
  }
  await o.onTimeout();
  return { timedOut: true };
}
