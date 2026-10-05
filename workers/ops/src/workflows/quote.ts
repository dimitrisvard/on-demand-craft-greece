// QuoteWorkflow ('quote'): one instance per RFQ and quote version (id 'quote-<rfq_id>-v<n>'): CAD results, price
// draft, notes and cover e-mail, PDF, human approval, send, follow-ups and the customer's reply (won -> order).

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { OpsEnv } from '../env';

export interface QuoteParams {
  v: 1;
  rfq_id: string;
  quote_version: number;
  tenant_id: string;
  trigger: 'intake' | 'dashboard' | 'revision';
  requested_by?: string;
}

export class QuoteWorkflow extends WorkflowEntrypoint<OpsEnv, QuoteParams> {
  async run(event: Readonly<WorkflowEvent<QuoteParams>>, step: WorkflowStep): Promise<unknown> {
    throw new Error('not implemented: CQ');
  }
}
