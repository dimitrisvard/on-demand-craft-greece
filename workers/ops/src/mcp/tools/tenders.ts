// Tender monitor tools, ported from mcp-server/src/index.ts:1147-1478. Changes against the local server:
//   - trigger_country_scan queues a 'tender-scan' job on the queue "scrapes" (the answer the local tool gets from
//     the ops route for machine callers); the country code must have a connector (routes/tender-scan.ts list).
//   - export_tenders_csv runs the ops /api/tenders handler in-process (GET ?export=csv) and returns at most 200 KB.
//   - Both drop the api_base_url argument: the server never fetches a caller-supplied base URL.

import { z } from 'zod';
import { countryCodeShapeAllowed } from '../../../../shared/src/auth/scrape-rules';
import { enqueueScrape } from '../../queues/messages';
import { TENDER_SCAN_COUNTRY_CODES } from '../../routes/tender-scan';
import { formatTender, isoDate, isoTime, truncateCsv } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

export const CSV_TEXT_LIMIT_BYTES = 200 * 1024;

const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const getTenders = tool({
  name: 'get_tenders',
  description: 'Get procurement tenders from EU national portals. Filter by country, CPV code, value range, deadline, relevance score.',
  cls: 'R',
  stage: 's1',
  shape: {
    country: z.string().optional().describe('ISO 2-letter country code: DE, FR, NL, IT, ES, PL, etc.'),
    cpv_prefix: z.string().optional().describe("CPV code category prefix, e.g. '42' for machinery, '44' for metal products"),
    min_value: z.number().optional().describe('Minimum estimated value in EUR'),
    max_value: z.number().optional().describe('Maximum estimated value in EUR'),
    min_score: z.number().optional().default(0).describe('Minimum relevance score (0-100)'),
    deadline_within_days: z.number().optional().describe('Only show tenders with deadline within N days'),
    status: z.enum(['new', 'reviewed', 'interested', 'bidding', 'won', 'lost', 'expired', 'not_relevant', 'all']).optional().default('all'),
    relevant_only: z.boolean().optional().default(false),
    search: z.string().optional().describe('Text search across title, description, buyer name'),
    limit: z.number().optional().default(20),
  },
  async run({ country, cpv_prefix, min_value, max_value, min_score, deadline_within_days, status, relevant_only, search, limit }, ctx) {
    let query = ctx.sb().from('tenders').select('*').order('relevance_score', { ascending: false }).limit(limit);
    if (country) query = query.eq('country_code', country.toUpperCase());
    if (status && status !== 'all') query = query.eq('status', status);
    if (relevant_only) query = query.eq('is_relevant', true);
    if (min_score && min_score > 0) query = query.gte('relevance_score', min_score);
    if (min_value) query = query.gte('estimated_value_eur', min_value);
    if (max_value) query = query.lte('estimated_value_eur', max_value);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,buyer_name.ilike.%${search}%`);
    if (deadline_within_days) {
      const now = ctx.deps.now();
      const future = new Date(now.getTime() + deadline_within_days * 86400000).toISOString();
      query = query.gte('submission_deadline', now.toISOString()).lte('submission_deadline', future);
    }
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No tenders found.' };
    const filtered = cpv_prefix ? data.filter((t: Record<string, any>) => (t.cpv_codes || []).some((c: string) => String(c).startsWith(cpv_prefix))) : data;
    return { text: `Found ${filtered.length} tenders:\n\n${filtered.map(formatTender).join('\n\n')}` };
  },
});

export const getTenderDetail = tool({
  name: 'get_tender_detail',
  description: 'Get full details of a specific tender by its UUID.',
  cls: 'R',
  stage: 's1',
  shape: { tender_id: z.string().describe('Tender UUID or short ID prefix (8 chars)') },
  async run({ tender_id }, ctx) {
    let query = ctx.sb().from('tenders').select('*');
    query = tender_id.length === 36 ? query.eq('id', tender_id) : query.ilike('id', `${tender_id}%`);
    const { data, error } = await query.limit(1).single();
    if (error || !data) return { text: `Tender not found: ${tender_id}` };
    const t = data as Record<string, any>;
    const text = [
      '=== TENDER DETAIL ===',
      `ID: ${t.id}`,
      `Country: ${t.country_name} (${t.country_code})`,
      `Portal: ${t.portal_name}`,
      `Reference: ${t.tender_reference || 'N/A'}`,
      `Title: ${t.title}`,
      `Buyer: ${t.buyer_name || 'N/A'} (${t.buyer_type || 'N/A'})`,
      '',
      `CPV Codes: ${(t.cpv_codes || []).join(', ') || 'N/A'}`,
      `Nature: ${t.nature_of_contract || 'N/A'}`,
      `Procedure: ${t.procedure_type || 'N/A'}`,
      '',
      `Value: EUR ${t.estimated_value_eur ? Math.round(t.estimated_value_eur).toLocaleString('en-GB') : 'N/A'}`,
      `Currency: ${t.currency || 'EUR'}`,
      '',
      `Published: ${isoDate(t.publication_date)}`,
      `Deadline: ${isoTime(t.submission_deadline, 'N/A')}`,
      `Place: ${t.place_of_performance || 'N/A'} (NUTS: ${t.nuts_code || 'N/A'})`,
      '',
      `Relevance Score: ${t.relevance_score}/100`,
      `Is Relevant: ${t.is_relevant}`,
      `Matched Keywords: ${(t.matched_keywords || []).join(', ') || 'none'}`,
      `Matched CPV: ${(t.matched_cpv || []).join(', ') || 'none'}`,
      '',
      `Status: ${t.status}`,
      t.notes ? `Notes: ${t.notes}` : '',
      `Discovered: ${isoTime(t.discovered_at)}`,
      '',
      t.description ? `=== DESCRIPTION ===\n${String(t.description).substring(0, 800)}` : '',
      t.portal_url ? `\nPortal Link: ${t.portal_url}` : '',
    ].filter(Boolean).join('\n');
    return { text };
  },
});

export const updateTenderStatus = tool({
  name: 'update_tender_status',
  description: 'Update the status of a tender (new, reviewed, interested, bidding, won, lost, expired, not_relevant) and optionally add notes.',
  cls: 'W',
  stage: 's2',
  idempotent: true,
  shape: {
    tender_id: z.string().describe('Tender UUID or short 8-char prefix'),
    status: z.enum(['new', 'reviewed', 'interested', 'bidding', 'won', 'lost', 'expired', 'not_relevant']),
    notes: z.string().optional(),
  },
  async run({ tender_id, status, notes }, ctx) {
    const sb = ctx.sb();
    const updates: Record<string, unknown> = { status };
    if (notes !== undefined) updates.notes = notes;
    if (tender_id.length === 36) {
      const { error } = await sb.from('tenders').update(updates).eq('id', tender_id);
      if (error) return err(error.message);
    } else {
      const { data } = await sb.from('tenders').select('id').ilike('id', `${tender_id}%`).limit(1).single();
      if (!data) return { text: `Tender not found: ${tender_id}` };
      const { error } = await sb.from('tenders').update(updates).eq('id', data.id);
      if (error) return err(error.message);
    }
    return { text: `Tender ${tender_id} status updated to "${status}"${notes ? ' with notes' : ''}.` };
  },
});

export const getTenderStats = tool({
  name: 'get_tender_stats',
  description: 'Get tender statistics: counts by country, by status, trends, high-score tenders.',
  cls: 'R',
  stage: 's1',
  shape: { days_back: z.number().optional().default(30) },
  async run({ days_back }, ctx) {
    const sb = ctx.sb();
    const since = new Date(ctx.deps.now().getTime() - days_back * 86400000).toISOString();
    const [{ count: total }, { count: relevant }, { count: recent }, { data: byCountry }, { data: highScore }] = await Promise.all([
      sb.from('tenders').select('*', { count: 'exact', head: true }),
      sb.from('tenders').select('*', { count: 'exact', head: true }).eq('is_relevant', true),
      sb.from('tenders').select('*', { count: 'exact', head: true }).gte('discovered_at', since),
      sb.from('tenders').select('country_code, country_name').eq('is_relevant', true),
      sb.from('tenders').select('id, country_code, title, relevance_score, submission_deadline').gte('relevance_score', 70).eq('status', 'new').order('relevance_score', { ascending: false }).limit(5),
    ]);
    const countryMap: Record<string, number> = {};
    for (const t of (byCountry || []) as Array<Record<string, string>>) countryMap[t.country_code] = (countryMap[t.country_code] || 0) + 1;
    const topCountries = Object.entries(countryMap).sort(([, a], [, b]) => b - a).slice(0, 10).map(([cc, n]) => `  ${cc}: ${n}`).join('\n');
    const topTenders = ((highScore || []) as Array<Record<string, any>>).map((t) => `  [${t.relevance_score}] ${t.country_code}: ${String(t.title).substring(0, 60)}`).join('\n');
    return {
      text: `=== TENDER STATISTICS ===\n\nTotal: ${total || 0}\nRelevant: ${relevant || 0}\nLast ${days_back} days: ${recent || 0}\n\nTop countries (relevant):\n${topCountries || '  None'}\n\nTop unreviewed (score 70+):\n${topTenders || '  None'}`,
    };
  },
});

export const searchTenders = tool({
  name: 'search_tenders',
  description: 'Full-text search across tender titles, descriptions, and buyer names.',
  cls: 'R',
  stage: 's1',
  shape: { query: z.string().describe('Search text'), limit: z.number().optional().default(20), min_score: z.number().optional().default(0) },
  async run({ query: searchQuery, limit, min_score }, ctx) {
    const { data, error } = await ctx.sb()
      .from('tenders')
      .select('*')
      .or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,buyer_name.ilike.%${searchQuery}%`)
      .gte('relevance_score', min_score)
      .order('relevance_score', { ascending: false })
      .limit(limit);
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: `No tenders matching "${searchQuery}".` };
    return { text: `Found ${data.length} tenders for "${searchQuery}":\n\n${data.map(formatTender).join('\n\n')}` };
  },
});

