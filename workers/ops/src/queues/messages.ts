// Messages of the queue "scrapes" (long scans run by the consumer instead of the request).
//
// Rules
//   - One message is one scan: {v: 1, kind, params, run_id, enqueued_at, requested_by}, sent as JSON.
//   - A message body stays under the Queues limit of 128 KB (1 KB = 1,000 bytes, about 100 bytes of it are queue
//     metadata); a larger one is refused before it is sent.
//   - `requested_by` names the principal class (and machine name), never a user's e-mail address.

import { logLine } from '../../../shared/src/http/log';
import { LOG_PREFIX, type OpsEnv } from '../env';

export interface ScrapeMessage {
  v: 1;
  kind: 'tender-scan' | 'funded-scan';
  params: Record<string, unknown>;
  run_id: string;
  enqueued_at: string;
  requested_by: string;
}

/** Largest JSON body of one message, in bytes. */
export const MAX_MESSAGE_BYTES = 127_900;

/** Sends one message and returns its run_id. */
export async function enqueueScrape(
  env: OpsEnv,
  kind: ScrapeMessage['kind'],
  params: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const message: ScrapeMessage = {
    v: 1,
    kind,
    params,
    run_id: crypto.randomUUID(),
    enqueued_at: new Date().toISOString(),
    requested_by: requestedBy,
  };
  const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  if (size > MAX_MESSAGE_BYTES) throw new Error(`scrapes message too large: ${size} bytes`);
  await env.SCRAPES.send(message, { contentType: 'json' });
  logLine(LOG_PREFIX, 'scrapes enqueued', { kind, run_id: message.run_id, requested_by: requestedBy });
  return message.run_id;
}
