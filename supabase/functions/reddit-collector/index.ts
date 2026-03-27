import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// PullPush.io — free Reddit archive API (no auth needed, not blocked by Reddit)
const PULLPUSH_BASE = "https://api.pullpush.io/reddit/search/submission";

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
  const hasMaterialSpecific = categories.includes("material_specific") || categories.includes("industry_specific");
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
  const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`;
  const excerpt = (post.selftext || "").slice(0, 300).replace(/\n/g, " ").trim();
  const postUrl = `https://reddit.com${post.permalink}`;

  const scoreEmoji = matchResult.score === "high" ? "🔴" : matchResult.score === "medium" ? "🟡" : "🟢";
  const message = `${scoreEmoji} ${matchResult.score.toUpperCase()} LEAD\n\n` +
    `r/${post.subreddit} · ${timeStr} · u/${post.author}\n\n` +
    `${post.title}\n\n` +
    (excerpt ? `"${excerpt}${post.selftext.length > 300 ? "..." : ""}"\n\n` : "") +
    `Keywords: ${matchResult.matched.slice(0, 5).join(", ")}\n` +
    `${postUrl}`;

  try {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, disable_web_page_preview: true }),
    });
  } catch (_) { /* ignore telegram errors */ }
}

// ===== Fetch posts via PullPush.io =====
async function collectSubreddit(
  subredditName: string,
  lastScannedAt: string | null,
  keywords: Keyword[],
): Promise<{ newPosts: number; newestTimestamp: number | null }> {
  // Build PullPush URL: fetch posts from this subreddit, newest first
  const params = new URLSearchParams({
    subreddit: subredditName,
    sort: "new",
    sort_type: "created_utc",
    size: "100",
  });

  // For incremental fetching: only get posts newer than last scan
  if (lastScannedAt) {
    const afterEpoch = Math.floor(new Date(lastScannedAt).getTime() / 1000);
    params.set("after", String(afterEpoch));
  }

  const url = `${PULLPUSH_BASE}?${params.toString()}`;
  console.log(`Fetching: ${url}`);

  const resp = await fetch(url, {
    headers: { "User-Agent": "MicronsHubLeadMonitor/1.0" },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`PullPush error for r/${subredditName}: ${resp.status} — ${body.slice(0, 200)}`);
    return { newPosts: 0, newestTimestamp: null };
  }

  const json = await resp.json();
  // PullPush returns { data: [post, post, ...] }
  const posts: RedditPost[] = json.data ?? [];

  console.log(`r/${subredditName}: ${posts.length} posts fetched from PullPush`);

  if (posts.length === 0) return { newPosts: 0, newestTimestamp: null };

  // Track the newest post timestamp for incremental fetching
  let newestTimestamp = 0;
  let newPostsCount = 0;

  for (const post of posts) {
    if (post.created_utc > newestTimestamp) newestTimestamp = post.created_utc;

    const text = `${post.title} ${post.selftext || ""}`;
    const matchResult = matchKeywords(text, keywords);
    if (matchResult.score === "noise") continue;

    const permalink = post.permalink || `/r/${post.subreddit}/comments/${post.id}/`;
    const sourceUrl = `https://reddit.com${permalink}`;
    const postCreatedAt = new Date(post.created_utc * 1000).toISOString();

    const { error } = await supabase.from("leads").upsert({
      source: "reddit",
      external_id: post.id,
      source_url: sourceUrl,
      source_id: post.id,
      subreddit: `r/${post.subreddit}`,
      title: post.title,
      body: post.selftext || null,
      url: sourceUrl,
      author: post.author,
      author_url: `https://reddit.com/u/${post.author}`,
      score: post.score,
      num_comments: post.num_comments,
      upvotes: post.score,
      comments_count: post.num_comments,
      lead_score: matchResult.score,
      auto_score: matchResult.score,
      matched_keywords: matchResult.matched,
      matched_categories: matchResult.categories,
      post_created_at: postCreatedAt,
      posted_at: postCreatedAt,
    }, { onConflict: "source_url", ignoreDuplicates: true });

    if (!error) {
      newPostsCount++;
      if (matchResult.score === "high") {
        await sendTelegramNotification(post, matchResult);
      }
    } else {
      console.error(`Upsert error for ${post.id}:`, error.message);
    }
  }

  // Update keyword match counts
  const allMatched = posts.flatMap((p) => matchKeywords(`${p.title} ${p.selftext || ""}`, keywords).matched);
  if (allMatched.length > 0) {
    const counts: Record<string, number> = {};
    for (const kw of allMatched) counts[kw] = (counts[kw] || 0) + 1;
    for (const [keyword, count] of Object.entries(counts)) {
      await supabase.rpc("increment_keyword_match_count", { p_keyword: keyword, p_count: count }).maybeSingle();
    }
  }

  console.log(`r/${subredditName}: ${newPostsCount} new leads saved (of ${posts.length} fetched)`);
  return { newPosts: newPostsCount, newestTimestamp };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // ===== Single subreddit targeted scan (e.g. ?subreddit=engineering) =====
    const targetSubreddit = url.searchParams.get("subreddit");
    if (targetSubreddit) {
      const keywords = await loadKeywords();

      // Get last scan time (if exists)
      const { data: sub } = await supabase
        .from("monitored_subreddits")
        .select("subreddit, last_scanned_at")
        .eq("subreddit", targetSubreddit)
        .single();

      // For targeted scan, always fetch last 100 posts regardless of last scan
      const result = await collectSubreddit(targetSubreddit, null, keywords);

      // Update last_scanned_at
      if (sub) {
        await supabase.from("monitored_subreddits")
          .update({ last_scanned_at: new Date().toISOString() })
          .eq("subreddit", targetSubreddit);
      }

      return new Response(
        JSON.stringify({ success: true, subredditsScanned: 1, totalNewLeads: result.newPosts, results: { [targetSubreddit]: result } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== Batch scan: tier-based =====
    const tierFilter = url.searchParams.get("tier");
    const maxTier = tierFilter ? parseInt(tierFilter) : 5;
    // Cap at 40 subreddits to stay within edge function timeout (~1s per sub)
    const maxSubreddits = parseInt(url.searchParams.get("max") || "40");

    const { data: allSubreddits, error: subError } = await supabase
      .from("monitored_subreddits")
      .select("subreddit, tier, scan_interval_minutes, last_scanned_at")
      .eq("is_active", true)
      .eq("source", "reddit")
      .lte("tier", maxTier)
      .order("tier", { ascending: true });

    if (subError || !allSubreddits) {
      throw new Error(`Failed to load subreddits: ${subError?.message}`);
    }

    // Only scan subreddits due for a refresh
    const now = Date.now();
    const subreddits = allSubreddits
      .filter((sub) => {
        if (!sub.last_scanned_at) return true;
        const intervalMs = (sub.scan_interval_minutes || 30) * 60 * 1000;
        return now - new Date(sub.last_scanned_at).getTime() >= intervalMs;
      })
      .slice(0, maxSubreddits);

    console.log(`Batch scan: ${subreddits.length} due (of ${allSubreddits.length} total, tier <= ${maxTier})`);

    const keywords = await loadKeywords();
    const results: Record<string, { newPosts: number }> = {};
    let totalNew = 0;

    for (const sub of subreddits) {
      try {
        const result = await collectSubreddit(sub.subreddit, sub.last_scanned_at, keywords);
        results[sub.subreddit] = { newPosts: result.newPosts };
        totalNew += result.newPosts;

        await supabase.from("monitored_subreddits")
          .update({ last_scanned_at: new Date().toISOString() })
          .eq("subreddit", sub.subreddit);

        // PullPush has generous rate limits, but add small delay
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        console.error(`Error collecting r/${sub.subreddit}:`, e);
        results[sub.subreddit] = { newPosts: 0 };
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
