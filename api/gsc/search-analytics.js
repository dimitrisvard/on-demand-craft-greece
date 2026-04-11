/**
 * POST /api/gsc/search-analytics
 * Body: { startDate, endDate, dimensions?, filters?, rowLimit?, startRow?, searchType? }
 *
 * filters = { page?: string, country?: string, device?: string, query?: string }
 * Translates into dimensionFilterGroups for the GSC API.
 */

import { requireAdmin, setCors } from '../_lib/admin-auth.js';
import { searchAnalytics } from '../_lib/gsc-client.js';

function buildFilterGroups(filters = {}) {
  const filterRows = [];
  if (filters.page) filterRows.push({ dimension: 'page', operator: 'contains', expression: filters.page });
  if (filters.country) filterRows.push({ dimension: 'country', operator: 'equals', expression: filters.country });
  if (filters.device) filterRows.push({ dimension: 'device', operator: 'equals', expression: filters.device });
  if (filters.query) filterRows.push({ dimension: 'query', operator: 'contains', expression: filters.query });
  if (filterRows.length === 0) return undefined;
  return [{ groupType: 'and', filters: filterRows }];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

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

  try {
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
  } catch (err) {
    const status = err.code === 'RATE_LIMITED' ? 429 : err.code === 'AUTH_FAILED' ? 401 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
}
