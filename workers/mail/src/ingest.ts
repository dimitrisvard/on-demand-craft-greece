// M5 hand-over: the stored row goes to microns-ops over the service binding OPS (named entrypoint MailIngest):
// 'rfq' -> startIntake, 'replies' -> ingestReply. Ids only. Any error is reported as 'handover_failed' and never
// fails the handler: the 10-minute dispatcher in ops starts rows still 'received' after 15 minutes.

import type { MailIngestRpc } from '../../shared/src/agent-types';
import type { Mailbox } from './headers';

export type HandOverOutcome = 'started' | 'exists' | 'flag_off' | 'queued' | 'rejected' | 'handover_failed';

export async function handOver(
  ops: Pick<MailIngestRpc, 'startIntake' | 'ingestReply'>,
  mailbox: Mailbox,
  ids: { inbound_email_id: string; message_id_sha256: string; tenant_id: string },
): Promise<HandOverOutcome> {
  try {
    if (mailbox === 'rfq') {
      const result = await ops.startIntake({ v: 1, ...ids });
      return result.status;
    }
    const result = await ops.ingestReply({ v: 1, ...ids, mailbox: 'replies' });
    return result.status;
  } catch {
    return 'handover_failed';
  }
}
