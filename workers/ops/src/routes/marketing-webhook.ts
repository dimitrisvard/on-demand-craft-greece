// /api/marketing?action=webhook: Svix verification on the raw bytes, then the unchanged handler.

import type { Context } from 'hono';
import type { OpsHono } from '../env';

export function handleResendWebhook(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: G');
}
