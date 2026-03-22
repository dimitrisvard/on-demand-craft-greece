/**
 * Tender Export API
 * GET /api/tenders-export
 *
 * Exports filtered tenders as CSV.
 * Query params: same as /api/tenders
 */

import { createClient } from '@supabase/supabase-js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization');
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

  // Apply CPV prefix filter
  if (cpv_prefix && cpv_prefix !== 'all') {
    rows = rows.filter(t =>
      (t.cpv_codes || []).some(c => String(c).startsWith(cpv_prefix))
    );
  }

  // Build CSV
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
