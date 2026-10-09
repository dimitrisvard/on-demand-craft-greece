// /api/marketing in microns-ops, by the action the site resolved (call.action):
//   webhook      -> handleResendWebhook (signature verified on the raw bytes before the handler runs)
//   google-auth  -> handleGoogleAuth (Gmail connect)
//   send-campaign -> handleSendCampaign (Phase 5: queues the campaign's mails, src/routes/marketing-send.ts)
//   anything else (apollo-enrich, sentinels such as '#unknown') -> api/marketing.js unchanged
// `track` is served by microns-site itself; should it arrive here, the handler answers it unchanged.

import type { Hono } from 'hono';
import { vercelRoute } from '../compat/express-shim';
import type { OpsHono } from '../env';
import { handleGoogleAuth } from './google-auth';
import { handleSendCampaign } from './marketing-send';
import { handleResendWebhook } from './marketing-webhook';

const marketingHandler = vercelRoute(() => import('../../../../api/marketing.js'));

export function register(app: Hono<OpsHono>): void {
  app.all('/api/marketing', (c) => {
    switch (c.var.call.action) {
      case 'webhook':
        return handleResendWebhook(c);
      case 'google-auth':
        return handleGoogleAuth(c);
      case 'send-campaign':
        return handleSendCampaign(c);
      default:
        return marketingHandler(c);
    }
  });
}
