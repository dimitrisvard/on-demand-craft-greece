/**
 * Tenders API
 * GET  /api/tenders                  — list/filter tenders
 * GET  /api/tenders?connectors=true  — connector status (also served at /api/connector-status via rewrite)
 * PATCH /api/tenders                 — update tender status/notes
 *
 * Query params for GET:
 *   country, cpv_prefix, min_value, max_value, min_score,
 *   deadline_within_days, status, relevant_only, search,
 *   limit, offset, sort
 */

import { createClient } from '@supabase/supabase-js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── GET: list tenders ────────────────────────────────
  if (req.method === 'GET') {
    const {
      country, cpv_prefix, min_value, max_value, min_score,
      deadline_within_days, status, relevant_only, search,
      limit = 50, offset = 0, sort = 'relevance_score',
      id, stats_only, export: exportMode, connectors,
    } = req.query;

    // Connector status (merged from former /api/connector-status)
    if (connectors === 'true') {
      return handleConnectors(res);
    }

    // Stats request
    if (stats_only === 'true') {
      return handleStats(res);
    }

    // CSV export (previously /api/tenders-export)
    if (exportMode === 'csv') {
      return handleExport(req, res);
    }

    // Single tender
    if (id) {
      const { data, error } = await supabase
        .from('tenders').select('*').eq('id', id).single();
      if (error) return res.status(404).json({ error: 'Tender not found' });
      return res.status(200).json(data);
    }

    let query = supabase
      .from('tenders')
      .select('*', { count: 'exact' });

    if (country && country !== 'all') query = query.eq('country_code', country.toUpperCase());
    if (status && status !== 'all') query = query.eq('status', status);
    if (relevant_only === 'true') query = query.eq('is_relevant', true);
    if (min_score) query = query.gte('relevance_score', parseInt(min_score));
    if (min_value) query = query.gte('estimated_value_eur', parseFloat(min_value));
    if (max_value) query = query.lte('estimated_value_eur', parseFloat(max_value));

    if (cpv_prefix && cpv_prefix !== 'all') {
      // Filter by CPV prefix — match codes starting with the prefix
      query = query.contains('cpv_codes', []); // workaround: we'll filter in JS
    }

    if (deadline_within_days) {
      const days = parseInt(deadline_within_days);
      const future = new Date(Date.now() + days * 86400000).toISOString();
      const now = new Date().toISOString();
      query = query.gte('submission_deadline', now).lte('submission_deadline', future);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,buyer_name.ilike.%${search}%`);
    }

    // Sort
    const sortMap = {
      relevance_score: { col: 'relevance_score', asc: false },
      deadline: { col: 'submission_deadline', asc: true },
      value: { col: 'estimated_value_eur', asc: false },
      discovered: { col: 'discovered_at', asc: false },
    };
    const sortConfig = sortMap[sort] || sortMap.relevance_score;
    query = query.order(sortConfig.col, { ascending: sortConfig.asc });

    query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Apply CPV prefix filter in JS (Supabase doesn't support array prefix matching natively)
    let filtered = data;
    if (cpv_prefix && cpv_prefix !== 'all') {
      filtered = data.filter(t =>
        (t.cpv_codes || []).some(c => String(c).startsWith(cpv_prefix))
      );
    }

    return res.status(200).json({
      tenders: filtered,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  }

  // ─── PATCH: update tender ─────────────────────────────
  if (req.method === 'PATCH') {
    const { id, status: newStatus, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const updates = {};
    if (newStatus) updates.status = newStatus;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabase
      .from('tenders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── CSV export (merged from former /api/tenders-export) ────────────────
const CSV_COLUMNS = [
  'country_code', 'country_name', 'portal_name',
  'title', 'buyer_name', 'buyer_type',
  'cpv_codes', 'nature_of_contract',
  'estimated_value_eur', 'currency',
  'publication_date', 'submission_deadline',
  'place_of_performance', 'nuts_code',
  'procedure_type',
  'relevance_score', 'matched_keywords', 'matched_cpv', 'is_relevant',
  'status', 'notes',
  'portal_url', 'tender_reference', 'discovered_at',
];

const CSV_HEADERS = [
  'Country Code', 'Country', 'Portal',
  'Title', 'Buyer', 'Buyer Type',
  'CPV Codes', 'Contract Type',
  'Value (EUR)', 'Currency',
  'Publication Date', 'Submission Deadline',
  'Place of Performance', 'NUTS Code',
  'Procedure',
  'Relevance Score', 'Matched Keywords', 'Matched CPV', 'Is Relevant',
  'Status', 'Notes',
  'Portal Link', 'Reference', 'Discovered At',
];

async function handleExport(req, res) {
  const {
    country, cpv_prefix, min_value, max_value, min_score,
    status, relevant_only, search,
  } = req.query;

  let query = supabase
    .from('tenders')
    .select('*')
    .order('relevance_score', { ascending: false })
    .limit(5000);

  if (country && country !== 'all') query = query.eq('country_code', country.toUpperCase());
  if (status && status !== 'all') query = query.eq('status', status);
  if (relevant_only === 'true') query = query.eq('is_relevant', true);
  if (min_score) query = query.gte('relevance_score', parseInt(min_score));
  if (min_value) query = query.gte('estimated_value_eur', parseFloat(min_value));
  if (max_value) query = query.lte('estimated_value_eur', parseFloat(max_value));
  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let rows = data || [];
  if (cpv_prefix && cpv_prefix !== 'all') {
    rows = rows.filter(t =>
      (t.cpv_codes || []).some(c => String(c).startsWith(cpv_prefix))
    );
  }

  const csvLines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const values = CSV_COLUMNS.map(col => {
      let val = row[col];
      if (Array.isArray(val)) val = val.join('; ');
      if (val === null || val === undefined) val = '';
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val}"`;
      }
      return val;
    });
    csvLines.push(values.join(','));
  }

  const csv = csvLines.join('\n');
  const date = new Date().toISOString().split('T')[0];
  const filename = `micronshub-tenders-${date}${country && country !== 'all' ? `-${country}` : ''}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
}

async function handleStats(res) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const todayStart = new Date(now.toDateString()).toISOString();

  const [
    { count: total },
    { count: relevant },
    { count: thisWeek },
    { count: active },
    { count: newToday },
    { data: byCountry },
    { data: byStatus },
  ] = await Promise.all([
    supabase.from('tenders').select('*', { count: 'exact', head: true }),
    supabase.from('tenders').select('*', { count: 'exact', head: true }).eq('is_relevant', true),
    supabase.from('tenders').select('*', { count: 'exact', head: true }).gte('discovered_at', weekAgo),
    supabase.from('tenders').select('*', { count: 'exact', head: true }).gte('submission_deadline', now.toISOString()),
    supabase.from('tenders').select('*', { count: 'exact', head: true }).gte('discovered_at', todayStart),
    supabase.from('tenders').select('country_code, country_name').eq('is_relevant', true),
    supabase.from('tenders').select('status').eq('is_relevant', true),
  ]);

  // Aggregate by country
  const countryMap = {};
  (byCountry || []).forEach(t => {
    countryMap[t.country_code] = (countryMap[t.country_code] || 0) + 1;
  });

  // Aggregate by status
  const statusMap = {};
  (byStatus || []).forEach(t => {
    statusMap[t.status] = (statusMap[t.status] || 0) + 1;
  });

  return res.status(200).json({
    total: total || 0,
    relevant: relevant || 0,
    thisWeek: thisWeek || 0,
    active: active || 0,
    newToday: newToday || 0,
    byCountry: countryMap,
    byStatus: statusMap,
  });
}

// ─── Connector status (merged from former /api/connector-status) ────────
async function handleConnectors(res) {
  const [{ data: connectors, error }, { data: recentLogs }] = await Promise.all([
    supabase.from('tender_connectors').select('*').order('country_code'),
    supabase.from('tender_scan_logs')
      .select('country_code, tenders_found, tenders_new, tenders_relevant, errors, duration_ms, completed_at')
      .order('completed_at', { ascending: false })
      .limit(100),
  ]);

  if (error) return res.status(500).json({ error: error.message });

  // Attach most recent log to each connector
  const enriched = (connectors || []).map(c => {
    const log = (recentLogs || []).find(l => l.country_code === c.country_code);
    return {
      ...c,
      recent_log: log || null,
      health: getConnectorHealth(c, log),
    };
  });

  return res.status(200).json({ connectors: enriched });
}

function getConnectorHealth(connector, log) {
  if (!connector.is_active) return 'inactive';
  if (!connector.last_scan_at) return 'never_scanned';
  if (connector.last_error && !connector.last_scan_count) return 'error';

  const hoursSinceLastScan = (Date.now() - new Date(connector.last_scan_at).getTime()) / 3600000;
  if (hoursSinceLastScan > connector.scan_frequency_hours * 2) return 'stale';
  if (connector.last_error) return 'warning';
  return 'healthy';
}
