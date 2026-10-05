// PostOrderWorkflow ('post-order'): one instance per order (id 'post-order-<order_id>'): traveller PDF, stock holds,
// partner hand-off with a human approval, reorder draft.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { OpsEnv } from '../env';

export interface PostOrderParams {
  v: 1;
  order_id: string;
  tenant_id: string;
  source: 'quote' | 'portal' | 'dashboard';
}

export class PostOrderWorkflow extends WorkflowEntrypoint<OpsEnv, PostOrderParams> {
  async run(event: Readonly<WorkflowEvent<PostOrderParams>>, step: WorkflowStep): Promise<unknown> {
    throw new Error('not implemented: RP');
  }
}
