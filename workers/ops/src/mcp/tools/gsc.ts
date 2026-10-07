// Google Search Console tools, ported from mcp-server/src/index.ts:1719-2065. They call the module the Phase 2
// /api/gsc route uses in this Worker (api/_lib/gsc-client.js; the local server's gsc-client.ts mirrors it,
// mcp-server/src/gsc-client.ts:2-3), loaded on first use.

import { z } from 'zod';
import type { McpContext } from '../context';
import { buildFilterGroups, fmtGscRow, gscDateRange } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const fail = (e: unknown): ToolResult => ({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, isError: true });

export const gscSearchAnalytics = tool({
  name: 'gsc_search_analytics',
  description: 'Query Google Search Console Search Analytics. Returns clicks, impressions, CTR, position by dimension.',
  cls: 'R',
  stage: 's1',
  shape: {
    days: z.number().optional().default(28).describe('Number of days to look back (ending 3 days ago)'),
    dimensions: z.array(z.enum(['query', 'page', 'country', 'device', 'date', 'searchAppearance'])).optional().default(['query']),
    page_filter: z.string().optional().describe('Only rows whose page URL contains this string'),
    country_filter: z.string().optional().describe("3-letter country code (e.g. 'deu')"),
    device_filter: z.enum(['MOBILE', 'DESKTOP', 'TABLET']).optional(),
    query_filter: z.string().optional(),
    row_limit: z.number().optional().default(25),
  },
  async run({ days, dimensions, page_filter, country_filter, device_filter, query_filter, row_limit }, ctx) {
    try {
      const { startDate, endDate } = gscDateRange(days, ctx.deps.now());
      const gsc = await ctx.deps.gsc();
      const data = await gsc.searchAnalytics({
        startDate,
        endDate,
        dimensions,
        dimensionFilterGroups: buildFilterGroups({ page: page_filter, country: country_filter, device: device_filter, query: query_filter }),
        rowLimit: row_limit,
      });
      const rows = data.rows || [];
      if (rows.length === 0) return { text: `No results for ${startDate} -> ${endDate}` };
      return { text: `GSC Search Analytics ${startDate} -> ${endDate} (${rows.length} rows)\n\n${rows.map((r) => fmtGscRow(r, dimensions[0])).join('\n')}` };
    } catch (e) {
      return fail(e);
    }
  },
});

async function topRows(ctx: McpContext, o: { days: number; limit: number; dimension: 'query' | 'page'; page?: string; country?: string }): Promise<ToolResult> {
  const { startDate, endDate } = gscDateRange(o.days, ctx.deps.now());
  const gsc = await ctx.deps.gsc();
  const data = await gsc.searchAnalytics({ startDate, endDate, dimensions: [o.dimension], dimensionFilterGroups: buildFilterGroups({ page: o.page, country: o.country }), rowLimit: o.limit });
  const rows = data.rows || [];
  const label = o.dimension === 'query' ? 'queries' : 'pages';
  return { text: rows.length ? `Top ${rows.length} ${label} ${startDate} -> ${endDate}:\n\n${rows.map((r) => fmtGscRow(r, o.dimension)).join('\n')}` : `No ${label} found.` };
}

