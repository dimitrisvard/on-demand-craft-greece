// Bindings, vars and secrets of microns-ops (wrangler.jsonc). Secrets are declared here by name only; values
// live in `wrangler secret` or the gitignored .dev.vars.

import type { OpsCall } from '../../shared/src/http/rpc';
import type { ScrapeMessage } from './queues/messages';

export interface OpsEnv {
  SUPABASE_URL: string;               // var
  SITE_ORIGIN: string;                // var, "https://www.micronshub.eu"
  SUPABASE_SERVICE_ROLE_KEY: string;  // secret
  SUPABASE_ANON_KEY: string;          // secret
  RESEND_API_KEY: string;             // secret
  RESEND_WEBHOOK_SECRET: string;      // secret
  TELEGRAM_BOT_TOKEN: string;         // secret
  TELEGRAM_CHAT_ID: string;           // secret
  GOOGLE_CLIENT_ID: string;           // secret
  GOOGLE_CLIENT_SECRET: string;       // secret
  GOOGLE_REDIRECT_URI: string;        // secret
  APOLLO_API_KEY: string;             // secret
  SCRAPES: Queue<ScrapeMessage>;      // queue producer "scrapes"
}

/** Hono environment of the ops app: the call registered by OpsApi.handle is in c.var.call. */
export type OpsHono = { Bindings: OpsEnv; Variables: { call: OpsCall } };

// Stable prefix for every log line of this Worker, so Workers Logs can be filtered on it.
export const LOG_PREFIX = '[microns-ops]';
