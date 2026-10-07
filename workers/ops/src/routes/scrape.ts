// /api/scrape-website -> api/scrape-website.js, /api/scrape-company-profile -> api/scrape-company-profile.js.
// Phase 4: one branch at the top of /api/scrape-company-profile (src/scrapers/route.ts): a POST whose url host is in
// SCRAPER_PERMITTED_HOSTS while flag agent.growth.scrapers is on goes to the scraper module; every other request
// runs the Phase 2 handler below, unchanged. /api/scrape-website is unchanged.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';
import { scraperRoute } from '../scrapers/route';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/scrape-website', vercelRoute(() => import('../../../../api/scrape-website.js')));
  app.all('/api/scrape-company-profile', scraperRoute('profile', vercelRoute(() => import('../../../../api/scrape-company-profile.js'))));
}
