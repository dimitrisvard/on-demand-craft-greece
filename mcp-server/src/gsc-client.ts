/**
 * GSC client for the MCP server (TypeScript).
 * Mirrors api/_lib/gsc-client.js — same endpoints, same function signatures.
 *
 * Uses plain `fetch` + Node's `crypto` (no `googleapis` dependency) so the
 * MCP server stays lightweight and the TypeScript compiler doesn't have to
 * walk the googleapis type graph.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";

const SUPABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3";
const SEARCHCONSOLE_BASE = "https://searchconsole.googleapis.com/v1";
const INDEXING_BASE = "https://indexing.googleapis.com/v3";

interface GscConfig {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  service_account: any;
  site_url: string;
}

let cachedSupabase: SupabaseClient | null = null;
let cachedConfig: GscConfig | null = null;
let cachedOAuthToken: { access_token: string; exp: number } | null = null;
let cachedSaToken: { access_token: string; exp: number } | null = null;

function getSupabase(): SupabaseClient {
  if (cachedSupabase) return cachedSupabase;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  cachedSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSupabase;
}

async function loadConfig(): Promise<GscConfig> {
  if (cachedConfig) return cachedConfig;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("gsc_config")
    .select("client_id, client_secret, refresh_token, service_account, site_url")
    .eq("id", 1)
    .single();
  if (error || !data) {
    throw new Error(
      "gsc_config row not found. Insert credentials into gsc_config (id=1).",
    );
  }
  cachedConfig = data as GscConfig;
  return cachedConfig;
}

export async function getSiteUrl(): Promise<string> {
  const cfg = await loadConfig();
  return cfg.site_url;
}

// ---- OAuth2 refresh token → access token ---------------------------------

async function getOAuthAccessToken(): Promise<string> {
  if (cachedOAuthToken && cachedOAuthToken.exp > Date.now() + 60_000) {
    return cachedOAuthToken.access_token;
  }
  const cfg = await loadConfig();
  const body = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(
      `OAuth refresh failed (${res.status}): ${json.error_description || json.error || "unknown"}. ` +
        `Update gsc_config.refresh_token via Supabase SQL editor.`,
    );
  }
  cachedOAuthToken = {
    access_token: json.access_token,
    exp: Date.now() + (json.expires_in || 3000) * 1000,
  };
  return cachedOAuthToken.access_token;
}

// ---- Service account JWT → access token (Indexing API) ------------------

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getServiceAccountAccessToken(): Promise<string> {
  if (cachedSaToken && cachedSaToken.exp > Date.now() + 60_000) {
    return cachedSaToken.access_token;
  }
  const cfg = await loadConfig();
  const sa =
    typeof cfg.service_account === "string"
      ? JSON.parse(cfg.service_account)
      : cfg.service_account;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const claims = {
    iss: sa.client_email,
    scope: INDEXING_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput =
    base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = signingInput + "." + signature;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(
      `Service-account auth failed (${res.status}): ${json.error_description || json.error || "unknown"}`,
    );
  }
  cachedSaToken = {
    access_token: json.access_token,
    exp: Date.now() + (json.expires_in || 3000) * 1000,
  };
  return cachedSaToken.access_token;
}

// ---- REST helper ---------------------------------------------------------

async function gapi(
  url: string,
  opts: { method?: string; body?: any; token: string },
): Promise<any> {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json: any = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`GSC API error: ${msg}`);
  }
  return json;
}

// ===== Search Analytics ====================================================

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: any[];
  rowLimit?: number;
  startRow?: number;
  searchType?: string;
}

export async function searchAnalytics(req: SearchAnalyticsRequest): Promise<any> {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  return gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      token,
      body: {
        startDate: req.startDate,
        endDate: req.endDate,
        dimensions: req.dimensions || ["query"],
        dimensionFilterGroups: req.dimensionFilterGroups,
        rowLimit: req.rowLimit || 1000,
        startRow: req.startRow || 0,
        searchType: req.searchType,
      },
    },
  );
}

// ===== URL Inspection ======================================================

export async function inspectUrl(url: string, languageCode = "en-US"): Promise<any> {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  const data = await gapi(`${SEARCHCONSOLE_BASE}/urlInspection/index:inspect`, {
    method: "POST",
    token,
    body: { inspectionUrl: url, siteUrl, languageCode },
  });
  return data?.inspectionResult || data;
}

// ===== Indexing API ========================================================

const INDEXING_DAILY_QUOTA = 200;

export async function getIndexingQuotaUsed(): Promise<{ used: number; limit: number }> {
  const sb = getSupabase();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await sb
    .from("gsc_indexing_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "success")
    .gte("submitted_at", startOfDay.toISOString());
  if (error) throw new Error(`Quota check failed: ${error.message}`);
  return { used: count || 0, limit: INDEXING_DAILY_QUOTA };
}

export async function submitForIndexing(url: string, type = "URL_UPDATED"): Promise<any> {
  const token = await getServiceAccountAccessToken();
  return gapi(`${INDEXING_BASE}/urlNotifications:publish`, {
    method: "POST",
    token,
    body: { url, type },
  });
}

async function logIndexing(url: string, action: string, status: string, errorMessage?: string) {
  const sb = getSupabase();
  await sb.from("gsc_indexing_log").insert({
    url,
    action,
    status,
    error_message: errorMessage || null,
  });
}

export async function submitBatchForIndexing(
  urls: string[],
  type = "URL_UPDATED",
): Promise<{
  results: Array<{ url: string; status: string; error?: string }>;
  quota: { used: number; limit: number };
}> {
  const { used, limit } = await getIndexingQuotaUsed();
  const remaining = Math.max(0, limit - used);
  const results: Array<{ url: string; status: string; error?: string }> = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i >= remaining) {
      await logIndexing(url, type, "skipped_quota", "Daily quota of 200 reached");
      results.push({ url, status: "skipped_quota" });
      continue;
    }
    try {
      await submitForIndexing(url, type);
      await logIndexing(url, type, "success");
      results.push({ url, status: "success" });
    } catch (err: any) {
      await logIndexing(url, type, "error", err.message);
      results.push({ url, status: "error", error: err.message });
    }
  }
  return { results, quota: await getIndexingQuotaUsed() };
}

// ===== Sitemaps ============================================================

export async function listSitemaps(): Promise<any[]> {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  const data = await gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { token },
  );
  return data?.sitemap || [];
}

export async function submitSitemap(feedpath: string): Promise<void> {
  const token = await getOAuthAccessToken();
  const siteUrl = await getSiteUrl();
  await gapi(
    `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: "PUT", token },
  );
}
