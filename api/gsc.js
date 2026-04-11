/**
 * Consolidated GSC API router.
 *
 * Vercel's Hobby plan is capped at 12 serverless functions, so instead of
 * one handler per action we dispatch on the `action` query/body parameter.
 *
 * Actions:
 *   POST   /api/gsc?action=search-analytics  → body: search analytics query
 *   POST   /api/gsc?action=inspect-url       → body: { url, languageCode? }
 *   POST   /api/gsc?action=bulk-inspect      → body: { urls[], languageCode? }
 *   GET    /api/gsc?action=submit-indexing   → returns { used, limit }
 *   POST   /api/gsc?action=submit-indexing   → body: { urls[], type? }
 *   GET    /api/gsc?action=sitemaps          → list
 *   POST   /api/gsc?action=sitemaps          → body: { feedpath }
 *   DELETE /api/gsc?action=sitemaps          → body: { feedpath }
 *   GET    /api/gsc?action=monitored-urls    → list (?language=xx)
 *   POST   /api/gsc?action=monitored-urls    → body: { url, label?, ... }
 *   DELETE /api/gsc?action=monitored-urls    → body: { id }
 */

import { requireAdmin, setCors } from './_lib/admin-auth.js';
import {
  searchAnalytics,
  inspectUrl,
  cacheInspectionResult,
  submitBatchForIndexing,
  getIndexingQuotaUsed,
  listSitemaps,
  submitSitemap,
  deleteSitemap,
  getSharedSupabase,
} from './_lib/gsc-client.js';

function buildFilterGroups(filters = {}) {
  const rows = [];
  if (filters.page) rows.push({ dimension: 'page', operator: 'contains', expression: filters.page });
  if (filters.country) rows.push({ dimension: 'country', operator: 'equals', expression: filters.country });
  if (filters.device) rows.push({ dimension: 'device', operator: 'equals', expression: filters.device });
  if (filters.query) rows.push({ dimension: 'query', operator: 'contains', expression: filters.query });
  return rows.length ? [{ groupType: 'and', filters: rows }] : undefined;
}

function statusFromCode(err) {
  if (err.code === 'RATE_LIMITED') return 429;
  if (err.code === 'AUTH_FAILED') return 401;
  return 500;
}

const MAX_BULK_INSPECT = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- handlers --------------------------------------------------------------

async function handleSearchAnalytics(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const {
    startDate,
    endDate,
    dimensions = ['query'],
    filters,
    rowLimit = 1000,
    startRow = 0,
    searchType,
  } = req.body || {};
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }
  const data = await searchAnalytics({
    startDate,
    endDate,
    dimensions,
    dimensionFilterGroups: buildFilterGroups(filters),
    rowLimit,
    startRow,
    searchType,
  });
  return res.status(200).json(data);
}

async function handleInspectUrl(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { url, languageCode } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const result = await inspectUrl(url, languageCode || 'en-US');
  await cacheInspectionResult(url, result);
  return res.status(200).json({ url, result });
}

async function handleBulkInspect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { urls, languageCode } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' });
  }
  const capped = urls.slice(0, MAX_BULK_INSPECT);
  const results = [];
  for (let i = 0; i < capped.length; i++) {
    const url = capped[i];
    try {
      const result = await inspectUrl(url, languageCode || 'en-US');
      await cacheInspectionResult(url, result);
      results.push({ url, ok: true, result });
    } catch (err) {
      results.push({ url, ok: false, error: err.message, code: err.code });
      if (err.code === 'AUTH_FAILED') break;
    }
    if (i < capped.length - 1) await sleep(1000);
  }
  return res.status(200).json({
    results,
    truncated: urls.length > MAX_BULK_INSPECT,
    totalRequested: urls.length,
  });
}

async function handleSubmitIndexing(req, res, admin) {
  if (req.method === 'GET') {
    const quota = await getIndexingQuotaUsed();
    return res.status(200).json(quota);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { urls, type = 'URL_UPDATED' } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls must be a non-empty array' });
  }
  if (!['URL_UPDATED', 'URL_DELETED'].includes(type)) {
    return res.status(400).json({ error: "type must be 'URL_UPDATED' or 'URL_DELETED'" });
  }
  const { results, quota } = await submitBatchForIndexing(urls, type, admin.userId);
  return res.status(200).json({ results, quota });
}

async function handleSitemaps(req, res) {
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
}

async function handleMonitoredUrls(req, res) {
  const sb = getSharedSupabase();
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
      .upsert({ url, label, language, service_type, priority: priority ?? 5 }, { onConflict: 'url' })
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
}

// ---- main dispatcher ------------------------------------------------------

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const action = (req.query?.action || req.body?.action || '').toString();

  try {
    switch (action) {
      case 'search-analytics':
        return await handleSearchAnalytics(req, res);
      case 'inspect-url':
        return await handleInspectUrl(req, res);
      case 'bulk-inspect':
        return await handleBulkInspect(req, res);
      case 'submit-indexing':
        return await handleSubmitIndexing(req, res, admin);
      case 'sitemaps':
        return await handleSitemaps(req, res);
      case 'monitored-urls':
        return await handleMonitoredUrls(req, res);
      default:
        return res.status(400).json({
          error:
            "Unknown action. Expected one of: search-analytics, inspect-url, bulk-inspect, submit-indexing, sitemaps, monitored-urls",
        });
    }
  } catch (err) {
    return res.status(statusFromCode(err)).json({ error: err.message, code: err.code });
  }
}
