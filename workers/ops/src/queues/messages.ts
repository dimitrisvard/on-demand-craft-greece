// Messages of the queue "scrapes" (long scans run by the consumer instead of the request).

import type { OpsEnv } from '../env';

export interface ScrapeMessage {
  v: 1;
  kind: 'tender-scan' | 'funded-scan';
  params: Record<string, unknown>;
  run_id: string;
  enqueued_at: string;
  requested_by: string;
}

/** Sends one message and returns its run_id. */
export function enqueueScrape(
  env: OpsEnv,
  kind: ScrapeMessage['kind'],
  params: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  throw new Error('not implemented: C');
}
