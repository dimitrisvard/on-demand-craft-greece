// Bindings, vars and secrets of microns-ops (wrangler.jsonc). Secrets are declared here by name only; values
// live in `wrangler secret` or the gitignored .dev.vars.

import type { OpsCall } from '../../shared/src/http/rpc';
import type { CadRouter } from './do/cad-router';
import type { MaterialStock } from './do/material-stock';
import type { RfqThread } from './do/rfq-thread';
import type { AgentEventV1, CadJobMessageV1, ScrapeMessage } from './queues/messages';
import type { PostOrderParams } from './workflows/post-order';
import type { QuoteParams } from './workflows/quote';
import type { RfqIntakeParams } from './workflows/rfq-intake';

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

  // ----- Phase 4: agent layer (all optional, checked per use with need(), src/agents/config.ts) -----
  // An unrelated deploy or a Phase 2 code path never depends on these; a missing one fails only the agent step
  // that needs it.
  // bindings
  FLAGS?: KVNamespace;                                   // KV mirror of public.feature_flags (read, cacheTtl 30 s)
  PRIVATE_FILES?: R2Bucket;                              // microns-private (jurisdiction eu)
  CAD_JOBS?: Queue<CadJobMessageV1>;                     // queue producer "cad-jobs"
  AGENT_EVENTS?: Queue<AgentEventV1>;                    // queue producer "agent-events"
  RFQ_INTAKE?: Workflow<RfqIntakeParams>;                // workflow "rfq-intake"
  QUOTE?: Workflow<QuoteParams>;                         // workflow "quote"
  POST_ORDER?: Workflow<PostOrderParams>;                // workflow "post-order"
  RFQ_THREAD?: DurableObjectNamespace<RfqThread>;
  MATERIAL_STOCK?: DurableObjectNamespace<MaterialStock>;
  CAD_ROUTER?: DurableObjectNamespace<CadRouter>;
  QUOTES_INDEX?: VectorizeIndex;                         // removed in generated T2 configs (no local simulation)
  AI?: Ai;                                               // removed in generated T2 configs
  BROWSER?: Fetcher;                                     // removed in generated T2 configs
  EVENTS?: AnalyticsEngineDataset;                       // dataset microns_events
  MCP_RATE_LIMIT?: RateLimit;                            // 60 per 60 s, key mcp:<uid>
  // vars
  AI_GATEWAY_ID?: string;                                // "microns"
  AGENT_TENANT_ID?: string;                              // default tenant uuid
  QUOTE_FROM?: string;
  QUOTE_REPLY_TO?: string;
  MESSAGE_ID_DOMAIN?: string;
  CAD_BACKEND_DEFAULT?: 'vps' | 'container';
  MCP_HOSTNAME?: string;
  MCP_ROUTE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  MCP_ACCESS_AUD?: string;
  SCRAPER_USER_AGENT?: string;
  SCRAPER_PERMITTED_HOSTS?: string;                      // JSON object host -> permission reference
  // T2 only (generated configs); never in the production wrangler.jsonc
  AGENT_STUBS?: string;                                  // comma list of stubbed ports, e.g. "llm,embed,vector,browser"
  AGENT_LLM_BASE_URL?: string;
  RESEND_API_BASE?: string;
  TELEGRAM_API_BASE?: string;
  GMAIL_API_BASE?: string;
  GOOGLE_TOKEN_URL?: string;
  // secrets (optional at deploy, checked per use)
  AI_GATEWAY_TOKEN?: string;                             // cf-aig-authorization
  CAD_UNFOLD_URL?: string;                               // base URL of the unfold service
  CAD_SHARED_SECRET?: string;                            // X-API-Key of the unfold service
  AGENT_APPROVAL_SECRET?: string;                        // signed file links (shared with the site and the relay)
  CAD_ACCESS_CLIENT_ID?: string;                         // optional Access service token of the CAD backend host
  CAD_ACCESS_CLIENT_SECRET?: string;
}

/** Hono environment of the ops app: the call registered by OpsApi.handle is in c.var.call. */
export type OpsHono = { Bindings: OpsEnv; Variables: { call: OpsCall } };

// Stable prefix for every log line of this Worker, so Workers Logs can be filtered on it.
export const LOG_PREFIX = '[microns-ops]';
