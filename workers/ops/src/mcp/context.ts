// What a remote MCP tool sees: the verified principal, the stage of flag mcp.remote, and the adapters it may use
// (Supabase client with the service role, the agent ports, the scraper module, the GSC client, in-process ops
// routes, the queue). Everything is built lazily per request; tests replace any part through McpDeps.
//
// Rules
//   - The Supabase client is created per request with the service role, no session persistence, and a 10 s timeout
//     on every PostgREST call; the query builders are the ones of mcp-server/src/index.ts, so filters and ordering
//     stay identical to the local server.
//   - Data of the agent tables is read for the default tenant only (AGENT_TENANT_ID).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TENANT_ID } from '../agents/flags';
import type { OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { scraperBrowser } from '../scrapers/browser';
import { scraperDeps, type ScraperDeps } from '../scrapers/context';
import type { McpPrincipal } from './auth';
import type { McpStage } from './registry';

export const SUPABASE_TIMEOUT_MS = 10_000;

/** The GSC module the Phase 2 /api/gsc route uses (api/_lib/gsc-client.js). */
export interface GscClient {
  searchAnalytics(req: Record<string, unknown>): Promise<{ rows?: Array<Record<string, unknown>> } & Record<string, unknown>>;
  inspectUrl(url: string, languageCode?: string): Promise<Record<string, unknown> | null>;
  getIndexingQuotaUsed(): Promise<{ used: number; limit: number }>;
  submitBatchForIndexing(urls: string[], type?: string, submittedBy?: string): Promise<{ results: Array<{ url: string; status: string; error?: string }>; quota: { used: number; limit: number } }>;
  listSitemaps(): Promise<Array<Record<string, unknown>>>;
  submitSitemap(feedpath: string): Promise<unknown>;
}

export interface InProcessCall {
  endpoint: 'tenders' | 'scrape-website' | 'agent';
  action: string;
  /** Function path + query, e.g. '/api/tenders?export=csv'. */
  functionUrl: string;
  method: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
}

export interface McpDeps {
  fetch: typeof fetch;
  ports: (env: OpsEnv) => Ports;
  supabase: (env: OpsEnv, fetchImpl: typeof fetch) => SupabaseClient;
  scraper: (env: OpsEnv, ports: Ports) => ScraperDeps;
  gsc: () => Promise<GscClient>;
  inprocess: (ctx: McpContext, call: InProcessCall) => Promise<Response>;
  now: () => Date;
  /** A timer: scan_directory waits on it (at most 20 s) for its in-call scan. */
  sleep: (ms: number) => Promise<void>;
}

export interface McpContext {
  env: OpsEnv;
  exec: ExecutionContext;
  principal: McpPrincipal;
  stage: McpStage;
  tenantId: string;
  deps: McpDeps;
  /** Lazily created per request. */
  sb(): SupabaseClient;
  ports(): Ports;
  scraper(): ScraperDeps;
  /** 'user:<uid>', the actor label of audit rows and activity rows. */
  actor: string;
}

/** fetch with a per-call timeout (combined with the caller's signal). */
export function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, signal });
  }) as typeof fetch;
}

export function serviceSupabase(env: OpsEnv, fetchImpl: typeof fetch): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withTimeout(fetchImpl, SUPABASE_TIMEOUT_MS) },
  });
}

async function loadGsc(): Promise<GscClient> {
  return (await import('../../../../api/_lib/gsc-client.js')) as unknown as GscClient;
}

/** Production dependencies (in-process calls are wired by server.ts to avoid an import cycle). */
export function defaultDeps(inprocess: McpDeps['inprocess']): McpDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    ports: (env) => makePorts(env, { browser: scraperBrowser(env) ?? undefined }),
    supabase: serviceSupabase,
    scraper: (env, ports) => scraperDeps(env, { db: ports.db }),
    gsc: loadGsc,
    inprocess,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function createContext(o: { env: OpsEnv; exec: ExecutionContext; principal: McpPrincipal; stage: McpStage; deps: McpDeps }): McpContext {
  let sb: SupabaseClient | undefined;
  let ports: Ports | undefined;
  let scraper: ScraperDeps | undefined;
  const ctx: McpContext = {
    env: o.env,
    exec: o.exec,
    principal: o.principal,
    stage: o.stage,
    tenantId: o.env.AGENT_TENANT_ID || DEFAULT_TENANT_ID,
    deps: o.deps,
    actor: `user:${o.principal.uid}`,
    sb: () => (sb ??= o.deps.supabase(o.env, o.deps.fetch)),
    ports: () => (ports ??= o.deps.ports(o.env)),
    scraper: () => (scraper ??= o.deps.scraper(o.env, ctx.ports())),
  };
  return ctx;
}
