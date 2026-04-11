/**
 * Google Search Console + Indexing API client (Vercel handlers).
 *
 * Credentials are stored in a single `gsc_config` row in Supabase and read
 * using SUPABASE_SERVICE_KEY. This avoids adding any new Vercel env vars.
 *
 * Deliberately implemented with plain `fetch` + Node's `crypto` rather than
 * the `googleapis` package: that library's type graph is huge (~8 GB to
 * typecheck) and its runtime is 20 MB+ of unused endpoints. All we need is:
 *   - OAuth2 refresh token exchange (Search Console)
 *   - Service-account JWT (Indexing API)
 *   - A handful of REST calls
 *
 * Exports mirror mcp-server/src/gsc-client.ts so both surfaces share
 * identical function signatures.
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WEBMASTERS_BASE = 'https://www.googleapis.com/webmasters/v3';
const SEARCHCONSOLE_BASE = 'https://searchconsole.googleapis.com/v1';
const INDEXING_BASE = 'https://indexing.googleapis.com/v3';

let cachedSupabase = null;
let cachedConfig = null;
let cachedOAuthToken = null; // { access_token, exp }
let cachedSaToken = null;    // { access_token, exp }

function getSupabase() {
  if (cachedSupabase) return cachedSupabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  cachedSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSupabase;
}

async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('gsc_config')
    .select('client_id, client_secret, refresh_token, service_account, site_url')
    .eq('id', 1)
    .single();
  if (error || !data) {
    throw new Error(
      'gsc_config row not found. Insert credentials into gsc_config (id=1) via Supabase SQL editor.',
    );
  }
  cachedConfig = data;
  return cachedConfig;
}

export async function getSiteUrl() {
  const cfg = await loadConfig();
  return cfg.site_url;
}

// ---- OAuth2 refresh token → access token ----------------------------------

async function getOAuthAccessToken() {
  if (cachedOAuthToken && cachedOAuthToken.exp > Date.now() + 60_000) {
    return cachedOAuthToken.access_token;
  }
  const cfg = await loadConfig();
  const body = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const e = new Error(
      `OAuth refresh failed (${res.status}): ${json.error_description || json.error || 'unknown'}. ` +
        `Update gsc_config.refresh_token via Supabase SQL editor.`,
    );
    e.code = res.status === 401 || json.error === 'invalid_grant' ? 'AUTH_FAILED' : 'API_ERROR';
    throw e;
  }
  cachedOAuthToken = {
    access_token: json.access_token,
    exp: Date.now() + (json.expires_in || 3000) * 1000,
  };
  return cachedOAuthToken.access_token;
}

// ---- Service account JWT → access token (Indexing API) -------------------

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getServiceAccountAccessToken() {
  if (cachedSaToken && cachedSaToken.exp > Date.now() + 60_000) {
    return cachedSaToken.access_token;
  }
  const cfg = await loadConfig();
  const sa =
    typeof cfg.service_account === 'string'
      ? JSON.parse(cfg.service_account)
      : cfg.service_account;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const claims = {
    iss: sa.client_email,
    scope: INDEXING_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput =
    base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = signingInput + '.' + signature;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const e = new Error(
      `Service-account auth failed (${res.status}): ${json.error_description || json.error || 'unknown'}`,
    );
    e.code = 'AUTH_FAILED';
    throw e;
  }
  cachedSaToken = {
    access_token: json.access_token,
    exp: Date.now() + (json.expires_in || 3000) * 1000,
  };
  return cachedSaToken.access_token;
}

// ---- REST call helper -----------------------------------------------------

async function gapi(url, { method = 'GET', body, token }) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const reason =
      json?.error?.errors?.[0]?.reason ||
      json?.error?.status ||
      'API_ERROR';
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const e = new Error(`GSC API error: ${msg}`);
    if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'quotaExceeded') {
      e.code = 'RATE_LIMITED';
    } else if (res.status === 401 || res.status === 403) {
      e.code = 'AUTH_FAILED';
    } else {
      e.code = 'API_ERROR';
    }
    throw e;
  }
  return json;
}

// ===== Search Analytics ====================================================

export async function searchAnalytics({
  startDate,
  endDate,
  dimensions = ['query'],
  dimensionFilterGroups,
  rowLimit = 1000,
  startRow = 0,
  type,
  searchType,
}) {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  return gapi(url, {
    method: 'POST',
    token,
    body: {
      startDate,
      endDate,
      dimensions,
      dimensionFilterGroups,
      rowLimit,
      startRow,
      type,
      searchType,
    },
  });
}

// ===== URL Inspection ======================================================

export async function inspectUrl(inspectionUrl, languageCode = 'en-US') {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  const url = `${SEARCHCONSOLE_BASE}/urlInspection/index:inspect`;
  const data = await gapi(url, {
    method: 'POST',
    token,
    body: { inspectionUrl, siteUrl, languageCode },
  });
  return data?.inspectionResult || data;
}

export async function cacheInspectionResult(url, result) {
  const sb = getSupabase();
  const ir = result?.indexStatusResult || {};
  const row = {
    url,
    indexing_state: ir.verdict || ir.indexingState || null,
    coverage_state: ir.coverageState || null,
    page_fetch_state: ir.pageFetchState || null,
    robots_txt_state: ir.robotsTxtState || null,
    crawled_as: ir.crawledAs || null,
    last_crawl_time: ir.lastCrawlTime || null,
    referring_urls: ir.referringUrls || null,
    canonical_user: ir.userCanonical || null,
    canonical_google: ir.googleCanonical || null,
    mobile_usability: result?.mobileUsabilityResult?.verdict || null,
    rich_results: result?.richResultsResult || null,
    raw_result: result || null,
    inspected_at: new Date().toISOString(),
  };
  await sb.from('gsc_inspection_cache').upsert(row, { onConflict: 'url' });
}

// ===== Indexing API =========================================================

const INDEXING_DAILY_QUOTA = 200;

export async function getIndexingQuotaUsed() {
  const sb = getSupabase();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await sb
    .from('gsc_indexing_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'success')
    .gte('submitted_at', startOfDay.toISOString());
  if (error) throw new Error(`Quota check failed: ${error.message}`);
  return { used: count || 0, limit: INDEXING_DAILY_QUOTA };
}

export async function submitForIndexing(url, type = 'URL_UPDATED') {
  const token = await getServiceAccountAccessToken();
  return gapi(`${INDEXING_BASE}/urlNotifications:publish`, {
    method: 'POST',
    token,
    body: { url, type },
  });
}

export async function logIndexingAttempt({ url, action, status, errorMessage, submittedBy }) {
  const sb = getSupabase();
  await sb.from('gsc_indexing_log').insert({
    url,
    action,
    status,
    error_message: errorMessage || null,
    submitted_by: submittedBy || null,
  });
}

export async function submitBatchForIndexing(urls, type = 'URL_UPDATED', submittedBy) {
  const { used, limit } = await getIndexingQuotaUsed();
  const remaining = Math.max(0, limit - used);

  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i >= remaining) {
      await logIndexingAttempt({
        url,
        action: type,
        status: 'skipped_quota',
        errorMessage: 'Daily quota of 200 reached',
        submittedBy,
      });
      results.push({ url, status: 'skipped_quota' });
      continue;
    }
    try {
      await submitForIndexing(url, type);
      await logIndexingAttempt({ url, action: type, status: 'success', submittedBy });
      results.push({ url, status: 'success' });
    } catch (err) {
      await logIndexingAttempt({
        url,
        action: type,
        status: 'error',
        errorMessage: err.message,
        submittedBy,
      });
      results.push({ url, status: 'error', error: err.message });
    }
  }
  return { results, quota: await getIndexingQuotaUsed() };
}

// ===== Sitemaps =============================================================

export async function listSitemaps() {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  const data = await gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { token },
  );
  return data?.sitemap || [];
}

export async function submitSitemap(feedpath) {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  await gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: 'PUT', token },
  );
  return { ok: true };
}

export async function deleteSitemap(feedpath) {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  await gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: 'DELETE', token },
  );
  return { ok: true };
}

export function getSharedSupabase() {
  return getSupabase();
}
