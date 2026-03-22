/**
 * Telegram Tenders Bot — Supabase Edge Function
 * Webhook handler for Telegram bot commands related to tender monitoring.
 *
 * Commands:
 *   /tenders          — Summary of today's tenders
 *   /high_tenders     — Top 5 high-score tenders
 *   /tender_stats     — Stats by country
 *   /tender_digest    — Medium-score digest
 *   /tender_<UUID8>   — View specific tender details
 *   /interested_<ID>  — Mark tender as interested
 *   /dismiss_<ID>     — Dismiss tender
 *
 * GET ?action=digest  — Trigger daily digest (for cron)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FLAG_MAP: Record<string, string> = {
  NL: "🇳🇱", IE: "🇮🇪", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹",
  ES: "🇪🇸", PL: "🇵🇱", BE: "🇧🇪", SE: "🇸🇪", AT: "🇦🇹",
  DK: "🇩🇰", FI: "🇫🇮", PT: "🇵🇹", RO: "🇷🇴", EE: "🇪🇪",
  NO: "🇳🇴", CZ: "🇨🇿", HU: "🇭🇺", HR: "🇭🇷", SK: "🇸🇰",
  SI: "🇸🇮", BG: "🇧🇬", LT: "🇱🇹", LV: "🇱🇻", CY: "🇨🇾",
  LU: "🇱🇺", MT: "🇲🇹",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET: manual digest trigger
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "digest") {
      const msg = await buildDigestMessage();
      await sendMessage(telegramChatId, msg);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response("OK", { headers: corsHeaders });
  }

  // POST: webhook from Telegram
  const body = await req.json().catch(() => ({}));
  const message = body?.message || body?.callback_query?.message;
  const text = body?.message?.text || "";
  const chatId = message?.chat?.id;

  if (!chatId || !text) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const responseText = await handleCommand(text, chatId);
  if (responseText) {
    await sendMessage(chatId, responseText);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function handleCommand(text: string, chatId: number): Promise<string> {
  const cmd = text.split(" ")[0].replace(/^\//, "").toLowerCase();
  const parts = text.split("_");

  // /tenders — today's summary
  if (cmd === "tenders" || cmd === "start") {
    return await buildSummaryMessage();
  }

  // /high_tenders — top 5 high-score
  if (cmd === "high" || text.startsWith("/high_tenders")) {
    return await buildHighTendersMessage();
  }

  // /tender_stats — country stats
  if (cmd === "tender" && parts[1] === "stats") {
    return await buildStatsMessage();
  }

  // /tender_digest — medium-score digest
  if (cmd === "tender" && parts[1] === "digest") {
    return await buildDigestMessage();
  }

  // /tender_<uuid8> — view specific tender
  if (cmd === "tender" && parts[1] && parts[1].length === 8) {
    return await viewTender(parts[1]);
  }

  // /interested_<id>
  if (cmd === "interested" && parts[1]) {
    return await updateTenderStatus(parts[1], "interested");
  }

  // /dismiss_<id>
  if (cmd === "dismiss" && parts[1]) {
    return await updateTenderStatus(parts[1], "not_relevant");
  }

  // /bidding_<id>
  if (cmd === "bidding" && parts[1]) {
    return await updateTenderStatus(parts[1], "bidding");
  }

  return `Commands:\n/tenders — Today's summary\n/high_tenders — Top high-score tenders\n/tender_stats — Country statistics\n/tender_digest — Medium-score digest`;
}

async function buildSummaryMessage(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayTenders } = await supabase
    .from("tenders")
    .select("id, relevance_score, status, country_code")
    .gte("discovered_at", `${today}T00:00:00Z`);

  const total = todayTenders?.length || 0;
  const high = todayTenders?.filter(t => t.relevance_score >= 70).length || 0;
  const medium = todayTenders?.filter(t => t.relevance_score >= 40 && t.relevance_score < 70).length || 0;
  const unreviewed = todayTenders?.filter(t => t.status === "new").length || 0;

  // Count by country
  const byCountry: Record<string, number> = {};
  (todayTenders || []).forEach(t => {
    byCountry[t.country_code] = (byCountry[t.country_code] || 0) + 1;
  });
  const topCountries = Object.entries(byCountry)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cc, n]) => `${FLAG_MAP[cc] || cc} ${cc}: ${n}`)
    .join("\n");

  return `📊 TODAY'S TENDER SUMMARY\n\n` +
    `Total: ${total} tenders\n` +
    `🟢 High-score (70+): ${high}\n` +
    `🟡 Medium (40-69): ${medium}\n` +
    `📥 Unreviewed: ${unreviewed}\n\n` +
    (topCountries ? `Top countries:\n${topCountries}\n\n` : "") +
    `Commands:\n/high_tenders — High-score details\n/tender_stats — Full stats\n/tender_digest — Medium digest\n🔗 https://micronshub.eu/dashboard/tenders`;
}

async function buildHighTendersMessage(): Promise<string> {
  const { data: tenders } = await supabase
    .from("tenders")
    .select("id, country_code, title, buyer_name, estimated_value_eur, submission_deadline, relevance_score, portal_url")
    .gte("relevance_score", 70)
    .eq("status", "new")
    .order("relevance_score", { ascending: false })
    .limit(5);

  if (!tenders || tenders.length === 0) {
    return "No new high-score tenders found.";
  }

  let msg = "🟢 TOP HIGH-SCORE TENDERS\n\n";
  for (const t of tenders) {
    const flag = FLAG_MAP[t.country_code] || "";
    const value = t.estimated_value_eur ? `€${Math.round(t.estimated_value_eur).toLocaleString()}` : "—";
    const deadline = t.submission_deadline ? new Date(t.submission_deadline).toLocaleDateString("en-GB") : "—";
    const shortId = t.id.substring(0, 8);
    msg += `${flag} Score: ${t.relevance_score}/100\n`;
    msg += `📋 ${t.title.substring(0, 100)}\n`;
    if (t.buyer_name) msg += `🏢 ${t.buyer_name.substring(0, 60)}\n`;
    msg += `💰 ${value} | 📅 ${deadline}\n`;
    msg += `/tender_${shortId} | /interested_${shortId} | /dismiss_${shortId}\n\n`;
  }

  return msg.trim();
}

async function buildStatsMessage(): Promise<string> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { count: total },
    { count: relevant },
    { count: newThisWeek },
    { data: byCountry },
  ] = await Promise.all([
    supabase.from("tenders").select("*", { count: "exact", head: true }),
    supabase.from("tenders").select("*", { count: "exact", head: true }).eq("is_relevant", true),
    supabase.from("tenders").select("*", { count: "exact", head: true }).gte("discovered_at", weekAgo),
    supabase.from("tenders").select("country_code").eq("is_relevant", true),
  ]);

  const countryMap: Record<string, number> = {};
  (byCountry || []).forEach(t => {
    countryMap[t.country_code] = (countryMap[t.country_code] || 0) + 1;
  });

  const topCountries = Object.entries(countryMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([cc, n]) => `  ${FLAG_MAP[cc] || cc} ${cc}: ${n}`)
    .join("\n");

  return `📊 TENDER STATISTICS\n\n` +
    `Total: ${total || 0}\n` +
    `Relevant: ${relevant || 0}\n` +
    `This week: ${newThisWeek || 0}\n\n` +
    `Top countries (relevant):\n${topCountries || "No data yet"}\n\n` +
    `🔗 https://micronshub.eu/dashboard/tenders`;
}

async function buildDigestMessage(): Promise<string> {
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data: tenders } = await supabase
    .from("tenders")
    .select("id, country_code, title, buyer_name, estimated_value_eur, submission_deadline, relevance_score, matched_keywords")
    .gte("relevance_score", 40)
    .lt("relevance_score", 70)
    .gte("discovered_at", yesterday)
    .eq("status", "new")
    .order("relevance_score", { ascending: false })
    .limit(10);

  if (!tenders || tenders.length === 0) {
    return "No medium-score tenders in the last 24 hours.";
  }

  let msg = "🟡 MEDIUM-SCORE TENDER DIGEST (24h)\n\n";
  for (const t of tenders) {
    const flag = FLAG_MAP[t.country_code] || "";
    const value = t.estimated_value_eur ? `€${Math.round(t.estimated_value_eur).toLocaleString()}` : "—";
    const shortId = t.id.substring(0, 8);
    msg += `${flag} ${t.title.substring(0, 80)}\n`;
    msg += `   Score: ${t.relevance_score} | 💰 ${value}\n`;
    msg += `   /tender_${shortId}\n\n`;
  }

  return msg.trim();
}

async function viewTender(shortId: string): Promise<string> {
  const { data: tenders } = await supabase
    .from("tenders")
    .select("*")
    .ilike("id", `${shortId}%`)
    .limit(1);

  const t = tenders?.[0];
  if (!t) return `Tender ${shortId} not found.`;

  const flag = FLAG_MAP[t.country_code] || "";
  const value = t.estimated_value_eur ? `€${Math.round(t.estimated_value_eur).toLocaleString()}` : "Not specified";
  const deadline = t.submission_deadline ? new Date(t.submission_deadline).toLocaleDateString("en-GB") : "Not specified";
  const shortIdFull = t.id.substring(0, 8);

  return `🏛 TENDER DETAILS\n\n` +
    `${flag} Country: ${t.country_name}\n` +
    `📋 Title: ${t.title}\n` +
    (t.buyer_name ? `🏢 Buyer: ${t.buyer_name}\n` : "") +
    `💰 Value: ${value}\n` +
    `📅 Deadline: ${deadline}\n` +
    `📊 Score: ${t.relevance_score}/100\n` +
    `🏷 CPV: ${(t.cpv_codes || []).slice(0, 3).join(", ") || "N/A"}\n` +
    `🔑 Keywords: ${(t.matched_keywords || []).slice(0, 5).join(", ") || "N/A"}\n` +
    `📌 Status: ${t.status}\n\n` +
    (t.portal_url ? `🔗 ${t.portal_url}\n\n` : "") +
    `/interested_${shortIdFull} | /bidding_${shortIdFull} | /dismiss_${shortIdFull}`;
}

async function updateTenderStatus(shortId: string, newStatus: string): Promise<string> {
  const { data: tenders } = await supabase
    .from("tenders")
    .select("id, title")
    .ilike("id", `${shortId}%`)
    .limit(1);

  const t = tenders?.[0];
  if (!t) return `Tender ${shortId} not found.`;

  await supabase.from("tenders").update({ status: newStatus }).eq("id", t.id);

  const statusEmoji: Record<string, string> = {
    interested: "⭐",
    not_relevant: "❌",
    bidding: "📝",
    reviewed: "👁",
  };

  return `${statusEmoji[newStatus] || "✅"} Tender marked as "${newStatus}":\n${t.title.substring(0, 100)}`;
}

async function sendMessage(chatId: string | number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}
