// Company directory tools, ported from mcp-server/src/index.ts:618-980. Changes against the local server:
//   - scan_directory runs the scraper module in-process (robots gate, crawler identity, page delays, host pause):
//     up to 3 pages in the call, more pages queued as a directory-scan job; the URL must be a directory host.
//   - scan_directory and run_saved_search start a scan only while flag agent.growth.scrapers is on (the owner's
//     switch for every scraper path; the queue consumer checks it again); otherwise they answer an error and
//     open no run.
//   - enrich_company_emails calls the ops /api/scrape-website handler in-process, at most 10 companies per call,
//     at most 6 at once (shared limiter); every website URL must pass the shared scrape rules first.
//   - get_saved_searches and run_saved_search use the live saved_searches columns (uuid id, result_count;
//     no max_pages or last_run_count); run_saved_search queues a directory-scan job of 3 pages.
//   - Lists mask e-mail addresses.

import { z } from 'zod';
import { directoryTargetAllowed, scrapeUrlsAllowed } from '../../../../shared/src/auth/scrape-rules';
import { mapLimit } from '../../../../shared/src/limit';
import { readFlag } from '../../agents/flags';
import { EMPTY_USAGE, closeRun, openRun } from '../../agents/runs';
import { sendDirectoryScan } from '../../queues/directory-scan';
import { MAX_PAGES } from '../../scrapers/context';
import { runDirectoryJob } from '../../scrapers/service';
import type { McpContext } from '../context';
import { isoDate, maskEmail } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

/** Pages scanned inside the tool call; more are queued. */
export const SYNC_PAGES_MAX = 3;
/** Companies one enrich_company_emails call may scrape. */
export const ENRICH_CALL_MAX = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const SCRAPERS_OFF_MESSAGE = 'directory scans are off (flag agent.growth.scrapers)';

/** True while flag agent.growth.scrapers is on (read fail closed). */
async function scrapersOn(ctx: McpContext): Promise<boolean> {
  return (await readFlag(ctx.env, 'agent.growth.scrapers', ctx.tenantId)).enabled;
}

function sourceOf(url: string): 'europages' | 'wlw' | 'unknown' {
  const lower = url.toLowerCase();
  return lower.includes('europages') ? 'europages' : lower.includes('wlw.') ? 'wlw' : 'unknown';
}

/** Opens the growth.scrapers run of a scan requested over MCP. */
async function openScanRun(ctx: McpContext, savedSearchId?: string): Promise<string> {
  const opened = await openRun(ctx.ports().db, {
    agent: 'growth.scrapers',
    trigger: 'mcp',
    idempotency_key: `directory-scan:${crypto.randomUUID()}`,
    ...(savedSearchId ? { subject_type: 'saved_search', subject_id: savedSearchId } : {}),
    tenant_id: ctx.tenantId,
  });
  return opened.run_id;
}

export const scanDirectory = tool({
  name: 'scan_directory',
  description: 'Scan Europages or wlw for companies matching a search URL. Returns a list of discovered companies and stores them in the database.',
  cls: 'X',
  stage: 'opt',
  shape: {
    url: z.string().describe('Search results URL from Europages (e.g. https://www.europages.co.uk/companies/germany/robotics.html) or wlw (e.g. https://www.wlw.com/en/search/robotics/country/germany)'),
    maxPages: z.number().optional().default(3).describe('Maximum number of result pages to scan (default 3)'),
    enrichProfiles: z.boolean().optional().default(false).describe('Visit each company profile to get website URL and contact details (slower but more data)'),
  },
  async run({ url, maxPages, enrichProfiles }, ctx) {
    const source = sourceOf(url);
    if (source === 'unknown') return err('URL not recognized. Supported: europages.co.uk/de/fr/etc, wlw.com/de');
    if (!directoryTargetAllowed(url)) return err('url_not_allowed: only Europages and wlw search URLs can be scanned');
    const pages = Math.max(1, Math.min(MAX_PAGES, Math.floor(maxPages) || 1));
    if (!(await scrapersOn(ctx))) return err(SCRAPERS_OFF_MESSAGE);
    const runId = await openScanRun(ctx);

    if (pages > SYNC_PAGES_MAX) {
      await sendDirectoryScan(ctx.env, { params: { url, source, max_pages: pages, enrich_profiles: enrichProfiles }, run_id: runId, requested_by: `${ctx.principal.class}:mcp` });
      return { text: `Directory scan queued (run_id ${runId}): ${source.toUpperCase()}, up to ${pages} pages. The companies appear in get_companies when the background run ends.` };
    }

    const scraper = ctx.scraper();
    const db = ctx.ports().db;
    const job = await runDirectoryJob(scraper, db, { url, source, maxPages: pages, enrichProfiles: false }, ctx.deps.now);
    const r = job.result;
    const status = r.stopped === 'robots' && r.pages === 0 ? 'skipped' : r.paused ? 'failed' : 'succeeded';
    await closeRun(db, runId, {
      status,
      error: status === 'skipped' ? 'robots_disallowed' : status === 'failed' ? 'host_blocked' : undefined,
      output: { source, pages: r.pages, companies_found: r.companies.length, stored: job.stored, stopped: r.stopped, robots: r.robots?.reason ?? null, ...(r.robots?.permission ? { permission: r.robots.permission } : {}) },
    }, { ...EMPTY_USAGE, by_step: {} });
    const text = [
      'Directory scan complete',
      `Source: ${source.toUpperCase()}`,
      `URL: ${url}`,
      `Pages scanned: ${r.pages} of up to ${pages}`,
      `Companies found: ${r.companies.length}`,
      `Companies stored: ${job.stored}`,
      enrichProfiles ? 'Note: Profile enrichment requested - run enrich_company_emails separately for website scraping.' : '',
      r.errors.length > 0 ? `\nErrors:\n${r.errors.join('\n')}` : '',
      r.stopped === 'robots' ? 'The directory\'s robots.txt does not allow this crawler on these pages, and no permission for the host is recorded.' : '',
    ].filter(Boolean).join('\n');
    return { text, isError: status !== 'succeeded' ? true : undefined };
  },
});

