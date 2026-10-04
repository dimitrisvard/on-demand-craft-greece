// /api/scan-directory -> api/scan-directory.js.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/scan-directory', vercelRoute(() => import('../../../../api/scan-directory.js')));
}