export const getConnectorStatus = tool({
  name: 'get_connector_status',
  description: 'Check the status of all country connectors — last scan time, errors, active/inactive.',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    const { data, error } = await ctx.sb()
      .from('tender_connectors')
      .select('country_code, country_name, portal_name, access_method, is_active, last_scan_at, last_scan_count, last_error, scan_frequency_hours')
      .order('country_code');
    if (error) return err(error.message);
    const now = ctx.deps.now().getTime();
    const lines = ((data || []) as Array<Record<string, any>>).map((c) => {
      const hoursSince = c.last_scan_at ? Math.round((now - new Date(c.last_scan_at).getTime()) / 3600000) : null;
      const health = !c.is_active ? 'inactive' : !c.last_scan_at ? 'never scanned' : c.last_error ? 'error' : 'ok';
      return `[${health}] ${c.country_code} - ${c.portal_name} | ${hoursSince !== null ? `${hoursSince}h ago` : 'never'} | ${c.last_scan_count || 0} found${c.last_error ? ` | ERR: ${String(c.last_error).substring(0, 60)}` : ''}`;
    });
    return { text: `=== CONNECTOR STATUS ===\n\n${lines.join('\n')}` };
  },
});

export const triggerCountryScan = tool({
  name: 'trigger_country_scan',
  description: 'Manually trigger a scan for a specific country connector to fetch new tenders.',
  cls: 'X',
  stage: 's2',
  shape: { country_code: z.string().describe('ISO 2-letter country code, e.g. DE, FR, NL') },
  async run({ country_code }, ctx) {
    if (!countryCodeShapeAllowed(country_code)) return err(`No connector for country: ${country_code}`);
    const code = country_code.toUpperCase();
    if (!TENDER_SCAN_COUNTRY_CODES.includes(code)) return err(`No connector for country: ${code}`);
    const runId = await enqueueScrape(ctx.env, 'tender-scan', { country_code: code }, `${ctx.principal.class}:mcp`);
    return { text: `Scan for ${code} queued (run_id ${runId}). The counts arrive with the background run; check get_connector_status or the tender list later.` };
  },
});

