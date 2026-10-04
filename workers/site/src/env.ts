// Bindings and vars of microns-site (wrangler.jsonc; docs/migration/ARCHITECTURE.md §7.1, Phase 1 subset).
// Secrets are declared here by name only; values live in `wrangler secret` or the gitignored .dev.vars.
//
// Phase 2 (/api port) fields are all optional: there is no global config check. Each /api dispatch target and
// each gate check declares the names it needs and checks them per request (workers/shared/src/http/env-check.ts),
// so a missing name answers 500 only on the requests that need it.

import type { OpsApiRpc } from '../../shared/src/http/rpc';

export interface Env {
  ASSETS: Fetcher;
  SEO_CACHE: KVNamespace;
  FLAGS: KVNamespace;
  SUPABASE_URL: string;          // var, "https://cfjrtmtaitwzggzpkhxi.supabase.co"
  SUPABASE_ANON_KEY: string;     // secret
  SITE_ORIGIN: string;           // var, "https://www.micronshub.eu"
  PREVIEW_HOSTNAMES: string;     // var, comma-separated hostnames that get X-Robots-Tag: noindex (plus any *.workers.dev)
  SEO_STRICT_404: string;        // var, "false"
  API_FORWARD_ORIGIN: string;    // var, "https://on-demand-craft-greece.vercel.app" (target of the /api forward, src/api/forward.ts)
  HSTS_VALUE?: string;           // var, optional; emitted only on the production host when set (value from the P0-3 baseline)
  DIRECTORY_INDEX_EMULATION: string; // var, "true" | "false": serve <dir>/index.html for /dir and /dir/ (router step 5; set from the P0-3 baseline)

  // ----- Phase 2: /api port (all optional) -----
  OPS?: Fetcher & OpsApiRpc;              // service binding to microns-ops, entrypoint OpsApi (RPC)
  PRIVATE_FILES?: R2Bucket;               // R2 bucket microns-private (jurisdiction eu)
  API_RATE_LIMIT?: RateLimit;             // rate limiting binding, 30 / 60 s
  API_RATE_LIMIT_MAIL?: RateLimit;        // rate limiting binding, 5 / 60 s (mail keys); falls back to API_RATE_LIMIT
  API_RATE_LIMIT_BULK?: RateLimit;        // rate limiting binding, 300 / 60 s (idempotent reads, upload presigns); falls back to API_RATE_LIMIT
  R2_ACCOUNT_ID?: string;                 // var, Cloudflare account id (R2 S3 API endpoint)
  LEGACY_S3_REGION?: string;              // var, "eu-north-1"
  LEGACY_S3_RFQ_BUCKET?: string;          // var, legacy S3 bucket of RFQ files
  LEGACY_S3_ARTICLES_BUCKET?: string;     // var, legacy S3 bucket of article images
  API_FORWARD_TO_VERCEL?: string;         // var, "true" forwards every /api/* to API_FORWARD_ORIGIN (fallback of the KV flag api.forward_to_vercel)
  ACCESS_TEAM_DOMAIN?: string;            // var, Cloudflare Access team domain (machine callers)
  ACCESS_AUD?: string;                    // var, Access application audience tag(s)
  API_GATES_MODE?: string;                // var, "<class>=report|enforce" comma list
  API_MACHINE_HOSTS?: string;             // var, comma list of hosts (exact match) besides preview hosts that accept machine callers
  SUPABASE_SERVICE_ROLE_KEY?: string;     // secret
  RESEND_API_KEY?: string;                // secret
  TURNSTILE_SECRET_KEY?: string;          // secret
  R2_ACCESS_KEY_ID?: string;              // secret, R2 API token (S3 API)
  R2_SECRET_ACCESS_KEY?: string;          // secret
  LEGACY_AWS_ACCESS_KEY_ID?: string;      // secret, legacy S3 access
  LEGACY_AWS_SECRET_ACCESS_KEY?: string;  // secret
  ACCESS_MACHINE_CLIENT_IDS?: string;     // secret, "<client-id>=<name>,…" for the machine service tokens
}

// Stable prefix for every log line of this Worker, so Workers Logs can be filtered on it.
export const LOG_PREFIX = '[microns-site]';
