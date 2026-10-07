// Approval requests and human waits of Workflow runs.
//
// Rules
//   - request(): a new single-use token (only its SHA-256 hex is stored). The card goes to Telegram first (callback
//     buttons only when AGENT_APPROVAL_SECRET is configured, since the relay's decisions are verified with it; else
//     the "Open" button only), then one PATCH sets status 'waiting_human', approval_token_sha256 and
//     output.{card_kind, allowed_verbs, card, telegram_message_id} beside the caller's own output fields. A Telegram
//     failure is logged and the run still waits with telegram_message_id null: the dashboard shows every waiting
//     card. The raw token goes only into the Telegram buttons and the return value, never into a log line, a step
//     result or agent_runs.
//   - waitWithReminder(): waitForEvent(type, first) in try/catch; on timeout a step 'remind-<type>' issues a new
//     token (the old hash is replaced, so a stale card answers 409; the old Telegram card loses its buttons) with a
//     reminder card, then a second wait; on the second timeout onTimeout() runs and { timedOut: true } is returned.
//     Step names: 'wait-<type>', 'remind-<type>', 'wait-<type>-reminded'. An error other than the wait timeout is
//     rethrown (the Workflow's fail-run step handles it).
//   - The reminder replaces only the card fields of output: every other output field the request step stored
//     (line_count, quote_workflow_id, order_id, candidates, ...) is kept, so decide() applies the same limits to the
//     reminder card as to the first one.
//   - The reminder is issued only while the run still waits on the token it had when the step started: the PATCH is
//     conditional on status 'waiting_human' and that token hash. A run decided in the meantime keeps its decision
//     (its event is already buffered for the second wait): no new token is stored and the reminder card that was
//     sent loses its buttons, so an approval stays single use.

import type { WorkflowStep, WorkflowTimeoutDuration } from 'cloudflare:workers';
import { formatLogLine } from '../../../shared/src/http/log';
import { getRun, patchRun, patchRunWhileWaiting, type AgentRunPatch, type AgentRunRow } from '../db/repos/agent-runs';
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

/** Output fields request() writes for the card; every other output field belongs to the caller. */
export const CARD_OUTPUT_KEYS: readonly string[] = Object.freeze(['card_kind', 'allowed_verbs', 'card', 'telegram_message_id']);

/** The caller's own output fields of a run (everything except the card fields). */
export function callerOutput(output: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  if (!output || typeof output !== 'object') return kept;
  for (const [key, value] of Object.entries(output)) if (!CARD_OUTPUT_KEYS.includes(key)) kept[key] = value;
  return kept;
}

interface Issued {
  token: string;
  telegram_message_id: number | null;
  /** False when the PATCH was conditional and the run no longer waited on the expected token. */
  stored: boolean;
  card: CardV1;
}

/** Sends the card and writes the token hash and card fields; with whileTokenSha256 only while the run still waits on
 *  that token (else nothing is stored). */
async function issue(env: OpsEnv, ports: Ports, r: { run_id: string; card: CardV1 }, extra: RequestExtra, whileTokenSha256?: string): Promise<Issued> {
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
  const patch: AgentRunPatch = {
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
  };
  if (whileTokenSha256 === undefined) {
    await patchRun(ports.db, r.run_id, patch);
    return { token, telegram_message_id, stored: true, card };
  }
  const stored = await patchRunWhileWaiting(ports.db, r.run_id, whileTokenSha256, patch);
  return { token, telegram_message_id, stored, card };
}

export async function request(
  env: OpsEnv,
  ports: Ports,
  r: { run_id: string; card: CardV1 },
  extra: RequestExtra = {},
): Promise<{ token: string; telegram_message_id: number | null }> {
  const { token, telegram_message_id } = await issue(env, ports, r, extra);
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

/** Removes the buttons of a Telegram card (best effort; the stored hash decides what is accepted anyway). */
async function retireCard(ports: Ports, runId: string, messageId: unknown, card: unknown, label: string): Promise<void> {
  if (typeof messageId !== 'number' || !card || typeof card !== 'object') return;
  try {
    await ports.telegram.editCard(messageId, decidedCard(card as CardV1, { label, actor: 'system', at: ports.clock.now() }));
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'card edit failed', { run_id: runId }));
  }
}

/** Step 'remind-<type>': a reminder card and a new token, only while the run still waits on its current token. */
async function remind(deps: { env: OpsEnv; ports: Ports }, o: WaitOptions): Promise<{ reminded: boolean; telegram_message_id: number | null }> {
  const { env, ports } = deps;
  const run: AgentRunRow | null = await getRun(ports.db, o.run_id);
  const currentHash = run?.approval_token_sha256 ?? null;
  if (!run || run.status !== 'waiting_human' || !currentHash) {
    console.log(formatLogLine(LOG_PREFIX, 'reminder skipped', { run_id: o.run_id, type: o.type }));
    return { reminded: false, telegram_message_id: null };
  }
  const output = run.output ?? null;
  const issued = await issue(env, ports, { run_id: o.run_id, card: o.card() }, { output: callerOutput(output) }, currentHash);
  if (!issued.stored) {
    // Decided between the read above and the PATCH: the reminder card that was just sent loses its buttons.
    await retireCard(ports, o.run_id, issued.telegram_message_id, issued.card, 'Already decided');
    console.log(formatLogLine(LOG_PREFIX, 'reminder skipped', { run_id: o.run_id, type: o.type }));
    return { reminded: false, telegram_message_id: null };
  }
  await retireCard(ports, o.run_id, output?.telegram_message_id, output?.card, 'Replaced by a reminder');
  return { reminded: true, telegram_message_id: issued.telegram_message_id };
}

/** env and ports issue the reminder (remind()) inside step 'remind-<type>'. */
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
  await step.do(`remind-${o.type}`, NOTIFY, async () => remind(deps, o));
  try {
    const event = await step.waitForEvent<Rpc.Serializable<T>>(`wait-${o.type}-reminded`, { type: o.type, timeout: o.second });
    return { event: event.payload as T };
  } catch (error) {
    if (!isWaitTimeout(error)) throw error;
  }
  await o.onTimeout();
  return { timedOut: true };
}
