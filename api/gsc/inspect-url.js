/**
 * POST /api/gsc/inspect-url
 * Body: { url: string, languageCode?: string }
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { inspectUrl, cacheInspectionResult } from '../_lib/gsc-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { url, languageCode } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const result = await inspectUrl(url, languageCode || 'en-US');
    await cacheInspectionResult(url, result);
    return res.status(200).json({ url, result });
  } catch (err) {
    const status = err.code === 'RATE_LIMITED' ? 429 : err.code === 'AUTH_FAILED' ? 401 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
}
