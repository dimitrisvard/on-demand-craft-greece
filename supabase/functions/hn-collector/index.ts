import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HN_SEARCH_TERMS = [
  "CNC machining",
  "manufacturing",
  "prototype machining",
  "3D printing service",
  "sheet metal fabrication",
  "injection molding",
  "hardware startup manufacturing",
  "custom parts",
  "rapid prototyping",
  "metal parts",
  "machine shop",
  "precision parts",
  "Xometry",
  "Protolabs",
  "contract manufacturer",
];

interface HNHit {
  objectID: string;
  title: string;
  story_text: string | null;
  author: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
  created_at_i: number;
  _tags: string[];
}

interface Keyword { keyword: string; category: string; weight: number; }

async function loadKeywords(): Promise<Keyword[]> {
  const { data } = await supabase.from("lead_keywords").select("keyword, category, weight").eq("is_active", true);
  return data || [];
}

function matchKeywords(text: string, keywords: Keyword[]): { matched: string[]; categories: string[]; score: string; scoreValue: number } {
  const lowerText = text.toLowerCase();
  const matchedKeywords: string[] = [];
  const matchedCategories = new Set<string>();
  let totalWeight = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw.keyword.toLowerCase())) {
      matchedKeywords.push(kw.keyword);
      matchedCategories.add(kw.category);
      totalWeight += kw.weight;
    }
  }
  const categories = Array.from(matchedCategories);
  const hasSourcingIntent = categories.includes("sourcing_intent");
  const hasGeoEurope = categories.includes("geographic_europe");
  const hasCompetitorComplaint = categories.includes("competitor_complaints");
  const hasMaterialSpecific = categories.includes("material_specific");
  const hasCompetitionTeam = categories.includes("competition_teams");
  const hasCompetitorMention = categories.includes("competitor_mentions");
  let score = "noise";
  if (matchedKeywords.length === 0) {
    score = "noise";
  } else if ((hasSourcingIntent && hasGeoEurope) || hasCompetitorComplaint || (hasSourcingIntent && hasCompetitionTeam) || totalWeight >= 6) {
    score = "high";
  } else if (hasSourcingIntent || (hasMaterialSpecific && matchedKeywords.length >= 2) || hasCompetitionTeam || totalWeight >= 3) {
    score = "medium";
  } else if (hasCompetitorMention || hasGeoEurope || totalWeight >= 1) {
    score = "low";
  }
  return { matched: matchedKeywords, categories, score, scoreValue: totalWeight };
}

async function sendTelegramNotification(hit: HNHit, matchResult: { matched: string[]; categories: string[]; score: string }) {
  if (!telegramBotToken || !telegramChatId) return;
  const timeAgo = Math.round((Date.now() / 1000 - hit.created_at_i) / 60);
  const timeStr = timeAgo < 60 ? `${timeAgo} min ago` : `${Math.round(timeAgo / 60)} hr ago`;
  const excerpt = (hit.story_text || "").slice(0, 300).replace(/<[^>]+>/g, "").trim();
  const postUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const scoreEmoji = matchResult.score === "high" ? "🔴" : matchResult.score === "medium" ? "🟡" : "🟢";
  const message =
    `${scoreEmoji} ${matchResult.score.toUpperCase()} INTENT LEAD — Hacker News\n\n` +
    `📍 Source: Hacker News\n` +
    `⏰ Posted: ${timeStr}\n` +
    `👤 Author: ${hit.author}\n\n` +
    `📌 Title: ${hit.title}\n\n` +
    (excerpt ? `💬 Excerpt: "${excerpt}..."\n\n` : "") +
    `🏷 Keywords: ${matchResult.matched.slice(0, 5).join(", ")}\n\n` +
    `🔗 Post: ${postUrl}\n\nOpen Dashboard: /dashboard/leads`;
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramChatId, text: message, disable_web_page_preview: true }),
  });
}

async function searchHN(query: string, lastTimestamp: number): Promise<HNHit[]> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${lastTimestamp}&hitsPerPage=50`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.hits || [];
}

async function searchShowHN(lastTimestamp: number): Promise<HNHit[]> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>${lastTimestamp}&hitsPerPage=50`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.hits || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const keywords = await loadKeywords();

    // Get timestamp of most recent HN lead we already have
    const { data: latestLead } = await supabase
      .from("leads")
      .select("posted_at")
      .eq("source", "hackernews")
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastTimestamp = latestLead?.posted_at
      ? Math.floor(new Date(latestLead.posted_at).getTime() / 1000) - 60
      : Math.floor(Date.now() / 1000) - 3600; // default: last 1 hour

    // Collect all unique HN hits
    const allHits = new Map<string, HNHit>();
    for (const term of HN_SEARCH_TERMS) {
      const hits = await searchHN(term, lastTimestamp);
      for (const hit of hits) allHits.set(hit.objectID, hit);
      await new Promise((r) => setTimeout(r, 200));
    }
    const showHnHits = await searchShowHN(lastTimestamp);
    for (const hit of showHnHits) allHits.set(hit.objectID, hit);

    let newLeadsCount = 0;
    let highIntentCount = 0;
    const errors: string[] = [];

    for (const hit of allHits.values()) {
      const text = `${hit.title} ${hit.story_text || ""}`;
      const matchResult = matchKeywords(text, keywords);
      if (matchResult.score === "noise") continue;

      const postUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const isShowHN = hit._tags?.includes("show_hn");

      // Use correct leads table schema: external_id, url, score, num_comments, lead_score, posted_at
      const { error } = await supabase.from("leads").upsert(
        {
          source: "hackernews",
          external_id: hit.objectID,
          subreddit: isShowHN ? "Show HN" : "Hacker News",
          title: hit.title,
          body: hit.story_text ? hit.story_text.replace(/<[^>]+>/g, "") : null,
          url: hit.url || postUrl,
          author: hit.author,
          score: hit.points || 0,
          num_comments: hit.num_comments || 0,
          lead_score: matchResult.score,
          score_value: matchResult.scoreValue,
          matched_keywords: matchResult.matched,
          status: "new",
          posted_at: hit.created_at,
        },
        { onConflict: "source,external_id", ignoreDuplicates: true }
      );

      if (!error) {
        newLeadsCount++;
        if (matchResult.score === "high" || matchResult.score === "medium") {
          highIntentCount++;
          try { await sendTelegramNotification(hit, matchResult); }
          catch (e) { console.error("Telegram failed:", e); }
        }
      } else {
        console.error(`HN upsert error for ${hit.objectID}:`, error.message);
        errors.push(`${hit.objectID}: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        postsScanned: allHits.size,
        newLeads: newLeadsCount,
        highIntent: highIntentCount,
        errors: errors.length,
        errorDetails: errors.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("HN collector error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
