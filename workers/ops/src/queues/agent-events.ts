// Consumer of the queue "agent-events": inbound replies, order-created, resume-parked and cards; each message is
// acked or retried on its own.

import type { OpsEnv } from '../env';
import type { AgentEventV1 } from './messages';

export async function agentEventsConsumer(batch: MessageBatch<AgentEventV1>, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
  throw new Error('not implemented: RP');
}