export const getCompanies = tool({
  name: 'get_companies',
  description: 'Get companies from the directory scanner database. Filter by source, country, email status, or outreach status.',
  cls: 'R',
  stage: 's1',
  shape: {
    source: z.enum(['europages', 'wlw', 'all']).optional().default('all'),
    country: z.string().optional().describe('Filter by country (partial match)'),
    outreach_status: z.enum(['new', 'email_found', 'contacted', 'responded', 'converted', 'not_relevant', 'all']).optional().default('all'),
    email_status: z.enum(['pending', 'scraped', 'no_emails', 'failed', 'all']).optional().default('all'),
    search: z.string().optional().describe('Search by company name'),
    limit: z.number().optional().default(20),
  },
  async run({ source, country, outreach_status, email_status, search, limit }, ctx) {
    let query = ctx.sb().from('company_leads').select('*').order('created_at', { ascending: false }).limit(limit);
    if (source !== 'all') query = query.eq('source', source);
    if (outreach_status !== 'all') query = query.eq('outreach_status', outreach_status);
    if (email_status !== 'all') query = query.eq('email_scrape_status', email_status);
    if (country) query = query.ilike('country', `%${country}%`);
    if (search) query = query.ilike('company_name', `%${search}%`);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No companies found matching the criteria.' };
    const formatted = data.map((c: Record<string, any>) => [
      `${c.company_name} [${String(c.source).toUpperCase()}]`,
      `   Location: ${[c.city, c.country].filter(Boolean).join(', ') || 'Location unknown'}`,
      c.website_url ? `   Website: ${c.website_url}` : '',
      c.scraped_emails?.length ? `   E-mail: ${c.scraped_emails.map(maskEmail).join(', ')}` : c.email ? `   E-mail: ${maskEmail(c.email)} (directory)` : '',
      c.phone ? `   Phone: ${c.phone}` : '',
      c.employee_count ? `   Employees: ${c.employee_count}` : '',
      `   Status: ${c.outreach_status} | Email: ${c.email_scrape_status}`,
      `   ID: ${c.id}`,
    ].filter(Boolean).join('\n')).join('\n\n');
    return { text: `Found ${data.length} companies:\n\n${formatted}` };
  },
});

export const enrichCompanyEmails = tool({
  name: 'enrich_company_emails',
  description: 'Trigger email scraping for companies that have a website URL but no emails yet. Uses the existing website email scraper.',
  cls: 'X',
  stage: 'opt',
  shape: {
    company_ids: z.array(z.string()).optional().describe('Specific company IDs to enrich'),
    country: z.string().optional().describe('Enrich all pending companies from this country'),
    limit: z.number().optional().default(10).describe('Max companies to enrich (default 10)'),
  },
  async run({ company_ids, country, limit }, ctx) {
    const sb = ctx.sb();
    const cap = Math.max(1, Math.min(ENRICH_CALL_MAX, Math.floor(limit) || 1));
    let query = sb.from('company_leads').select('id, company_name, website_url').not('website_url', 'is', null).eq('email_scrape_status', 'pending').limit(cap);
    if (company_ids && company_ids.length > 0) {
      query = sb.from('company_leads').select('id, company_name, website_url').in('id', company_ids.slice(0, ENRICH_CALL_MAX)).not('website_url', 'is', null);
    } else if (country) {
      query = query.ilike('country', `%${country}%`);
    }
    const { data: found, error } = await query;
    if (error) return err(`Error fetching companies: ${error.message}`);
    const toEnrich = (found || []).slice(0, cap) as Array<{ id: string; company_name: string; website_url: string }>;
    if (toEnrich.length === 0) return { text: 'No companies found to enrich (need website_url + pending status).' };

    const siteOrigin = ctx.env.SITE_ORIGIN;
    const results = await mapLimit(toEnrich, 6, async (company): Promise<string> => {
      if (!scrapeUrlsAllowed([company.website_url], { siteOrigin })) return `${company.company_name}: website not allowed by the scrape rules, skipped`;
      try {
        const resp = await ctx.deps.inprocess(ctx, { endpoint: 'scrape-website', action: 'post', functionUrl: '/api/scrape-website', method: 'POST', body: { urls: [company.website_url] } });
        if (resp.ok) {
          const data = (await resp.json()) as { results?: Array<{ emails?: string[] }> };
          const emails = data.results?.[0]?.emails || [];
          const updates: Record<string, unknown> = {
            scraped_emails: emails,
            email_scrape_status: emails.length > 0 ? 'scraped' : 'no_emails',
            email_scraped_at: ctx.deps.now().toISOString(),
          };
          if (emails.length > 0) updates.outreach_status = 'email_found';
          await sb.from('company_leads').update(updates).eq('id', company.id);
          return `${company.company_name}: ${emails.length > 0 ? emails.map(maskEmail).join(', ') : 'no emails found'}`;
        }
        await sb.from('company_leads').update({ email_scrape_status: 'failed' }).eq('id', company.id);
        return `${company.company_name}: scraper returned ${resp.status}`;
      } catch (e) {
        await sb.from('company_leads').update({ email_scrape_status: 'failed' }).eq('id', company.id);
        return `${company.company_name}: ${e instanceof Error ? e.message : 'failed'}`;
      }
    });
    return { text: `Email enrichment complete for ${toEnrich.length} companies:\n\n${results.join('\n')}` };
  },
});

