// Every-10-minutes dispatcher: Gmail poller; inbound rows left 'received' for more than 15 minutes; portal orders
// without a post-order run; parked runs whose flag is on again (flag_off) or older than 30 minutes
// (llm_unavailable); failure-card runs older than 14 days closed 'failed'; CAD jobs stuck for more than 30 minutes
// marked dead_letter.

import type { OpsEnv } from '../env';
import type { Ports } from '../ports/index';

export async function dispatcherTick(env: OpsEnv, controller: ScheduledController, deps?: { ports?: Ports }): Promise<void> {
  throw new Error('not implemented: RP');
}
