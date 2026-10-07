// /api/scan-directory -> api/scan-directory.js.
// Phase 4: one branch at the top (src/scrapers/route.ts): a POST whose url host is in SCRAPER_PERMITTED_HOSTS while
// flag agent.growth.scrapers is on goes to the scraper module; every other request runs the Phase 2 handler below,
// unchanged.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';
import { scraperRoute } from '../scrapers/route';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/scan-directory', scraperRoute('directory', vercelRoute(() => import('../../../../api/scan-directory.js'))));
}
