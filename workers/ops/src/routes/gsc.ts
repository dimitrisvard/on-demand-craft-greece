// /api/gsc -> api/gsc.js (all methods; the handler's own admin check still runs after the site gate).

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/gsc', vercelRoute(() => import('../../../../api/gsc.js')));
}
