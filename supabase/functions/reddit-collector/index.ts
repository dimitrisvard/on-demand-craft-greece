import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Use a descriptive user-agent as required by Reddit's API terms
const redditUserAgent = Deno.env.get("REDDIT_USER_AGENT") || "MicronsHubLeadMonitor/1.0 by MicronsHub";
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
}

interface RedditResponse {
  data: {
    children: Array<{ data: RedditPost }>;
    after: string | null;
    before: string | null;
  };
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
    `📍 r/${post.subreddit}\n` +
    `⏰ ${timeStr}  👤 u/${post.author}\n\n` +
    `📌 ${post.title}\n\n` +
    (excerpt ? `💬 "${excerpt}${post.selftext.length > 300 ? "..." : ""}"\n\n` : "") +
    `🏷 ${matchResult.matched.slice(0, 5).join(", ")}\n` +
    `🔗 ${postUrl}`;

  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });
}

// ===== Fetch from public Reddit JSON API (no OAuth required) =====
async function collectSubreddit(
  subredditName: string,
  lastPostId: string | null,
  keywords: Keyword[],
  forceAll = false,
): Promise<{ newPosts: number; lastId: string | null }> {
  // Use the public JSON endpoint — no API credentials needed
  let url = `https://www.reddit.com/r/${subredditName}/new.json?limit=100`;
  if (lastPostId && !forceAll) {
    url += `&before=t3_${lastPostId}`;
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": redditUserAgent },
  });

  if (!resp.ok) {
    console.error(`Failed to fetch r/${subredditName}: ${resp.status}`);
    return { newPosts: 0, lastId: lastPostId };
  }

  const json: RedditResponse = await resp.json();
  const posts = json.data?.children?.map((c) => c.data) ?? [];

  if (posts.length === 0) return { newPosts: 0, lastId: lastPostId };

  const newLastId = posts[0].id;
  let newPostsCount = 0;
  const highIntentPosts: Array<{ post: RedditPost; matchResult: ReturnType<typeof matchKeywords> }> = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`;
    const matchResult = matchKeywords(text, keywords);
    if (matchResult.score === "noise") continue;

    const sourceUrl = `https://reddit.com${post.permalink}`;
    const postCreatedAt = new Date(post.created_utc * 1000).toISOString();

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
      if (matchResult.score === "high") highIntentPosts.push({ post, matchResult });
    }
  }

  for (const { post, matchResult } of highIntentPosts) {
    try { await sendTelegramNotification(post, matchResult); } catch (_) { /* ignore */ }
  }

  // Update keyword match counts
  const allMatched = posts.flatMap((p) => matchKeywords(`${p.title} ${p.selftext}`, keywords).matched);
  if (allMatched.length > 0) {
    const counts: Record<string, number> = {};
    for (const kw of allMatched) counts[kw] = (counts[kw] || 0) + 1;
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
    const url = new URL(req.url);

    // Single subreddit targeted scan (e.g. ?subreddit=engineering)
    const targetSubreddit = url.searchParams.get("subreddit");
    if (targetSubreddit) {
      const keywords = await loadKeywords();
      const { data: sub } = await supabase
        .from("monitored_subreddits")
        .select("subreddit, last_post_id")
        .eq("subreddit", targetSubreddit)
        .single();

      const result = await collectSubreddit(sub?.subreddit ?? targetSubreddit, null, keywords, true);

      if (sub) {
        await supabase.from("monitored_subreddits")
          .update({ last_post_id: result.lastId, last_scanned_at: new Date().toISOString() })
          .eq("subreddit", targetSubreddit);
      }

      return new Response(JSON.stringify({ success: true, subredditsScanned: 1, totalNewLeads: result.newPosts, results: { [targetSubreddit]: result } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch scan: optional tier filter
    const tierFilter = url.searchParams.get("tier");
    const maxTier = tierFilter ? parseInt(tierFilter) : 5;
    // Cap at 40 to safely stay within edge function timeout (40 × ~2s = ~80s)
    const maxSubreddits = parseInt(url.searchParams.get("max") || "40");

    const { data: allSubreddits, error: subError } = await supabase
      .from("monitored_subreddits")
      .select("subreddit, tier, last_post_id, scan_interval_minutes, last_scanned_at")
      .eq("is_active", true)
      .eq("source", "reddit")
      .lte("tier", maxTier)
      .order("tier", { ascending: true });

    if (subError || !allSubreddits) {
      throw new Error(`Failed to load subreddits: ${subError?.message}`);
    }

    // Only scan subreddits due for a refresh based on their scan_interval_minutes
    const now = Date.now();
    const subreddits = allSubreddits
      .filter((sub) => {
        if (!sub.last_scanned_at) return true;
        const intervalMs = (sub.scan_interval_minutes || 30) * 60 * 1000;
        return now - new Date(sub.last_scanned_at).getTime() >= intervalMs;
      })
      .slice(0, maxSubreddits);

    const keywords = await loadKeywords();
    const results: Record<string, { newPosts: number; lastId: string | null }> = {};
    let totalNew = 0;

    for (const sub of subreddits) {
      try {
        const result = await collectSubreddit(sub.subreddit, sub.last_post_id, keywords);
        results[sub.subreddit] = result;
        totalNew += result.newPosts;

        await supabase.from("monitored_subreddits")
          .update({ last_post_id: result.lastId, last_scanned_at: new Date().toISOString() })
          .eq("subreddit", sub.subreddit);

        // ~2s delay for unauthenticated Reddit public API rate limit
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(`Error collecting r/${sub.subreddit}:`, e);
        results[sub.subreddit] = { newPosts: 0, lastId: sub.last_post_id };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        subredditsScanned: subreddits.length,
        subredditsSkipped: allSubreddits.length - subreddits.length,
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
