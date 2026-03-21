import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ['leads-api', 'leads' | 'keywords' | 'subreddits' | 'stats', ...]

  const resource = pathParts[1]; // leads, keywords, subreddits, stats
  const resourceId = pathParts[2]; // optional ID

  try {
    // ===================== LEADS =====================
    if (resource === "leads" || !resource) {
      if (req.method === "GET" && !resourceId) {
        // List leads with filters
        const source = url.searchParams.get("source");
        const score = url.searchParams.get("score");
        const status = url.searchParams.get("status");
        const industry = url.searchParams.get("industry");
        const keyword = url.searchParams.get("keyword");
        const daysBack = parseInt(url.searchParams.get("days_back") || "7");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const search = url.searchParams.get("search");

        let query = supabase
          .from("leads")
          .select("*", { count: "exact" })
          .order("discovered_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (source && source !== "all") query = query.eq("source", source);
        if (score && score !== "all") query = query.eq("auto_score", score);
        if (status && status !== "all") query = query.eq("status", status);
        if (industry) query = query.contains("industry_tags", [industry]);
        if (keyword) query = query.contains("matched_keywords", [keyword]);
        if (daysBack > 0) {
          const since = new Date(Date.now() - daysBack * 86400 * 1000).toISOString();
          query = query.gte("discovered_at", since);
        }
        if (search) {
          query = query.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
        }

        const { data, error, count } = await query;
        if (error) throw error;
        return jsonResponse({ leads: data, total: count, limit, offset });
      }

      if (req.method === "GET" && resourceId) {
        // Get single lead + activity
        const { data: lead, error } = await supabase.from("leads").select("*").eq("id", resourceId).single();
        if (error) return jsonResponse({ error: "Lead not found" }, 404);

        const { data: activity } = await supabase
          .from("lead_activity")
          .select("*")
          .eq("lead_id", resourceId)
          .order("created_at", { ascending: false });

        return jsonResponse({ lead, activity: activity || [] });
      }

      if (req.method === "PATCH" && resourceId) {
        // Update lead (score, status, notes, suggested_response)
        const body = await req.json();
        const allowedFields = ["manual_score", "auto_score", "status", "notes", "suggested_response", "response_sent_at", "response_platform", "industry_tags"];
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

        for (const field of allowedFields) {
          if (field in body) updates[field] = body[field];
        }

        // Get current values for activity log
        const { data: current } = await supabase.from("leads").select("status, manual_score, auto_score").eq("id", resourceId).single();

        const { data, error } = await supabase.from("leads").update(updates).eq("id", resourceId).select().single();
        if (error) return jsonResponse({ error: error.message }, 400);

        // Log activity
        if (body.status && current?.status !== body.status) {
          await supabase.from("lead_activity").insert({
            lead_id: resourceId,
            action: "status_changed",
            old_value: current?.status,
            new_value: body.status,
            performed_by: body.performed_by || "dashboard",
          });
        }
        if (body.manual_score) {
          await supabase.from("lead_activity").insert({
            lead_id: resourceId,
            action: "scored",
            old_value: current?.manual_score || current?.auto_score,
            new_value: body.manual_score,
            performed_by: body.performed_by || "dashboard",
          });
        }
        if (body.notes) {
          await supabase.from("lead_activity").insert({
            lead_id: resourceId,
            action: "note_added",
            new_value: body.notes,
            performed_by: body.performed_by || "dashboard",
          });
        }
        if (body.suggested_response) {
          await supabase.from("lead_activity").insert({
            lead_id: resourceId,
            action: "response_drafted",
            performed_by: body.performed_by || "dashboard",
          });
        }

        return jsonResponse({ lead: data });
      }

      if (req.method === "DELETE" && resourceId) {
        const { error } = await supabase.from("leads").delete().eq("id", resourceId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }
    }

    // ===================== STATS =====================
    if (resource === "stats") {
      const daysBack = parseInt(url.searchParams.get("days_back") || "7");
      const since = new Date(Date.now() - daysBack * 86400 * 1000).toISOString();

      const [bySource, byScore, byStatus, recent, total] = await Promise.all([
        supabase.from("leads").select("source").gte("discovered_at", since),
        supabase.from("leads").select("auto_score, manual_score").gte("discovered_at", since),
        supabase.from("leads").select("status").gte("discovered_at", since),
        supabase.from("leads").select("discovered_at, auto_score").gte("discovered_at", since).order("discovered_at", { ascending: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }),
      ]);

      const sourceCount: Record<string, number> = {};
      for (const r of bySource.data || []) {
        sourceCount[r.source] = (sourceCount[r.source] || 0) + 1;
      }

      const scoreCount: Record<string, number> = {};
      for (const r of byScore.data || []) {
        const score = r.manual_score || r.auto_score;
        scoreCount[score] = (scoreCount[score] || 0) + 1;
      }

      const statusCount: Record<string, number> = {};
      for (const r of byStatus.data || []) {
        statusCount[r.status] = (statusCount[r.status] || 0) + 1;
      }

      // Daily lead volume
      const dailyVolume: Record<string, number> = {};
      for (const r of recent.data || []) {
        const day = r.discovered_at.slice(0, 10);
        dailyVolume[day] = (dailyVolume[day] || 0) + 1;
      }

      // Today stats
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayCount = dailyVolume[todayStr] || 0;

      return jsonResponse({
        total_all_time: total.count,
        period_days: daysBack,
        period_total: bySource.data?.length || 0,
        today: todayCount,
        by_source: sourceCount,
        by_score: scoreCount,
        by_status: statusCount,
        daily_volume: dailyVolume,
        conversion_rate: statusCount["converted"]
          ? Math.round((statusCount["converted"] / (bySource.data?.length || 1)) * 100)
          : 0,
      });
    }

    // ===================== KEYWORDS =====================
    if (resource === "keywords") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("lead_keywords")
          .select("*")
          .order("category", { ascending: true })
          .order("weight", { ascending: false });
        if (error) throw error;
        return jsonResponse({ keywords: data });
      }

      if (req.method === "POST") {
        const body = await req.json();
        if (!body.keyword || !body.category) {
          return jsonResponse({ error: "keyword and category are required" }, 400);
        }
        const { data, error } = await supabase.from("lead_keywords").insert({
          keyword: body.keyword,
          category: body.category,
          weight: body.weight || 1,
        }).select().single();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ keyword: data }, 201);
      }

      if (req.method === "PATCH" && resourceId) {
        const body = await req.json();
        const { data, error } = await supabase
          .from("lead_keywords")
          .update({ is_active: body.is_active, weight: body.weight })
          .eq("id", resourceId)
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ keyword: data });
      }

      if (req.method === "DELETE" && resourceId) {
        const { error } = await supabase.from("lead_keywords").delete().eq("id", resourceId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }
    }

    // ===================== SUBREDDITS =====================
    if (resource === "subreddits") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("monitored_subreddits")
          .select("*")
          .order("tier", { ascending: true })
          .order("subreddit", { ascending: true });
        if (error) throw error;
        return jsonResponse({ subreddits: data });
      }

      if (req.method === "POST") {
        const body = await req.json();
        if (!body.subreddit) return jsonResponse({ error: "subreddit is required" }, 400);
        const { data, error } = await supabase.from("monitored_subreddits").insert({
          subreddit: body.subreddit.replace(/^r\//, ""),
          tier: body.tier || 3,
          scan_interval_minutes: body.scan_interval_minutes || 30,
          industry_tags: body.industry_tags || [],
        }).select().single();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ subreddit: data }, 201);
      }

      if (req.method === "PATCH" && resourceId) {
        const body = await req.json();
        const { data, error } = await supabase
          .from("monitored_subreddits")
          .update({
            tier: body.tier,
            scan_interval_minutes: body.scan_interval_minutes,
            is_active: body.is_active,
            industry_tags: body.industry_tags,
          })
          .eq("id", resourceId)
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ subreddit: data });
      }

      if (req.method === "DELETE" && resourceId) {
        const { error } = await supabase.from("monitored_subreddits").delete().eq("id", resourceId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }
    }

    // ===================== TRIGGER COLLECTORS =====================
    if (resource === "collect") {
      const source = url.searchParams.get("source") || "all";

      const results: Record<string, unknown> = {};

      if (source === "reddit" || source === "all") {
        try {
          const tier = url.searchParams.get("tier");
          const redditUrl = new URL(`${supabaseUrl}/functions/v1/reddit-collector`);
          if (tier) redditUrl.searchParams.set("tier", tier);
          const resp = await fetch(redditUrl.toString(), {
            headers: { "Authorization": `Bearer ${supabaseServiceKey}` },
          });
          results.reddit = await resp.json();
        } catch (e) {
          results.reddit = { error: e.message };
        }
      }

      if (source === "hackernews" || source === "all") {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/hn-collector`, {
            headers: { "Authorization": `Bearer ${supabaseServiceKey}` },
          });
          results.hackernews = await resp.json();
        } catch (e) {
          results.hackernews = { error: e.message };
        }
      }

      return jsonResponse({ success: true, results });
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    console.error("Leads API error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});
