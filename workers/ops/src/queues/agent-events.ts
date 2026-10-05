// Consumer of the queue "agent-events": inbound replies, order-created, resume-parked and cards; each message is
// acked or retried on its own.
//
//   inbound-reply   reply attribution (src/replies/inbound.ts); agent.quote off -> acked, nothing changes
//   order-created   agent.post_order on -> POST_ORDER.create(id 'post-order-<order_id>'); "already exists" counts as
//                   success; off -> acked (the 10-minute dispatcher sends portal and quote orders again)
//   resume-parked   a run parked on flag_off, budget or llm_unavailable: event 'agent-resumed' to its Workflow
//                   instance; an instance that has ended closes the run 'cancelled' (instance_ended)
//   card            a notice card of a consumer or cron unit: Telegram sendMessage without buttons
//   decision        a decision on a card of a run without a Workflow instance (decide() sends it): reply_pick cards
//                   are handled by src/replies/inbound.ts; other kinds are acked and logged
// Rules
//   - Messages are handled one at a time; a thrown error retries that message only (queue max_retries 3, then the
//     DLQ agent-events-dlq). An inbound reply that fails on its last attempt is closed: run 'failed' with the error
//     code, row 'failed' (the dispatcher no longer sends it).
//   - A message of an unknown shape is acked and logged (retrying cannot fix it).
//   - Log lines carry the message type, ids and outcome only.

import { UUID_RE } from '../../../shared/src/agent-api';
import { describeError } from '../../../shared/src/compat/vercel-node';
import { formatLogLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { isAlreadyExists, postOrderInstanceId } from '../agents/ids';
import { closeRun, usageFromRow } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { failInboundReply, handleInboundReply, handleReplyPick, type ReplyDeps } from '../replies/inbound';
import type { CardV1 } from '../agents/cards/index';
import type { AgentEventV1, DecisionMessageV1 } from './messages';

/** Attempts of one message (first delivery + max_retries 3 of wrangler.jsonc). */
export const MAX_ATTEMPTS = 4;

const PARK_REASONS = new Set(['flag_off', 'budget', 'llm_unavailable']);
const ENDED = new Set(['complete', 'errored', 'terminated']);

export interface AgentEventsDeps {
  ports?: Ports;
  /** Reply attribution override (tests). */
  match?: ReplyDeps['match'];
}

function log(type: string, fields: Record<string, string | number | boolean>): void {
  console.log(formatLogLine(LOG_PREFIX, 'agent-events', { type, ...fields }));
}

/** The Workflow binding of an instance id (by its prefix). */
export function workflowFor(env: OpsEnv, instanceId: string): Workflow | undefined {
  if (instanceId.startsWith('rfq-intake-')) return env.RFQ_INTAKE as Workflow | undefined;
  if (instanceId.startsWith('quote-')) return env.QUOTE as Workflow | undefined;
  if (instanceId.startsWith('post-order-')) return env.POST_ORDER as Workflow | undefined;
  return undefined;
}

async function orderCreated(env: OpsEnv, m: Extract<AgentEventV1, { type: 'order-created' }>): Promise<string> {
  if (!UUID_RE.test(m.order_id ?? '') || !UUID_RE.test(m.tenant_id ?? '') || !['quote', 'portal', 'dashboard'].includes(m.source)) return 'bad_input';
  const flag = await readFlag(env, 'agent.post_order', m.tenant_id);
  if (!flag.enabled) return 'flag_off';
  if (!env.POST_ORDER) throw new Error('POST_ORDER binding missing');
  const id = postOrderInstanceId(m.order_id);
  try {
    await env.POST_ORDER.create({ id, params: { v: 1, order_id: m.order_id, tenant_id: m.tenant_id, source: m.source } });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return 'exists';
  }
  return 'started';
}

async function resumeParked(env: OpsEnv, ports: Ports, m: Extract<AgentEventV1, { type: 'resume-parked' }>): Promise<string> {
  if (!UUID_RE.test(m.run_id ?? '')) return 'bad_input';
  const run = await getRun(ports.db, m.run_id);
  if (!run || run.status !== 'waiting_human' || !PARK_REASONS.has(run.parked_reason ?? '')) return 'not_parked';
  const instanceId = run.workflow_instance_id;
  const workflow = instanceId ? workflowFor(env, instanceId) : undefined;
  if (!instanceId || !workflow) return 'no_instance';
  let instance: WorkflowInstance;
  try {
    instance = await workflow.get(instanceId);
  } catch {
    await closeRun(ports.db, run.id, { status: 'cancelled', error: 'instance_ended' }, usageFromRow(run));
    return 'instance_ended';
  }
  const status = (await instance.status()).status;
  if (ENDED.has(status)) {
    await closeRun(ports.db, run.id, { status: 'cancelled', error: 'instance_ended' }, usageFromRow(run));
    return 'instance_ended';
  }
  await instance.sendEvent({ type: 'agent-resumed', payload: { run_id: run.id } });
  return 'resumed';
}

async function sendCard(ports: Ports, m: Extract<AgentEventV1, { type: 'card' }>): Promise<string> {
  const card = m.card as CardV1 | undefined;
  if (!card || typeof card !== 'object' || card.v !== 1 || !Array.isArray(card.lines)) return 'bad_input';
  // Notices travel without a token: the card renders with its "Open" button only.
  await ports.telegram.sendCard(card, null);
  return 'sent';
}

async function decision(d: ReplyDeps, m: DecisionMessageV1): Promise<string> {
  if (!UUID_RE.test(m.run_id ?? '')) return 'bad_input';
  if (m.card_kind === 'reply_pick') return handleReplyPick(m, d);
  return 'unhandled_kind';
}

async function handle(env: OpsEnv, ports: Ports, deps: AgentEventsDeps, body: AgentEventV1, attempts: number): Promise<string> {
  const d: ReplyDeps = { env, ports, match: deps.match };
  switch (body?.type) {
    case 'inbound-reply':
      try {
        return await handleInboundReply(body, d);
      } catch (error) {
        if (attempts < MAX_ATTEMPTS) throw error;
        await failInboundReply(body, d, 'reply_failed');
        return 'failed';
      }
    case 'order-created':
      return orderCreated(env, body);
    case 'resume-parked':
      return resumeParked(env, ports, body);
    case 'card':
      return sendCard(ports, body);
    case 'decision':
      return decision(d, body);
    default:
      return 'unknown';
  }
}

export async function agentEventsConsumer(batch: MessageBatch<AgentEventV1>, env: OpsEnv, ctx: ExecutionContext, deps: AgentEventsDeps = {}): Promise<void> {
  void ctx;
  let ports: Ports | undefined = deps.ports;
  for (const message of batch.messages) {
    const body = message.body;
    const type = typeof body === 'object' && body !== null && typeof (body as { type?: unknown }).type === 'string' ? String((body as { type: string }).type) : 'unknown';
    try {
      ports ??= makePorts(env);
      const outcome = await handle(env, ports, deps, body, message.attempts ?? 1);
      log(type, { id: message.id, outcome });
      message.ack();
    } catch (error) {
      console.error(formatLogLine(LOG_PREFIX, 'agent-events retry', { type, id: message.id, attempts: message.attempts ?? 1 }), describeError(error));
      message.retry();
    }
  }
}
