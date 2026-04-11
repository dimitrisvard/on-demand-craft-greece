/**
 * POST /api/gsc/submit-indexing
 * Body: { urls: string[], type?: 'URL_UPDATED' | 'URL_DELETED' }
 *
 * Checks daily quota (200/day) before submitting. URLs beyond the remaining
 * quota are logged as 'skipped_quota' and reported in the response.
 *
 * GET /api/gsc/submit-indexing → returns current quota usage.
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { submitBatchForIndexing, getIndexingQuotaUsed } from '../_lib/gsc-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    try {
      const quota = await getIndexingQuotaUsed();
      return res.status(200).json(quota);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { urls, type = 'URL_UPDATED' } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' });
  }
  if (!['URL_UPDATED', 'URL_DELETED'].includes(type)) {
    return res.status(400).json({ error: "type must be 'URL_UPDATED' or 'URL_DELETED'" });
  }

  try {
    const { results, quota } = await submitBatchForIndexing(urls, type, admin.userId);
    return res.status(200).json({ results, quota });
  } catch (err) {
    const status = err.code === 'AUTH_FAILED' ? 401 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
}
