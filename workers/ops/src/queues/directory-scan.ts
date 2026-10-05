// Background directory scans on the queue "scrapes" (envelope DirectoryScanMessage; the Phase 2 ScrapeMessage and
// its consumer stay unchanged). sendDirectoryScan is the only typed send of this envelope (size checked as
// enqueueScrape does); src/index.ts routes a batch whose every message is a DirectoryScanMessage here.

import type { OpsEnv } from '../env';
import type { DirectoryScanMessage } from './messages';

export async function sendDirectoryScan(env: OpsEnv, m: Omit<DirectoryScanMessage, 'v' | 'kind' | 'enqueued_at'>): Promise<void> {
  throw new Error('not implemented: XZ');
}

export async function directoryScanConsumer(batch: MessageBatch<DirectoryScanMessage>, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
  throw new Error('not implemented: XZ');
}
