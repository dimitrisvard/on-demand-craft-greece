// /api/funded-startups -> api/funded-startups.js, synchronous for every caller (the scan answer carries the counts
// the dashboard and the MCP server print). The queue kind "funded-scan" runs the same handler (queues/scrapes.ts).

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/funded-startups', vercelRoute(() => import('../../../../api/funded-startups.js')));
}
