// Bindings and vars of microns-site (wrangler.jsonc; docs/migration/ARCHITECTURE.md §7.1, Phase 1 subset).
// Secrets are declared here by name only; values live in `wrangler secret` or the gitignored .dev.vars.

export interface Env {
  ASSETS: Fetcher;
  SEO_CACHE: KVNamespace;
  FLAGS: KVNamespace;
  SUPABASE_URL: string;          // var, "https://cfjrtmtaitwzggzpkhxi.supabase.co"
  SUPABASE_ANON_KEY: string;     // secret
  SITE_ORIGIN: string;           // var, "https://www.micronshub.eu"
  PREVIEW_HOSTNAMES: string;     // var, comma-separated hostnames that get X-Robots-Tag: noindex (plus any *.workers.dev)
  SEO_STRICT_404: string;        // var, "false"
  API_FORWARD_ORIGIN: string;    // var, "https://www.micronshub.eu" (Phase 1: /api/* is forwarded to Vercel production)
  HSTS_VALUE?: string;           // var, optional; emitted only on the production host when set (value from the P0-3 baseline)
  DIRECTORY_INDEX_EMULATION: string; // var, "true" | "false": serve <dir>/index.html for /dir and /dir/ (router step 5; set from the P0-3 baseline)
}

// Stable prefix for every log line of this Worker, so Workers Logs can be filtered on it.
export const LOG_PREFIX = '[microns-site]';
