// The flag-on branch of /api/scan-directory and /api/scrape-company-profile: the one branch at the top of each of
// those Phase 2 routes (src/routes/scan-directory.ts, src/routes/scrape.ts); everything this branch does not take
// runs the Phase 2 handler unchanged.
//
// Rules
//   - The module path is taken only when every condition holds, checked in this order: method POST;
//     SCRAPER_PERMITTED_HOSTS names at least one host; the body (parsed as the handler parses it) carries a string
//     url whose host is named there; flag agent.growth.scrapers is on. Otherwise the Phase 2 handler runs with the
//     same body bytes, so its answer is unchanged. With no permitted host nothing is parsed and no flag is read.
//   - Module path: scanDirectoryPage (/api/scan-directory) or scrapeProfile (/api/scrape-company-profile) with the
//     request's url and source (robots gate, crawler identity, host pause, Browser Run only as directory.ts allows).
//     The answer is the module's status and JSON body with the handler's CORS headers, produced through the shim
//     exactly as the handler's res.json() is; the 200 body is the handler's body.
//   - Bookkeeping per module-path request: one agent_runs row (agent 'growth.scrapers', idempotency key
//     'growth.scrapers:<requestId>', trigger 'mcp' for the MACHINE caller mcp, else 'dashboard'), closed in the
//     request as succeeded, skipped ('robots_disallowed') or failed (the answer's error code); one scan_logs row
//     (scan_type 'directory' or 'profile'; a paused host as error_message 'blocked:<host>'). No company row is written
//     (the handlers do not write either). A bookkeeping failure is logged and never changes the answer.
//   - A scan that throws (e.g. Browser Run unavailable) answers the handler's fetch-failure shape, 502
//     {"error":"Failed to fetch directory"} or {"error":"Failed to fetch profile"}, and is recorded like any failed
//     scan: run 'failed' ('scan_failed'), scan_logs status 'failed' with error_message 'scan_failed'.

