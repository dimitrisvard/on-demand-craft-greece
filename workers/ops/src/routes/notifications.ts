// /api/notifications -> api/notifications.js: partner, production-status, nest and every inv-* action. The module
// carries the nesting and inventory code (pdf-lib, qrcode, makerjs), so it lives only in microns-ops; `qrcode`
// resolves to its server build through the wrangler alias. `nest` is bounded by limits.cpu_ms, not by the
// shim's timer (a synchronous CPU loop does not yield to it).

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/notifications', vercelRoute(() => import('../../../../api/notifications.js')));
}
