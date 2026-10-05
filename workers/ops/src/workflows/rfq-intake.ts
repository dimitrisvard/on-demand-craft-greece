// RfqIntakeWorkflow ('rfq-intake'): one instance per inbound RFQ e-mail (id 'rfq-intake-<32 hex of
// message_id_sha256>'): parse and store, triage, extract, classify, confirm with a human, create the RFQ, copy the
// files, enqueue CAD jobs, start the quote. Params carry ids only.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { OpsEnv } from '../env';

export interface RfqIntakeParams {
  v: 1;
  inbound_email_id: string;
  message_id_sha256: string;
  tenant_id: string;
}

export class RfqIntakeWorkflow extends WorkflowEntrypoint<OpsEnv, RfqIntakeParams> {
  async run(event: Readonly<WorkflowEvent<RfqIntakeParams>>, step: WorkflowStep): Promise<unknown> {
    throw new Error('not implemented: IN');
  }
}
