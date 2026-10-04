// /api/scrape-website -> api/scrape-website.js, /api/scrape-company-profile -> api/scrape-company-profile.js.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';

export function register(app: Hono<OpsHono>): void {
  app.all('/api/scrape-website', vercelRoute(() => import('../../../../api/scrape-website.js')));
  app.all('/api/scrape-company-profile', vercelRoute(() => import('../../../../api/scrape-company-profile.js')));
}