export const exportTendersCsv = tool({
  name: 'export_tenders_csv',
  description: 'Export filtered tenders as CSV text (first 200 KB; narrow the filters for larger sets).',
  cls: 'R',
  stage: 's1',
  maxBytes: CSV_TEXT_LIMIT_BYTES + 1024,
  shape: { country: z.string().optional(), min_score: z.number().optional(), status: z.string().optional(), relevant_only: z.boolean().optional() },
  async run({ country, min_score, status, relevant_only }, ctx) {
    const params = new URLSearchParams();
    params.set('export', 'csv');
    if (country) params.set('country', country);
    if (min_score) params.set('min_score', String(min_score));
    if (status) params.set('status', status);
    if (relevant_only) params.set('relevant_only', 'true');
    const resp = await ctx.deps.inprocess(ctx, { endpoint: 'tenders', action: 'list', functionUrl: `/api/tenders?${params.toString()}`, method: 'GET', headers: { Accept: 'text/csv' } });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return err(`CSV export failed: HTTP ${resp.status} - ${text.substring(0, 200)}`);
    }
    const out = truncateCsv(await resp.text(), CSV_TEXT_LIMIT_BYTES);
    const note = out.truncated
      ? `\n\n[Truncated: first ${out.keptRows} of ${out.totalRows} tenders shown (${Math.round(CSV_TEXT_LIMIT_BYTES / 1024)} KB of ${Math.ceil(out.totalBytes / 1024)} KB). Narrow the filters (country, min_score, status, relevant_only) to get the rest.]`
      : `\n\n[${out.totalRows} tenders]`;
    return { text: `${out.text}${note}` };
  },
});

export const TENDER_TOOLS: readonly ToolDef[] = [getTenders, getTenderDetail, updateTenderStatus, getTenderStats, searchTenders, getConnectorStatus, triggerCountryScan, exportTendersCsv];
