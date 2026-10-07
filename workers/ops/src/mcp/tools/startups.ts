// Funded-startup tools, ported from mcp-server/src/index.ts:1480-1717. Change against the local server:
// trigger_funding_scan queues a 'funded-scan' job on the queue "scrapes" (priority 1-3) and answers at once; the
// api_base_url argument is dropped (the server never fetches a caller-supplied base URL).

import { z } from 'zod';
import { enqueueScrape } from '../../queues/messages';
import { formatFundedStartup } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const getFundedStartups = tool({
  name: 'get_funded_startups',
  description: 'Get recently funded European hardware startups. Filter by industry, country, funding stage, confidence score, and outreach status.',
  cls: 'R',
  stage: 's1',
  shape: {
    industry: z.string().optional().describe('Industry tag: robotics, medtech, automotive, aerospace, drones, cleantech, iot, defense, agritech, biotech, industrial, semiconductor, deeptech'),
    country: z.string().optional().describe('2-letter country code: DE, FR, NL, SE, ES, IT, BE, UK, etc.'),
    funding_stage: z.string().optional().describe('pre-seed, seed, series-a, series-b, series-c, grant'),
    outreach_status: z.enum(['new', 'researched', 'contacted', 'responded', 'not_relevant', 'all']).optional().default('all'),
    min_confidence: z.number().optional().default(0).describe('Minimum hardware confidence score 0-100'),
    min_amount_millions: z.number().optional().describe('Minimum funding amount in millions'),
    is_hardware_only: z.boolean().optional().default(false).describe('Only show startups classified as hardware'),
    days_back: z.number().optional().default(30),
    limit: z.number().optional().default(20),
  },
  async run({ industry, country, funding_stage, outreach_status, min_confidence, min_amount_millions, is_hardware_only, days_back, limit }, ctx) {
    const since = new Date(ctx.deps.now().getTime() - days_back * 86400 * 1000).toISOString();
    let query = ctx.sb()
      .from('funded_startups')
      .select('*')
      .gte('discovered_at', since)
      .gte('hardware_confidence', min_confidence)
      .order('discovered_at', { ascending: false })
      .limit(limit);
    if (industry) query = query.contains('industry_tags', [industry]);
    if (country) query = query.eq('country_code', country.toUpperCase());
    if (funding_stage) query = query.eq('funding_stage', funding_stage);
    if (outreach_status !== 'all') query = query.eq('outreach_status', outreach_status);
    if (is_hardware_only) query = query.eq('is_hardware', true);
    if (min_amount_millions) query = query.gte('funding_amount_millions', min_amount_millions);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No funded startups found matching the criteria.' };
    return { text: `Found ${data.length} funded startups:\n\n${data.map(formatFundedStartup).join('\n\n')}` };
  },
});

export const getFundedStartupDetail = tool({
  name: 'get_funded_startup_detail',
  description: 'Get full details of a specific funded startup including article excerpt, matched keywords, emails, and notes.',
  cls: 'R',
  stage: 's1',
  shape: { startup_id: z.string().describe('The funded startup UUID') },
  async run({ startup_id }, ctx) {
    const { data, error } = await ctx.sb().from('funded_startups').select('*').eq('id', startup_id).single();
    if (error || !data) return { text: `Startup not found: ${startup_id}` };
    const d = data as Record<string, any>;
    const text = [
      '=== FUNDED STARTUP DETAIL ===',
      `ID: ${d.id}`,
      `Company: ${d.company_name || 'Unknown'}`,
      `Country: ${d.country_code} | City: ${d.city || 'unknown'}`,
      '',
      '=== FUNDING ===',
      `Amount: ${d.funding_amount_millions ? `${d.funding_currency}${d.funding_amount_millions}M` : 'undisclosed'}`,
      `Stage: ${d.funding_stage || 'unknown'}`,
      `Investors: ${(d.investors || []).join(', ') || 'not listed'}`,
      '',
      '=== CLASSIFICATION ===',
      `Is hardware: ${d.is_hardware ? 'Yes' : 'No'}`,
      `Hardware confidence: ${d.hardware_confidence}/100`,
      `Industry tags: ${(d.industry_tags || []).join(', ') || 'none'}`,
      `Matched keywords: ${(d.matched_keywords || []).join(', ') || 'none'}`,
      '',
      '=== CONTACT INFO ===',
      `Website: ${d.company_website || 'not found'}`,
      `Emails: ${(d.scraped_emails || []).join(', ') || 'none scraped'}`,
      `Email scrape status: ${d.email_scrape_status}`,
      '',
      '=== OUTREACH ===',
      `Status: ${d.outreach_status}`,
      `Contacted at: ${d.contacted_at || 'not yet'}`,
      `Notes: ${d.notes || 'none'}`,
      '',
      '=== SOURCE ===',
      `Source: ${d.source_name}`,
      `URL: ${d.source_url}`,
      `Title: ${d.article_title}`,
      `Published: ${d.article_published_at || 'unknown'}`,
      `Discovered: ${d.discovered_at}`,
      d.article_excerpt ? `\nExcerpt: ${d.article_excerpt}` : '',
    ].join('\n');
    return { text };
  },
});