import type { Context } from 'hono';
import { parseVercelBody, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { formatLogLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { EMPTY_USAGE, closeRun, openRun } from '../agents/runs';
import { requestBytes, runVercel } from '../compat/express-shim';
import { PostgrestDb, type Db } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';
import { pauseMarker, scraperDeps, type ScraperDeps } from './context';
import { scanDirectoryPage, type PageScan } from './directory';
import { extractSearchMeta } from './parsers/directory';
import { scrapeProfile, type ProfileScan } from './profile';
import { hostOf, parsePermittedHosts } from './robots';
import { writeScanLog } from './store';

export type ScraperRouteKind = 'directory' | 'profile';

/** The handlers' fetch-failure answers without their error text (api/scan-directory.js:399, api/scrape-company-profile.js:365). */
const FETCH_FAILED: Readonly<Record<ScraperRouteKind, string>> = { directory: 'Failed to fetch directory', profile: 'Failed to fetch profile' };

export interface ScraperRouteDeps {
  db(env: OpsEnv): Db;
  scraper(env: OpsEnv, db: Db | undefined): ScraperDeps;
  now(): Date;
}

export const defaultScraperRouteDeps: ScraperRouteDeps = {
  db: (env) => new PostgrestDb({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
  scraper: (env, db) => scraperDeps(env, { db }),
  now: () => new Date(),
};

// The CORS headers api/scan-directory.js and api/scrape-company-profile.js set on every answer (their setCors).
function setHandlerCors(res: { setHeader(name: string, value: unknown): void }): void {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

/** A JSON answer produced through the shim, so it carries exactly the headers of the handler's res.json(). */
function answer(c: Context<OpsHono>, status: number, body: unknown): Promise<Response> {
  const fixed: VercelHandler = (_req, res) => {
    setHandlerCors(res);
    return res.status(status).json(body);
  };
  return runVercel(c, fixed, { body: null });
}

/** The parsed body when the module path applies (see the rules above), else null. */
export async function moduleRequest(env: OpsEnv, method: string, contentType: string | null, bytes: Uint8Array | null): Promise<Record<string, unknown> | null> {
  if (method.toUpperCase() !== 'POST') return null;
  const permitted = parsePermittedHosts(env.SCRAPER_PERMITTED_HOSTS);
  if (permitted.size === 0) return null;
  const view = parseVercelBody(contentType, bytes ?? new Uint8Array(0));
  if (!view.ok) return null;
  const body = Object(view.value || {}) as Record<string, unknown>;
  if (typeof body.url !== 'string') return null;
  const host = hostOf(body.url);
  if (host === null || !permitted.has(host)) return null;
  const flag = await readFlag(env, 'agent.growth.scrapers');
  return flag.enabled ? body : null;
}

function logBookkeeping(event: string, error: unknown, requestId: string): void {
  console.error(formatLogLine(LOG_PREFIX, `scraper route ${event} failed`, { error: error instanceof Error ? error.name : typeof error, requestId }));
}

async function runModule(c: Context<OpsHono>, kind: ScraperRouteKind, body: Record<string, unknown>, deps: ScraperRouteDeps): Promise<Response> {
  const call = c.var.call;
  const env = c.env;
  let db: Db | null = null;
  try {
    db = deps.db(env);
  } catch (error) {
    logBookkeeping('db', error, call.requestId);
  }
  let runId: string | null = null;
  if (db) {
    try {
      const opened = await openRun(db, {
        agent: 'growth.scrapers',
        trigger: call.principal.class === 'MACHINE' && call.principal.machine === 'mcp' ? 'mcp' : 'dashboard',
        idempotency_key: `growth.scrapers:${call.requestId}`,
        tenant_id: env.AGENT_TENANT_ID,
      });
      runId = opened.run_id;
    } catch (error) {
      logBookkeeping('run open', error, call.requestId);
    }
  }

  const started = deps.now();
  let scan: PageScan | ProfileScan;
  let threw = false;
  try {
    const scraper = deps.scraper(env, db ?? undefined);
    scan = kind === 'directory'
      ? await scanDirectoryPage(scraper, { url: body.url, source: body.source })
      : await scrapeProfile(scraper, { url: body.url, source: body.source });
  } catch (error) {
    threw = true;
    console.error(formatLogLine(LOG_PREFIX, 'scraper route scan failed', { error: error instanceof Error ? error.name : typeof error, requestId: call.requestId }));
    scan = { ok: false, status: 502, body: { error: FETCH_FAILED[kind] } };
  }
  const url = String(body.url);
  const source = scan.ok ? scan.body.source : typeof body.source === 'string' ? body.source.slice(0, 40) : 'unknown';
  const errorCode = scan.ok ? null : threw ? 'scan_failed' : scan.body.error;
  const companies = scan.ok && 'companies' in scan.body ? scan.body.companies.length : 0;
  const paused = scan.ok ? undefined : scan.paused;

  if (db) {
    const keyword = kind === 'directory' && (source === 'europages' || source === 'wlw') ? extractSearchMeta(url, source).keyword || null : null;
    await writeScanLog(db, {
      scan_type: kind,
      source,
      keyword,
      url,
      ok: scan.ok,
      companies_found: companies,
      error_message: paused ? pauseMarker(paused) : errorCode,
      started_at: started,
      completed_at: deps.now(),
    });
  }
  if (db && runId) {
    const outcome = scan.ok
      ? { status: 'succeeded' as const }
      : errorCode === 'robots_disallowed' ? { status: 'skipped' as const, error: errorCode } : { status: 'failed' as const, error: paused ? 'host_blocked' : String(errorCode).slice(0, 120) };
    const output: Record<string, unknown> = { route: kind, source, status: scan.status, companies_found: companies, robots: scan.robots?.reason ?? null };
    if (scan.robots?.permission) output.permission = scan.robots.permission;
    if (scan.ok && 'rendered' in scan) output.rendered = scan.rendered;
    try {
      await closeRun(db, runId, { ...outcome, output }, { ...EMPTY_USAGE, by_step: {} });
    } catch (error) {
      logBookkeeping('run close', error, call.requestId);
    }
  }
  return answer(c, scan.status, scan.body);
}

/**
 * The route handler: the module path when moduleRequest() selects the request, else `phase2` (the Phase 2 route
 * handler, unchanged).
 */
export function scraperRoute(
  kind: ScraperRouteKind,
  phase2: (c: Context<OpsHono>) => Promise<Response>,
  deps: ScraperRouteDeps = defaultScraperRouteDeps,
): (c: Context<OpsHono>) => Promise<Response> {
  return async (c) => {
    const bytes = await requestBytes(c);
    const body = await moduleRequest(c.env, c.req.method, c.req.header('content-type') ?? null, bytes);
    // The Phase 2 handler reads the same body again (Hono keeps the bytes it read).
    if (body === null) return phase2(c);
    return runModule(c, kind, body, deps);
  };
}