export const updateCompany = tool({
  name: 'update_company',
  description: "Update a company lead's outreach status or add notes.",
  cls: 'W',
  stage: 'opt',
  idempotent: true,
  shape: {
    company_id: z.string().describe('Company UUID'),
    outreach_status: z.enum(['new', 'email_found', 'contacted', 'responded', 'converted', 'not_relevant']).optional(),
    notes: z.string().optional().describe('Notes to add/replace'),
  },
  async run({ company_id, outreach_status, notes }, ctx) {
    const now = ctx.deps.now().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (outreach_status) updates.outreach_status = outreach_status;
    if (notes) updates.outreach_notes = notes;
    if (outreach_status === 'contacted') updates.contacted_at = now;
    const { error } = await ctx.sb().from('company_leads').update(updates).eq('id', company_id);
    if (error) return err(error.message);
    return { text: `Company ${company_id} updated${outreach_status ? ` - status: ${outreach_status}` : ''}${notes ? ' - notes saved' : ''}` };
  },
});

export const getSavedSearches = tool({
  name: 'get_saved_searches',
  description: 'List all saved directory search configurations.',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    const { data, error } = await ctx.sb().from('saved_searches').select('*').order('created_at', { ascending: false });
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No saved searches found.' };
    const formatted = data.map((s: Record<string, any>) => [
      `[${s.id}] ${s.name}`,
      `   Source: ${String(s.source).toUpperCase()} | Keyword: ${s.keyword || '-'} | Country: ${s.country || '-'}`,
      `   Active: ${s.is_active === false ? 'no' : 'yes'}`,
      `   Last run: ${isoDate(s.last_run_at, 'never')} | Found: ${s.result_count || 0}`,
      `   URL: ${s.search_url}`,
    ].join('\n')).join('\n\n');
    return { text: `SAVED SEARCHES (${data.length}):\n\n${formatted}` };
  },
});

export const runSavedSearch = tool({
  name: 'run_saved_search',
  description: 'Re-run a saved search to find new companies.',
  cls: 'X',
  stage: 's2',
  shape: { saved_search_id: z.string().describe('The saved search ID from get_saved_searches') },
  async run({ saved_search_id }, ctx) {
    if (!UUID_RE.test(saved_search_id)) return { text: `Saved search not found: ${saved_search_id}` };
    const { data: ss, error } = await ctx.sb().from('saved_searches').select('*').eq('id', saved_search_id).single();
    if (error || !ss) return { text: `Saved search not found: ${saved_search_id}` };
    const source = ss.source === 'wlw' ? 'wlw' : ss.source === 'europages' ? 'europages' : null;
    if (!source || typeof ss.search_url !== 'string' || !directoryTargetAllowed(ss.search_url)) return err('the saved search URL is not a Europages or wlw search URL');
    if (!(await scrapersOn(ctx))) return err(SCRAPERS_OFF_MESSAGE);
    const runId = await openScanRun(ctx, saved_search_id);
    await sendDirectoryScan(ctx.env, {
      params: { url: ss.search_url, source, max_pages: SYNC_PAGES_MAX, enrich_profiles: false, saved_search_id },
      run_id: runId,
      requested_by: `${ctx.principal.class}:mcp`,
    });
    return { text: `Saved search "${ss.name}" queued (run_id ${runId}, up to ${SYNC_PAGES_MAX} pages). Results arrive in get_companies and in the saved search's result count when the background run ends.` };
  },
});

export const COMPANY_TOOLS: readonly ToolDef[] = [scanDirectory, getCompanies, enrichCompanyEmails, updateCompany, getSavedSearches, runSavedSearch];
