/**
 * /api/gsc/monitored-urls
 *   GET    — list all monitored urls (optionally filtered by ?language=xx)
 *   POST   — body: { url, label?, language?, service_type?, priority? }
 *   DELETE — body: { id }
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { getSharedSupabase } from '../_lib/gsc-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const sb = getSharedSupabase();

  try {
    if (req.method === 'GET') {
      const language = req.query?.language;
      let q = sb.from('gsc_monitored_urls').select('*').order('priority', { ascending: false });
      if (language) q = q.eq('language', language);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ urls: data || [] });
    }

    if (req.method === 'POST') {
      const { url, label, language, service_type, priority } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url is required' });
      const { data, error } = await sb
        .from('gsc_monitored_urls')
        .upsert(
          { url, label, language, service_type, priority: priority ?? 5 },
          { onConflict: 'url' },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ url: data });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { error } = await sb.from('gsc_monitored_urls').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
