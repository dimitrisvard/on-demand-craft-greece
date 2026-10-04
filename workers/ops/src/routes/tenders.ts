// /api/tenders -> api/tenders.js. /api/connector-status arrives here too: the site merges its rewrite into the
// function URL (/api/tenders?…connectors=true), which is what the handler reads.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/tenders', vercelRoute(() => import('../../../../api/tenders.js')));
}
