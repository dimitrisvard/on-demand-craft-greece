/**
 * Tender Collector — Supabase Edge Function
 * Scheduled cron: triggers country-level tender scans via /api/tender-scan
 *
 * Run via Supabase Cron or manual HTTP call:
 * POST /functions/v1/tender-collector
 * Body: { country_code?: string } (optional — if absent, scans all due connectors)
 *
 * Architecture:
 * - Each country is scanned by calling the Vercel /api/tender-scan endpoint
 * - This edge function orchestrates which countries need scanning based on scan_frequency_hours
 * - Sends daily digest Telegram message
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")!;
// The Vercel API base URL (set in Supabase secrets)
const apiBaseUrl = Deno.env.get("VERCEL_API_URL") || "https://micronshub.eu";

const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* no body */ }

  const { country_code, action } = body;

  // ─── Daily digest action ──────────────────────────────────────
  if (action === "daily_digest") {
    await sendDailyDigest();
    return new Response(JSON.stringify({ ok: true, action: "daily_digest" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Single country scan ──────────────────────────────────────
  if (country_code) {
    const result = await triggerCountryScan(country_code.toUpperCase());
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Scan all due connectors ──────────────────────────────────
  const results = await scanDueConnectors();
  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

/**
 * Find connectors that are due for scanning based on their frequency
 */
async function scanDueConnectors(): Promise<any[]> {
  const { data: connectors } = await supabase
    .from("tender_connectors")
    .select("country_code, scan_frequency_hours, last_scan_at, is_active")
    .eq("is_active", true);

  if (!connectors) return [];

  const now = Date.now();
  const dueCodes: string[] = [];

  for (const c of connectors) {
    if (!c.last_scan_at) {
      dueCodes.push(c.country_code); // Never scanned
      continue;
    }
    const lastScan = new Date(c.last_scan_at).getTime();
    const hoursSince = (now - lastScan) / 3600000;
    if (hoursSince >= c.scan_frequency_hours) {
      dueCodes.push(c.country_code);
    }
  }

  console.log(`[tender-collector] Due connectors: ${dueCodes.join(", ")}`);

  // Scan in parallel (batches of 3 to avoid overloading)
  const results = [];
  for (let i = 0; i < dueCodes.length; i += 3) {
    const batch = dueCodes.slice(i, i + 3);
    const batchResults = await Promise.allSettled(
      batch.map(code => triggerCountryScan(code))
    );
    results.push(...batchResults.map((r, j) => ({
      country: batch[j],
      success: r.status === "fulfilled",
      result: r.status === "fulfilled" ? r.value : (r as any).reason?.message,
    })));
    // 2 second delay between batches
    if (i + 3 < dueCodes.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

/**
 * Trigger a country scan via the Vercel API
 */
async function triggerCountryScan(countryCode: string): Promise<any> {
  try {
    const resp = await fetch(`${apiBaseUrl}/api/tender-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_code: countryCode }),
      signal: AbortSignal.timeout(55000), // 55s timeout (Vercel limit is 60s)
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
    }

    return await resp.json();
  } catch (err: any) {
    console.error(`[tender-collector] Failed to scan ${countryCode}:`, err.message);
    throw err;
  }
}

/**
 * Send daily digest of new relevant tenders
 */
async function sendDailyDigest(): Promise<void> {
  if (!telegramBotToken || !telegramChatId) return;

  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data: newTenders } = await supabase
    .from("tenders")
    .select("id, country_code, country_name, title, buyer_name, estimated_value_eur, submission_deadline, relevance_score, portal_url, matched_keywords")
    .eq("is_relevant", true)
    .gte("discovered_at", yesterday)
    .gte("relevance_score", 40)
    .order("relevance_score", { ascending: false })
    .limit(10);

  const { count: totalNew } = await supabase
    .from("tenders")
    .select("*", { count: "exact", head: true })
    .gte("discovered_at", yesterday);

  const { count: highNew } = await supabase
    .from("tenders")
    .select("*", { count: "exact", head: true })
    .gte("discovered_at", yesterday)
    .gte("relevance_score", 70);

  const flagMap: Record<string, string> = {
    NL: "🇳🇱", IE: "🇮🇪", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹",
    ES: "🇪🇸", PL: "🇵🇱", BE: "🇧🇪", SE: "🇸🇪", AT: "🇦🇹",
    DK: "🇩🇰", FI: "🇫🇮", PT: "🇵🇹", RO: "🇷🇴", EE: "🇪🇪",
    NO: "🇳🇴", CZ: "🇨🇿", HU: "🇭🇺", HR: "🇭🇷", SK: "🇸🇰",
    SI: "🇸🇮", BG: "🇧🇬", LT: "🇱🇹", LV: "🇱🇻", CY: "🇨🇾",
    LU: "🇱🇺", MT: "🇲🇹",
  };

  let msg = `📊 DAILY TENDER DIGEST\n\n`;
  msg += `New today: ${totalNew || 0} | High-score: ${highNew || 0}\n\n`;

  if (!newTenders || newTenders.length === 0) {
    msg += "No relevant tenders found in the last 24 hours.\n";
  } else {
    for (const t of newTenders) {
      const flag = flagMap[t.country_code] || "";
      const score = t.relevance_score >= 70 ? "🟢" : "🟡";
      const value = t.estimated_value_eur
        ? `€${Math.round(t.estimated_value_eur).toLocaleString()}`
        : "—";
      const deadline = t.submission_deadline
        ? new Date(t.submission_deadline).toLocaleDateString("en-GB")
        : "—";
      msg += `${score} ${flag} ${t.title.substring(0, 80)}\n`;
      msg += `   💰 ${value} | 📅 ${deadline} | Score: ${t.relevance_score}\n`;
      if (t.buyer_name) msg += `   🏢 ${t.buyer_name.substring(0, 60)}\n`;
      msg += "\n";
    }
  }

  msg += `\n🔗 View all: https://micronshub.eu/dashboard/tenders`;

  await sendTelegramMessage(msg);
}

async function sendTelegramMessage(text: string): Promise<void> {
  if (!telegramBotToken || !telegramChatId) return;
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });
}
