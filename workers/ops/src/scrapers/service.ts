// A directory scan job with its writes: pages (directory.ts), company_leads upsert, optional profile enrichment,
// the scan_logs rows and the saved search's last run. Used by the queue kind 'directory-scan' and by the remote MCP
// tool scan_directory (up to 3 pages in the request). The agent_runs row belongs to the caller, which closes it with
// directoryJobOutcome().
//
// Rules
//   - Companies are written once per job after the pages (store.ts upsertCompanies).
//   - Profile enrichment (enrichProfiles): for at most 20 companies of this job without a website, one profile page
//     each (profile.ts), one at a time, with the page delay of the directory (and its Crawl-delay); only fields the
//     profile found are written; it stops at the first robots refusal or host pause.
//   - The scan_logs row is written for every job: error_message = 'blocked:<host>' when the directory host was
//     paused, else the first page error or null; status 'completed' when at least one page was read, else 'failed'.
//     A host paused during enrichment gets its own row (scan_type 'profile', status 'failed', error_message
//     'blocked:<host>'), so every isolate sees that pause too (context.ts pauseRemaining).
//   - job.paused names the host paused during the job (directory or profile), else null.
//   - Outcome (directoryJobOutcome): a paused host -> 'failed' ('host_blocked'); a robots refusal before any page
//     -> 'skipped' ('robots_disallowed'); no page read and page errors -> 'failed' ('pages_failed'); otherwise
//     'succeeded'.
//   - With a deadline (ms on the deps clock), pages start only while they fit before it (directory.ts).

import type { Db } from '../db/postgrest';
import { PAGE_DELAY_MS, pauseMarker, type ScraperDeps } from './context';
import { scanDirectory, type DirectoryScanResult } from './directory';
import type { DirectorySource } from './parsers/directory';
import { scrapeProfile } from './profile';
import { markSavedSearchRun, upsertCompanies, writeScanLog } from './store';

export const ENRICH_MAX = 20;

export interface DirectoryJob {
  url: string;
  source: DirectorySource;
  maxPages: number;
  enrichProfiles: boolean;
  savedSearchId?: string;
  /** No page starts unless it fits before this time (ms on the deps clock). */
  deadline?: number;
}

export interface DirectoryJobResult {
  result: DirectoryScanResult;
  stored: number;
  enriched: number;
  /** Host paused during this job (directory or profile host), else null. */
  paused: string | null;
}

export interface DirectoryJobOutcome {
  status: 'succeeded' | 'failed' | 'skipped';
  error?: 'host_blocked' | 'robots_disallowed' | 'pages_failed';
}

/** Run outcome of a job (see the rules above). */
export function directoryJobOutcome(job: Pick<DirectoryJobResult, 'result' | 'paused'>): DirectoryJobOutcome {
  const r = job.result;
  if (job.paused) return { status: 'failed', error: 'host_blocked' };
  if (r.stopped === 'robots' && r.pages === 0) return { status: 'skipped', error: 'robots_disallowed' };
  if (r.pages === 0 && r.errors.length > 0) return { status: 'failed', error: 'pages_failed' };
  return { status: 'succeeded' };
}

const PROFILE_FIELDS = ['website_url', 'phone', 'email', 'description', 'employee_count', 'country', 'city', 'full_address'] as const;
const PROFILE_LIST_FIELDS = ['industry_tags', 'certifications', 'contact_persons'] as const;

interface EnrichResult {
  enriched: number;
  /** Host and profile URL of a pause that ended enrichment. */
  paused: { host: string; url: string } | null;
}

async function enrich(deps: ScraperDeps, db: Db, result: DirectoryScanResult, delayMs: number): Promise<EnrichResult> {
  const targets = result.companies.filter((c) => !c.website_url).slice(0, ENRICH_MAX);
  let enriched = 0;
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) await deps.sleep(delayMs);
    const company = targets[i];
    const scan = await scrapeProfile(deps, { url: company.source_url, source: result.source });
    if (!scan.ok) {
      if (scan.paused) return { enriched, paused: { host: scan.paused, url: company.source_url } };
      if (scan.body.error === 'robots_disallowed') break;
      continue;
    }
    const details = scan.body as unknown as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) if (details[field]) updates[field] = details[field];
    for (const field of PROFILE_LIST_FIELDS) if (Array.isArray(details[field]) && (details[field] as unknown[]).length) updates[field] = details[field];
    if (typeof details.company_name === 'string' && details.company_name && details.company_name !== 'Unknown') updates.company_name = details.company_name;
    if (Object.keys(updates).length === 0) continue;
    await db.update('company_leads', updates, { filters: [['source', 'eq', result.source], ['source_url', 'eq', company.source_url]] });
    enriched += 1;
  }
  return { enriched, paused: null };
}

/** Runs one job (see the rules above). */
export async function runDirectoryJob(deps: ScraperDeps, db: Db, job: DirectoryJob, now: () => Date): Promise<DirectoryJobResult> {
  const started = now();
  const result = await scanDirectory(deps, { url: job.url, source: job.source, maxPages: job.maxPages, deadline: job.deadline });
  const stored = result.companies.length > 0 ? await upsertCompanies(db, result.companies) : 0;
  const delay = Math.max(PAGE_DELAY_MS[job.source], (result.robots?.crawlDelayS ?? 0) * 1000);
  const enrichment: EnrichResult = job.enrichProfiles && stored > 0 && !result.paused ? await enrich(deps, db, result, delay) : { enriched: 0, paused: null };
  await writeScanLog(db, {
    scan_type: 'directory',
    source: job.source,
    keyword: result.keyword || null,
    url: job.url,
    ok: result.pages > 0,
    companies_found: result.companies.length,
    error_message: result.paused ? pauseMarker(result.paused) : (result.errors[0] ?? null),
    started_at: started,
    completed_at: now(),
  });
  if (enrichment.paused) {
    const at = now();
    await writeScanLog(db, {
      scan_type: 'profile',
      source: job.source,
      keyword: null,
      url: enrichment.paused.url,
      ok: false,
      companies_found: 0,
      error_message: pauseMarker(enrichment.paused.host),
      started_at: at,
      completed_at: at,
    });
  }
  if (job.savedSearchId) await markSavedSearchRun(db, job.savedSearchId, stored, now());
  return { result, stored, enriched: enrichment.enriched, paused: result.paused ?? enrichment.paused?.host ?? null };
}
