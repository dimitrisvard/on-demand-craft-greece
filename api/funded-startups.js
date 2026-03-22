/**
 * Funded Startups API
 *
 * GET  /api/funded-startups          — Query funded startups with filters
 * GET  /api/funded-startups?action=stats  — Get statistics
 * GET  /api/funded-startups?action=feeds  — Get feed health status
 * PATCH /api/funded-startups         — Update outreach status, notes, website
 * GET  /api/funded-startups?action=export — CSV export
 */

import { createClient } from '@supabase/supabase-js';

// ─── CORS ────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

// ─── Supabase ─────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const PAGE_SIZE = 30;

// ─── Main handler ─────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ──
  if (req.method === 'GET') {
    const { action, id } = req.query;

    if (action === 'stats') return handleStats(req, res);
    if (action === 'feeds') return handleFeeds(req, res);
    if (action === 'export') return handleExport(req, res);
    if (id) return handleGetOne(req, res, id);
    return handleList(req, res);
  }

  // ── PATCH ──
  if (req.method === 'PATCH') return handlePatch(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── List funded startups ─────────────────────────────────────
async function handleList(req, res) {
  const {
    industry,
    country,
    stage,
    outreach_status,
    min_confidence = '0',
    min_amount,
    is_hardware,
    days_back = '30',
    page = '0',
    search,
    source,
  } = req.query;

  const offset = parseInt(page, 10) * PAGE_SIZE;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  let query = supabase
    .from('funded_startups')
    .select('*', { count: 'exact' })
    .gte('discovered_at', since)
    .gte('hardware_confidence', parseInt(min_confidence, 10))
    .order('discovered_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (industry) query = query.contains('industry_tags', [industry]);
  if (country && country !== 'all') query = query.eq('country_code', country);
  if (stage && stage !== 'all') query = query.eq('funding_stage', stage);
  if (outreach_status && outreach_status !== 'all') query = query.eq('outreach_status', outreach_status);
  if (is_hardware === 'true') query = query.eq('is_hardware', true);
  if (min_amount) query = query.gte('funding_amount_millions', parseFloat(min_amount));
  if (source && source !== 'all') query = query.eq('source_name', source);
  if (search) query = query.or(`article_title.ilike.%${search}%,company_name.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ data: data || [], count: count || 0, page: parseInt(page, 10), page_size: PAGE_SIZE });
}

// ─── Get single startup ───────────────────────────────────────
async function handleGetOne(req, res, id) {
  const { data, error } = await supabase
    .from('funded_startups')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  return res.status(200).json(data);
}

// ─── Patch (update status / notes / website) ─────────────────
async function handlePatch(req, res) {
  const { id, outreach_status, notes, company_website, scraped_emails, email_scrape_status } = req.body || {};

  if (!id) return res.status(400).json({ error: 'id is required' });

  const updates = {};
  if (outreach_status !== undefined) updates.outreach_status = outreach_status;
  if (notes !== undefined) updates.notes = notes;
  if (company_website !== undefined) updates.company_website = company_website;
  if (scraped_emails !== undefined) updates.scraped_emails = scraped_emails;
  if (email_scrape_status !== undefined) updates.email_scrape_status = email_scrape_status;
  if (outreach_status === 'contacted') updates.contacted_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabase
    .from('funded_startups')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}

// ─── Stats ────────────────────────────────────────────────────
async function handleStats(req, res) {
  const { days_back = '30' } = req.query;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  const [totalRes, periodRes, hardwareRes, stagedRes, countryRes, outreachRes] = await Promise.all([
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }),
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }).gte('discovered_at', since),
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }).eq('is_hardware', true).gte('discovered_at', since),
    supabase.from('funded_startups').select('funding_stage').gte('discovered_at', since),
    supabase.from('funded_startups').select('country_code').eq('is_hardware', true).gte('discovered_at', since),
    supabase.from('funded_startups').select('outreach_status').gte('discovered_at', since),
  ]);

  // Daily volume (last 14 days)
  const last14 = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const { data: dailyData } = await supabase
    .from('funded_startups')
    .select('discovered_at')
    .gte('discovered_at', last14)
    .order('discovered_at', { ascending: true });

  const daily_volume = {};
  (dailyData || []).forEach(r => {
    const day = r.discovered_at.substring(0, 10);
    daily_volume[day] = (daily_volume[day] || 0) + 1;
  });

  // Aggregate by_stage
  const by_stage = {};
  (stagedRes.data || []).forEach(r => {
    const s = r.funding_stage || 'unknown';
    by_stage[s] = (by_stage[s] || 0) + 1;
  });

  // Aggregate by_country
  const by_country = {};
  (countryRes.data || []).forEach(r => {
    const c = r.country_code || 'EU';
    by_country[c] = (by_country[c] || 0) + 1;
  });

  // Aggregate by_outreach
  const by_outreach = {};
  (outreachRes.data || []).forEach(r => {
    const o = r.outreach_status || 'new';
    by_outreach[o] = (by_outreach[o] || 0) + 1;
  });

  return res.status(200).json({
    total_all_time: totalRes.count || 0,
    period_days: parseInt(days_back, 10),
    period_total: periodRes.count || 0,
    period_hardware: hardwareRes.count || 0,
    by_stage,
    by_country,
    by_outreach,
    daily_volume,
  });
}

// ─── Feed health ──────────────────────────────────────────────
async function handleFeeds(req, res) {
  const { data, error } = await supabase
    .from('funding_feeds')
    .select('id, name, feed_url, language, priority, is_active, last_fetched_at, last_item_count, error_count, last_error')
    .order('priority', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data || []);
}

// ─── CSV Export ───────────────────────────────────────────────
async function handleExport(req, res) {
  const { days_back = '30', is_hardware } = req.query;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  let query = supabase
    .from('funded_startups')
    .select('company_name, country_code, funding_stage, funding_amount_millions, funding_currency, industry_tags, hardware_confidence, outreach_status, company_website, scraped_emails, article_title, source_name, source_url, discovered_at, notes')
    .gte('discovered_at', since)
    .order('discovered_at', { ascending: false })
    .limit(1000);

  if (is_hardware === 'true') query = query.eq('is_hardware', true);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const headers = [
    'company_name', 'country_code', 'funding_stage', 'funding_amount_millions',
    'funding_currency', 'industry_tags', 'hardware_confidence', 'outreach_status',
    'company_website', 'emails', 'article_title', 'source', 'source_url', 'discovered_at', 'notes',
  ];

  const csvLines = [
    headers.join(','),
    ...rows.map(r => [
      q(r.company_name), q(r.country_code), q(r.funding_stage),
      r.funding_amount_millions || '',
      q(r.funding_currency),
      q((r.industry_tags || []).join('; ')),
      r.hardware_confidence || 0,
      q(r.outreach_status),
      q(r.company_website),
      q((r.scraped_emails || []).join('; ')),
      q(r.article_title),
      q(r.source_name),
      q(r.source_url),
      q(r.discovered_at),
      q(r.notes),
    ].join(',')),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="funded-startups-${new Date().toISOString().substring(0, 10)}.csv"`);
  return res.status(200).send(csvLines.join('\n'));
}

function q(val) {
  if (val === null || val === undefined) return '';
  return `"${String(val).replace(/"/g, '""')}"`;
}
