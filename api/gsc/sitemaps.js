/**
 * /api/gsc/sitemaps
 *   GET    — list all submitted sitemaps
 *   POST   — body: { feedpath } — submit sitemap
 *   DELETE — body: { feedpath } — remove sitemap
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { listSitemaps, submitSitemap, deleteSitemap } from '../_lib/gsc-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const sitemaps = await listSitemaps();
      return res.status(200).json({ sitemaps });
    }

    if (req.method === 'POST') {
      const { feedpath } = req.body || {};
      if (!feedpath) return res.status(400).json({ error: 'feedpath is required' });
      await submitSitemap(feedpath);
      return res.status(200).json({ ok: true, feedpath });
    }

    if (req.method === 'DELETE') {
      const { feedpath } = req.body || {};
      if (!feedpath) return res.status(400).json({ error: 'feedpath is required' });
      await deleteSitemap(feedpath);
      return res.status(200).json({ ok: true, feedpath });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code === 'RATE_LIMITED' ? 429 : err.code === 'AUTH_FAILED' ? 401 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
}