export const updateStartupOutreach = tool({
  name: 'update_startup_outreach',
  description: 'Update the outreach status and/or notes for a funded startup.',
  cls: 'W',
  stage: 'opt',
  idempotent: true,
  shape: {
    startup_id: z.string(),
    outreach_status: z.enum(['new', 'researched', 'contacted', 'responded', 'not_relevant']).optional(),
    notes: z.string().optional(),
    company_website: z.string().optional().describe('Add or update the company website URL'),
  },
  async run({ startup_id, outreach_status, notes, company_website }, ctx) {
    const now = ctx.deps.now().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (outreach_status) updates.outreach_status = outreach_status;
    if (notes) updates.notes = notes;
    if (company_website) updates.company_website = company_website;
    if (outreach_status === 'contacted') updates.contacted_at = now;
    if (Object.keys(updates).length === 1) return { text: 'No fields to update.' };
    const { error } = await ctx.sb().from('funded_startups').update(updates).eq('id', startup_id);
    if (error) return err(error.message);
    return { text: `Startup ${startup_id} updated.${outreach_status ? ` Status: ${outreach_status}` : ''}` };
  },
});

export const getFundingStats = tool({
  name: 'get_funding_stats',
  description: 'Get statistics on European hardware startup funding trends: by stage, country, industry, and outreach pipeline.',
  cls: 'R',
  stage: 's1',
  shape: { days_back: z.number().optional().default(30) },
  async run({ days_back }, ctx) {
    const since = new Date(ctx.deps.now().getTime() - days_back * 86400 * 1000).toISOString();
    const sb = ctx.sb();
    const [totalRes, periodRes, hwRes, stageRes, countryRes, outreachRes] = await Promise.all([
      sb.from('funded_startups').select('id', { count: 'exact', head: true }),
      sb.from('funded_startups').select('id', { count: 'exact', head: true }).gte('discovered_at', since),
      sb.from('funded_startups').select('id', { count: 'exact', head: true }).eq('is_hardware', true).gte('discovered_at', since),
      sb.from('funded_startups').select('funding_stage').gte('discovered_at', since),
      sb.from('funded_startups').select('country_code').eq('is_hardware', true).gte('discovered_at', since),
      sb.from('funded_startups').select('outreach_status').gte('discovered_at', since),
    ]);
    const tally = (rows: unknown, field: string, fallback: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of (rows || []) as Array<Record<string, string | null>>) {
        const k = r[field] || fallback;
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    };
    const byStage = tally(stageRes.data, 'funding_stage', 'unknown');
    const byCountry = tally(countryRes.data, 'country_code', 'EU');
    const byOutreach = tally(outreachRes.data, 'outreach_status', 'new');
    const text = [
      `FUNDED STARTUP STATS - Last ${days_back} Days`,
      '',
      `Total all time: ${totalRes.count || 0}`,
      `Period total: ${periodRes.count || 0}`,
      `Hardware companies: ${hwRes.count || 0}`,
      '',
      'BY STAGE:',
      ...Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([s, n]) => `  ${s}: ${n}`),
      '',
      'TOP HARDWARE COUNTRIES:',
      ...Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `  ${c}: ${n}`),
      '',
      'OUTREACH PIPELINE:',
      ...Object.entries(byOutreach).map(([o, n]) => `  ${o}: ${n}`),
      '',
      `Dashboard: ${ctx.env.SITE_ORIGIN}/dashboard/funded-startups`,
    ].join('\n');
    return { text };
  },
});

export const triggerFundingScan = tool({
  name: 'trigger_funding_scan',
  description: 'Trigger a live scan of European startup funding RSS feeds. Priority 1 scans the 3 main feeds (tech.eu, EU-Startups, TechCrunch). Priority 2 adds regional feeds.',
  cls: 'X',
  stage: 'opt',
  shape: { priority: z.number().optional().default(1).describe('Maximum feed priority to scan (1=P1 only, 2=P1+P2, 3=all)') },
  async run({ priority }, ctx) {
    if (!Number.isInteger(priority) || priority < 1 || priority > 3) return err('priority must be 1, 2 or 3');
    const runId = await enqueueScrape(ctx.env, 'funded-scan', { priority }, `${ctx.principal.class}:mcp`);
    return { text: `Funding scan queued (run_id ${runId}, priority ${priority}). New startups appear in get_funded_startups when the background run ends.` };
  },
});

export const STARTUP_TOOLS: readonly ToolDef[] = [getFundedStartups, getFundedStartupDetail, updateStartupOutreach, getFundingStats, triggerFundingScan];
