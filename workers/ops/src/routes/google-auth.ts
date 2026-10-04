// /api/marketing?action=google-auth: Gmail connect (authorize, callback, refresh, error steps).

import type { Context } from 'hono';
import type { OpsHono } from '../env';

export function handleGoogleAuth(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: G');
}
