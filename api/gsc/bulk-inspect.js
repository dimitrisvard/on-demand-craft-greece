/**
 * POST /api/gsc/bulk-inspect
 * Body: { urls: string[], languageCode?: string }
 * Capped at 50 URLs per request. Delays 1s between calls to avoid rate limits.
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { inspectUrl, cacheInspectionResult } from '../_lib/gsc-client.js';

const MAX_URLS = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { urls, languageCode } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' });
  }
  const capped = urls.slice(0, MAX_URLS);
  const results = [];

  for (let i = 0; i < capped.length; i++) {
    const url = capped[i];
    try {
      const result = await inspectUrl(url, languageCode || 'en-US');
      await cacheInspectionResult(url, result);
      results.push({ url, ok: true, result });
    } catch (err) {
      results.push({ url, ok: false, error: err.message, code: err.code });
      // Stop early on auth failure — every subsequent call will fail the same way.
      if (err.code === 'AUTH_FAILED') break;
    }
    if (i < capped.length - 1) await sleep(1000);
  }

  const truncated = urls.length > MAX_URLS;
  return res.status(200).json({ results, truncated, totalRequested: urls.length });
}