export const gscGetTopQueries = tool({
  name: 'gsc_get_top_queries',
  description: 'Shortcut: top search queries by clicks for the site over the last N days.',
  cls: 'R',
  stage: 's1',
  shape: { days: z.number().optional().default(28), limit: z.number().optional().default(20), page_filter: z.string().optional(), country_filter: z.string().optional() },
  async run({ days, limit, page_filter, country_filter }, ctx) {
    try {
      return await topRows(ctx, { days, limit, dimension: 'query', page: page_filter, country: country_filter });
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscGetTopPages = tool({
  name: 'gsc_get_top_pages',
  description: 'Shortcut: top landing pages by clicks for the site over the last N days.',
  cls: 'R',
  stage: 's1',
  shape: {
    days: z.number().optional().default(28),
    limit: z.number().optional().default(20),
    language: z.string().optional().describe("2-letter language code to filter URL prefix (e.g. 'de')"),
    country_filter: z.string().optional(),
  },
  async run({ days, limit, language, country_filter }, ctx) {
    try {
      return await topRows(ctx, { days, limit, dimension: 'page', page: language ? `/${language}/` : undefined, country: country_filter });
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscComparePeriods = tool({
  name: 'gsc_compare_periods',
  description: 'Compare GSC totals (clicks, impressions, CTR, position) between two equal-length periods.',
  cls: 'R',
  stage: 's1',
  shape: { days: z.number().optional().default(28).describe('Length of each period in days') },
  async run({ days }, ctx) {
    try {
      const { startDate: curStart, endDate: curEnd } = gscDateRange(days, ctx.deps.now());
      const prevEnd = new Date(curStart);
      prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
      const prevStart = new Date(prevEnd.getTime());
      prevStart.setUTCDate(prevStart.getUTCDate() - days);
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const gsc = await ctx.deps.gsc();
      const [cur, prev] = await Promise.all([
        gsc.searchAnalytics({ startDate: curStart, endDate: curEnd, dimensions: [], rowLimit: 1 }),
        gsc.searchAnalytics({ startDate: fmt(prevStart), endDate: fmt(prevEnd), dimensions: [], rowLimit: 1 }),
      ]);
      const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
      const c = (cur.rows?.[0] ?? zero) as typeof zero;
      const p = (prev.rows?.[0] ?? zero) as typeof zero;
      const delta = (a: number, b: number) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : '-');
      const text = [
        `GSC comparison (${days}-day window)`,
        `Current:  ${curStart} -> ${curEnd}`,
        `Previous: ${fmt(prevStart)} -> ${fmt(prevEnd)}`,
        '',
        `Clicks:       ${c.clicks} vs ${p.clicks}  (${delta(c.clicks, p.clicks)})`,
        `Impressions:  ${c.impressions} vs ${p.impressions}  (${delta(c.impressions, p.impressions)})`,
        `CTR:          ${(c.ctr * 100).toFixed(2)}% vs ${(p.ctr * 100).toFixed(2)}%`,
        `Avg position: ${c.position.toFixed(1)} vs ${p.position.toFixed(1)}`,
      ].join('\n');
      return { text };
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscInspectUrl = tool({
  name: 'gsc_inspect_url',
  description: 'Run URL Inspection API on a single URL. Returns indexing state, coverage, canonical, last crawl.',
  cls: 'R',
  stage: 's1',
  shape: { url: z.string().describe('Full URL including protocol'), language_code: z.string().optional().default('en-US') },
  async run({ url, language_code }, ctx) {
    try {
      const result = await (await ctx.deps.gsc()).inspectUrl(url, language_code);
      const idx = ((result as Record<string, unknown> | null)?.indexStatusResult ?? {}) as Record<string, string | undefined>;
      const text = [
        `URL: ${url}`,
        `Verdict: ${idx.verdict || '-'}`,
        `Coverage: ${idx.coverageState || '-'}`,
        `Indexing state: ${idx.indexingState || '-'}`,
        `Page fetch: ${idx.pageFetchState || '-'}`,
        `Robots.txt: ${idx.robotsTxtState || '-'}`,
        `Crawled as: ${idx.crawledAs || '-'}`,
        `Last crawl: ${idx.lastCrawlTime || '-'}`,
        `User canonical: ${idx.userCanonical || '-'}`,
        `Google canonical: ${idx.googleCanonical || '-'}`,
      ].join('\n');
      return { text };
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscGetUnindexedPages = tool({
  name: 'gsc_get_unindexed_pages',
  description: 'Return monitored URLs that do NOT have a PASS indexing state in the inspection cache. Useful to find pages to submit for indexing.',
  cls: 'R',
  stage: 's1',
  shape: { language: z.string().optional().describe('Filter by 2-letter language code'), limit: z.number().optional().default(50) },
  async run({ language, limit }, ctx) {
    const sb = ctx.sb();
    let q = sb.from('gsc_monitored_urls').select('url, label, language, service_type, priority').order('priority', { ascending: false }).limit(limit);
    if (language) q = q.eq('language', language);
    const { data: monitored, error } = await q;
    if (error) return { text: `Error: ${error.message}`, isError: true };
    if (!monitored || monitored.length === 0) return { text: 'No monitored URLs.' };
    const { data: cache } = await sb.from('gsc_inspection_cache').select('url, indexing_state, coverage_state, inspected_at').in('url', monitored.map((m: Record<string, string>) => m.url));
    const cacheMap = new Map<string, Record<string, string>>();
    for (const c of (cache || []) as Array<Record<string, string>>) cacheMap.set(c.url, c);
    const unindexed = (monitored as Array<Record<string, string>>).filter((m) => cacheMap.get(m.url)?.indexing_state !== 'PASS');
    if (unindexed.length === 0) return { text: 'All monitored URLs are indexed (PASS).' };
    const text = [
      `Found ${unindexed.length} unindexed / unknown URLs:\n`,
      ...unindexed.map((m) => {
        const c = cacheMap.get(m.url);
        return `  [${m.language || '-'}] ${m.url}\n    state: ${c?.indexing_state || 'not inspected'}  coverage: ${c?.coverage_state || '-'}`;
      }),
    ].join('\n');
    return { text };
  },
});

export const gscSubmitForIndexing = tool({
  name: 'gsc_submit_for_indexing',
  description: 'Submit one or more URLs to the Google Indexing API. Respects the 200/day quota and logs every attempt.',
  cls: 'X',
  stage: 'opt',
  shape: { urls: z.array(z.string()).describe('URLs to submit'), type: z.enum(['URL_UPDATED', 'URL_DELETED']).optional().default('URL_UPDATED') },
  async run({ urls, type }, ctx) {
    try {
      const { results, quota } = await (await ctx.deps.gsc()).submitBatchForIndexing(urls, type, ctx.actor);
      const ok = results.filter((r) => r.status === 'success').length;
      const skipped = results.filter((r) => r.status === 'skipped_quota').length;
      const errs = results.filter((r) => r.status === 'error');
      const text = [
        `Submitted ${ok}/${urls.length} URLs (quota ${quota.used}/${quota.limit})`,
        skipped ? `${skipped} skipped (daily quota reached)` : '',
        errs.length ? `${errs.length} errors:\n${errs.map((e) => `  ${e.url}: ${e.error}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
      return { text };
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscGetIndexingQuota = tool({
  name: 'gsc_get_indexing_quota',
  description: 'Return how many Indexing API submissions were used today (out of 200).',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    try {
      const { used, limit } = await (await ctx.deps.gsc()).getIndexingQuotaUsed();
      return { text: `Indexing quota today: ${used} / ${limit}  (${limit - used} remaining)` };
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscListSitemaps = tool({
  name: 'gsc_list_sitemaps',
  description: 'List all sitemaps submitted to Google Search Console for the site.',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    try {
      const sitemaps = await (await ctx.deps.gsc()).listSitemaps();
      if (sitemaps.length === 0) return { text: 'No sitemaps submitted.' };
      const text = sitemaps.map((s) => `  ${s.path}\n    type: ${s.type || 'sitemap'}  errors: ${s.errors || 0}  warnings: ${s.warnings || 0}  last: ${s.lastSubmitted || '-'}`).join('\n');
      return { text: `Found ${sitemaps.length} sitemaps:\n\n${text}` };
    } catch (e) {
      return fail(e);
    }
  },
});

export const gscSubmitSitemap = tool({
  name: 'gsc_submit_sitemap',
  description: 'Submit a sitemap URL to Google Search Console.',
  cls: 'X',
  stage: 'opt',
  idempotent: true,
  shape: { feedpath: z.string().describe('Full sitemap URL') },
  async run({ feedpath }, ctx) {
    try {
      await (await ctx.deps.gsc()).submitSitemap(feedpath);
      return { text: `Sitemap submitted: ${feedpath}` };
    } catch (e) {
      return fail(e);
    }
  },
});

export const GSC_TOOLS: readonly ToolDef[] = [
  gscSearchAnalytics, gscGetTopQueries, gscGetTopPages, gscComparePeriods, gscInspectUrl, gscGetUnindexedPages,
  gscSubmitForIndexing, gscGetIndexingQuota, gscListSitemaps, gscSubmitSitemap,
];
