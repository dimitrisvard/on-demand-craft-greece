import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let redditClientId = Deno.env.get("REDDIT_CLIENT_ID") || "";
let redditClientSecret = Deno.env.get("REDDIT_CLIENT_SECRET") || "";

async function ensureCredentials() {
  if (redditClientId && redditClientSecret) return;

  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["reddit_client_id", "reddit_client_secret"]);

  if (data) {
    for (const row of data) {
      if (row.key === "reddit_client_id") redditClientId = row.value;
      if (row.key === "reddit_client_secret") redditClientSecret = row.value;
    }
  }

  if (!redditClientId || !redditClientSecret) {
    throw new Error("Reddit API credentials not configured. Set them in Dashboard > Settings > Integrations.");
  }
}
const redditUserAgent = Deno.env.get("REDDIT_USER_AGENT") || "MicronsHubLeadMonitor/1.0 by MicronsHub";
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  url: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  subreddit_name_prefixed: string;
}

interface RedditResponse {
  data: {
    children: Array<{ data: RedditPost }>;
    after: string | null;
    before: string | null;
  };
}

// ===== Reddit OAuth =====
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const credentials = btoa(`${redditClientId}:${redditClientSecret}`);
  const resp = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": redditUserAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!resp.ok) {
    throw new Error(`Reddit auth failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ===== Keyword Matching =====
interface Keyword {
  keyword: string;
  category: string;
  weight: number;
}

async function loadKeywords(): Promise<Keyword[]> {
  const { data } = await supabase
    .from("lead_keywords")
    .select("keyword, category, weight")
    .eq("is_active", true);
  return data || [];
}

function matchKeywords(text: string, keywords: Keyword[]): { matched: string[]; categories: string[]; score: string } {
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

  // Scoring logic
  const categories = Array.from(matchedCategories);
  let autoScore = "noise";

  const hasSourcingIntent = categories.includes("sourcing_intent");
  const hasGeoEurope = categories.includes("geographic_europe");
  const hasCompetitorComplaint = categories.includes("competitor_complaints");
  const hasCompetitorMention = categories.includes("competitor_mentions");
  const hasMaterialSpecific = categories.includes("material_specific");
  const hasCompetitionTeam = categories.includes("competition_teams");

  if (matchedKeywords.length === 0) {
    autoScore = "noise";
  } else if (
    (hasSourcingIntent && hasGeoEurope) ||
    hasCompetitorComplaint ||
    (hasSourcingIntent && hasCompetitionTeam) ||
    totalWeight >= 6
  ) {
    autoScore = "high";
  } else if (
    hasSourcingIntent ||
    (hasMaterialSpecific && matchedKeywords.length >= 2) ||
    hasCompetitionTeam ||
    totalWeight >= 3
  ) {
    autoScore = "medium";
  } else if (hasCompetitorMention || hasGeoEurope || totalWeight >= 1) {
    autoScore = "low";
  }

  return { matched: matchedKeywords, categories, score: autoScore };
}

// ===== Telegram notification =====
async function sendTelegramNotification(post: RedditPost, matchResult: { matched: string[]; categories: string[]; score: string }) {
  if (!telegramBotToken || !telegramChatId) return;

  const timeAgo = Math.round((Date.now() / 1000 - post.created_utc) / 60);
  const timeStr = timeAgo < 60 ? `${timeAgo} min ago` : `${Math.round(timeAgo / 60)} hr ago`;
  const excerpt = (post.selftext || "").slice(0, 300).replace(/\n/g, " ").trim();
  const postUrl = `https://reddit.com${post.permalink}`;

  const scoreEmoji = matchResult.score === "high" ? "🔴" : matchResult.score === "medium" ? "🟡" : "🟢";
  const message = `${scoreEmoji} ${matchResult.score.toUpperCase()} INTENT LEAD\n\n` +
    `📍 Source: r/${post.subreddit}\n` +
    `⏰ Posted: ${timeStr}\n` +
    `👤 Author: u/${post.author}\n\n` +
    `📌 Title: ${post.title}\n\n` +
    (excerpt ? `💬 Excerpt: "${excerpt}${post.selftext.length > 300 ? "..." : ""}"\n\n` : "") +
    `🏷 Keywords: ${matchResult.matched.slice(0, 5).join(", ")}\n` +
    `📊 Categories: ${matchResult.categories.join(", ")}\n\n` +
    `🔗 Post: ${postUrl}\n\n` +
    `Open Dashboard: /dashboard/leads`;

  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// ===== Main collector =====
async function collectSubreddit(subredditName: string, lastPostId: string | null, keywords: Keyword[]): Promise<{ newPosts: number; lastId: string | null }> {
  const token = await getRedditToken();

  let url = `https://oauth.reddit.com/r/${subredditName}/new.json?limit=25`;
  if (lastPostId) {
    url += `&before=t3_${lastPostId}`;
  }

  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": redditUserAgent,
    },
  });

  if (!resp.ok) {
    console.error(`Failed to fetch r/${subredditName}: ${resp.status}`);
    return { newPosts: 0, lastId: lastPostId };
  }

  const json: RedditResponse = await resp.json();
  const posts = json.data.children.map((c) => c.data);

  if (posts.length === 0) return { newPosts: 0, lastId: lastPostId };

  const newLastId = posts[0].id;
  let newPostsCount = 0;
  const highIntentPosts: Array<{ post: RedditPost; matchResult: { matched: string[]; categories: string[]; score: string } }> = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`;
    const matchResult = matchKeywords(text, keywords);

    if (matchResult.score === "noise") continue;

    const sourceUrl = `https://reddit.com${post.permalink}`;
    const postCreatedAt = new Date(post.created_utc * 1000).toISOString();

    // Upsert (dedup by source_url)
    const { error } = await supabase.from("leads").upsert({
      source: "reddit",
      source_url: sourceUrl,
      source_id: post.id,
      subreddit: `r/${post.subreddit}`,
      title: post.title,
      body: post.selftext || null,
      author: post.author,
      author_url: `https://reddit.com/u/${post.author}`,
      upvotes: post.score,
      comments_count: post.num_comments,
      auto_score: matchResult.score,
      matched_keywords: matchResult.matched,
      matched_categories: matchResult.categories,
      post_created_at: postCreatedAt,
    }, { onConflict: "source_url", ignoreDuplicates: true });

    if (!error) {
      newPostsCount++;
      if (matchResult.score === "high") {
        highIntentPosts.push({ post, matchResult });
      }
    }
  }

  // Send Telegram notifications for high-intent leads
  for (const { post, matchResult } of highIntentPosts) {
    try {
      await sendTelegramNotification(post, matchResult);
    } catch (e) {
      console.error("Telegram notification failed:", e);
    }
  }

  // Update keyword match counts
  const allMatchedKeywords = posts
    .flatMap((p) => matchKeywords(`${p.title} ${p.selftext}`, keywords).matched);
  if (allMatchedKeywords.length > 0) {
    const counts: Record<string, number> = {};
    for (const kw of allMatchedKeywords) {
      counts[kw] = (counts[kw] || 0) + 1;
    }
    for (const [keyword, count] of Object.entries(counts)) {
      await supabase.rpc("increment_keyword_match_count", { p_keyword: keyword, p_count: count }).maybeSingle();
    }
  }

  return { newPosts: newPostsCount, lastId: newLastId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Ensure Reddit credentials are available (env vars or app_settings fallback)
    await ensureCredentials();

    // Check Reddit credentials
    if (!redditClientId || !redditClientSecret) {
      return new Response(JSON.stringify({ error: "Reddit API credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse optional tier filter from request
    const url = new URL(req.url);
    const tierFilter = url.searchParams.get("tier");
    const maxTier = tierFilter ? parseInt(tierFilter) : 5;

    // Load active subreddits
    let query = supabase
      .from("monitored_subreddits")
      .select("subreddit, tier, last_post_id, scan_interval_minutes")
      .eq("is_active", true)
      .eq("source", "reddit")
      .lte("tier", maxTier);

    const { data: subreddits, error: subError } = await query;

    if (subError || !subreddits) {
      throw new Error(`Failed to load subreddits: ${subError?.message}`);
    }

    // Load keywords once
    const keywords = await loadKeywords();

    const results: Record<string, { newPosts: number; lastId: string | null }> = {};
    let totalNew = 0;

    // Process subreddits with rate limiting (max 60 req/min)
    for (const sub of subreddits) {
      try {
        const result = await collectSubreddit(sub.subreddit, sub.last_post_id, keywords);
        results[sub.subreddit] = result;
        totalNew += result.newPosts;

        // Update last_post_id and last_scanned_at
        await supabase
          .from("monitored_subreddits")
          .update({
            last_post_id: result.lastId,
            last_scanned_at: new Date().toISOString(),
          })
          .eq("subreddit", sub.subreddit);

        // Small delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 1100));
      } catch (e) {
        console.error(`Error collecting r/${sub.subreddit}:`, e);
        results[sub.subreddit] = { newPosts: 0, lastId: sub.last_post_id };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        subredditsScanned: subreddits.length,
        totalNewLeads: totalNew,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Reddit collector error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
