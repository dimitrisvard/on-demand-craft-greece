/**
 * Connector Status API
 * GET /api/connector-status
 *
 * Returns the status of all country connectors with last scan info.
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
      health: getHealth(c, log),
    };
  });

  return res.status(200).json({ connectors: enriched });
}

function getHealth(connector, log) {
  if (!connector.is_active) return 'inactive';
  if (!connector.last_scan_at) return 'never_scanned';
  if (connector.last_error && !connector.last_scan_count) return 'error';

  const hoursSinceLastScan = (Date.now() - new Date(connector.last_scan_at).getTime()) / 3600000;
  if (hoursSinceLastScan > connector.scan_frequency_hours * 2) return 'stale';
  if (connector.last_error) return 'warning';
  return 'healthy';
}
