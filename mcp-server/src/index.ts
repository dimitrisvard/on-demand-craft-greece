#!/usr/bin/env node
/**
 * Microns Hub Lead Monitor MCP Server
 * Exposes lead monitoring tools to Claude via Model Context Protocol
 *
 * Supports both stdio (Claude Desktop) and HTTP (Claude Cowork / remote)
 *
 * Usage:
 *   stdio: node build/index.js
 *   http:  node build/index.js --http --port 3001
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Environment
const SUPABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) must be set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== Helper: format lead for display =====
function formatLead(lead: any): string {
  const score = lead.manual_score || lead.auto_score;
  const scoreEmoji = { high: "🔴", medium: "🟡", low: "🟢" }[score as string] || "⚪";
  const statusEmoji = { new: "🆕", reviewed: "👁", contacted: "✉️", saved: "📌", dismissed: "❌", converted: "✅" }[lead.status as string] || "•";

  return [
    `${scoreEmoji} [${score?.toUpperCase()}] ${lead.title}`,
    `   ${statusEmoji} Status: ${lead.status} | Source: ${lead.subreddit || lead.source}`,
    `   👤 ${lead.author || "unknown"} | ⏰ ${new Date(lead.discovered_at).toLocaleString()}`,
    lead.matched_keywords?.length ? `   🏷 ${lead.matched_keywords.slice(0, 5).join(", ")}` : "",
    `   🔗 ${lead.source_url}`,
    `   ID: ${lead.id}`,
  ].filter(Boolean).join("\n");
}

// ===== Create MCP Server =====
const server = new McpServer({
  name: "micronshub-leads",
  version: "1.0.0",
  description: "Microns Hub lead monitoring system — query, score, and manage manufacturing leads from Reddit, Hacker News, and forums",
});

// ===== Tool 1: get_leads =====
server.tool(
  "get_leads",
  "Get leads from the monitoring system. Filter by source, score, status, date range, or keyword.",
  {
    source: z.enum(["reddit", "hackernews", "twitter", "forum", "all"]).optional().default("all"),
    score: z.enum(["high", "medium", "low", "unscored", "all"]).optional().default("all"),
    status: z.enum(["new", "reviewed", "contacted", "saved", "dismissed", "converted", "all"]).optional().default("all"),
    industry: z.string().optional(),
    keyword: z.string().optional(),
    limit: z.number().optional().default(20),
    days_back: z.number().optional().default(1),
  },
  async ({ source, score, status, industry, keyword, limit, days_back }) => {
    let query = supabase
      .from("leads")
      .select("*")
      .order("discovered_at", { ascending: false })
      .limit(limit);

    if (source !== "all") query = query.eq("source", source);
    if (score !== "all") query = query.eq("auto_score", score);
    if (status !== "all") query = query.eq("status", status);
    if (industry) query = query.contains("industry_tags", [industry]);
    if (keyword) query = query.contains("matched_keywords", [keyword]);
    if (days_back > 0) {
      const since = new Date(Date.now() - days_back * 86400 * 1000).toISOString();
      query = query.gte("discovered_at", since);
    }

    const { data, error, count } = await query;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No leads found matching the specified criteria." }] };
    }

    const formatted = data.map(formatLead).join("\n\n");
    return {
      content: [{
        type: "text",
        text: `Found ${data.length} leads:\n\n${formatted}`,
      }],
    };
  }
);

// ===== Tool 2: get_lead_detail =====
server.tool(
  "get_lead_detail",
  "Get full details of a specific lead including post body, matched keywords, notes, and activity history.",
  {
    lead_id: z.string().describe("The lead UUID"),
  },
  async ({ lead_id }) => {
    const [leadRes, activityRes] = await Promise.all([
      supabase.from("leads").select("*").eq("id", lead_id).single(),
      supabase.from("lead_activity").select("*").eq("lead_id", lead_id).order("created_at", { ascending: false }),
    ]);

    if (leadRes.error || !leadRes.data) {
      return { content: [{ type: "text", text: `Lead not found: ${lead_id}` }] };
    }

    const lead = leadRes.data;
    const activity = activityRes.data || [];

    const text = [
      `=== LEAD DETAIL ===`,
      `ID: ${lead.id}`,
      `Title: ${lead.title}`,
      `Source: ${lead.source} — ${lead.subreddit || ""}`,
      `Author: ${lead.author || "unknown"} (${lead.author_url || ""})`,
      `Score: ${lead.manual_score || lead.auto_score} ${lead.manual_score ? "(manual override)" : "(auto)"}`,
      `Status: ${lead.status}`,
      `Post URL: ${lead.source_url}`,
      `Upvotes: ${lead.upvotes} | Comments: ${lead.comments_count}`,
      `Posted: ${lead.post_created_at ? new Date(lead.post_created_at).toLocaleString() : "unknown"}`,
      `Discovered: ${new Date(lead.discovered_at).toLocaleString()}`,
      ``,
      `Keywords matched: ${(lead.matched_keywords || []).join(", ")}`,
      `Categories: ${(lead.matched_categories || []).join(", ")}`,
      `Industry tags: ${(lead.industry_tags || []).join(", ") || "none"}`,
      ``,
      `=== POST BODY ===`,
      lead.body || "(no body text)",
      ``,
      lead.notes ? `=== NOTES ===\n${lead.notes}\n` : "",
      lead.suggested_response ? `=== SUGGESTED RESPONSE ===\n${lead.suggested_response}\n` : "",
      activity.length > 0 ? `=== ACTIVITY LOG ===\n${activity.map((a: any) => `${new Date(a.created_at).toLocaleString()} — ${a.action}: ${a.old_value || ""} → ${a.new_value || ""} (${a.performed_by})`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ===== Tool 3: score_lead =====
server.tool(
  "score_lead",
  "Manually score a lead as high, medium, or low intent. This overrides the automatic score.",
  {
    lead_id: z.string(),
    score: z.enum(["high", "medium", "low"]),
    notes: z.string().optional(),
  },
  async ({ lead_id, score, notes }) => {
    const updates: any = { manual_score: score, updated_at: new Date().toISOString() };
    if (notes) updates.notes = notes;

    const { error } = await supabase.from("leads").update(updates).eq("id", lead_id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    await supabase.from("lead_activity").insert({
      lead_id,
      action: "scored",
      new_value: score,
      performed_by: "mcp",
    });

    return { content: [{ type: "text", text: `✅ Lead ${lead_id} scored as ${score.toUpperCase()}${notes ? " with notes" : ""}.` }] };
  }
);

// ===== Tool 4: update_lead_status =====
server.tool(
  "update_lead_status",
  "Update the status of a lead (new, reviewed, contacted, saved, dismissed, converted).",
  {
    lead_id: z.string(),
    status: z.enum(["new", "reviewed", "contacted", "saved", "dismissed", "converted"]),
    notes: z.string().optional(),
  },
  async ({ lead_id, status, notes }) => {
    const updates: any = { status, updated_at: new Date().toISOString() };
    if (notes) updates.notes = notes;

    const { error } = await supabase.from("leads").update(updates).eq("id", lead_id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    await supabase.from("lead_activity").insert({
      lead_id,
      action: "status_changed",
      new_value: status,
      performed_by: "mcp",
    });

    return { content: [{ type: "text", text: `✅ Lead ${lead_id} status updated to: ${status}` }] };
  }
);

// ===== Tool 5: save_response_draft =====
server.tool(
  "save_response_draft",
  "Save a drafted response for a lead. Claude can draft this based on the lead context and Microns Hub offerings.",
  {
    lead_id: z.string(),
    response_text: z.string(),
    platform: z.enum(["reddit", "hackernews", "twitter", "linkedin", "email", "other"]).optional(),
  },
  async ({ lead_id, response_text, platform }) => {
    const updates: any = {
      suggested_response: response_text,
      updated_at: new Date().toISOString(),
    };
    if (platform) updates.response_platform = platform;

    const { error } = await supabase.from("leads").update(updates).eq("id", lead_id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    await supabase.from("lead_activity").insert({
      lead_id,
      action: "response_drafted",
      new_value: platform || "unspecified platform",
      performed_by: "mcp",
    });

    return {
      content: [{
        type: "text",
        text: `✅ Response draft saved for lead ${lead_id}.\n\nDraft:\n${response_text}`,
      }],
    };
  }
);

// ===== Tool 6: add_lead_note =====
server.tool(
  "add_lead_note",
  "Add a note or observation to a lead.",
  {
    lead_id: z.string(),
    note: z.string(),
  },
  async ({ lead_id, note }) => {
    // Append to existing notes
    const { data: existing } = await supabase.from("leads").select("notes").eq("id", lead_id).single();
    const existingNotes = existing?.notes || "";
    const newNotes = existingNotes
      ? `${existingNotes}\n\n[${new Date().toLocaleString()}] ${note}`
      : `[${new Date().toLocaleString()}] ${note}`;

    const { error } = await supabase.from("leads").update({
      notes: newNotes,
      updated_at: new Date().toISOString(),
    }).eq("id", lead_id);

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    await supabase.from("lead_activity").insert({
      lead_id,
      action: "note_added",
      new_value: note.slice(0, 200),
      performed_by: "mcp",
    });

    return { content: [{ type: "text", text: `✅ Note added to lead ${lead_id}.` }] };
  }
);

// ===== Tool 7: get_lead_stats =====
server.tool(
  "get_lead_stats",
  "Get summary statistics: total leads, by source, by score, by status, conversion rate, and trends.",
  {
    days_back: z.number().optional().default(7),
  },
  async ({ days_back }) => {
    const since = new Date(Date.now() - days_back * 86400 * 1000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const [periodData, totalCount] = await Promise.all([
      supabase.from("leads").select("source, auto_score, manual_score, status, discovered_at").gte("discovered_at", since),
      supabase.from("leads").select("id", { count: "exact", head: true }),
    ]);

    const data = periodData.data || [];
    const bySource: Record<string, number> = {};
    const byScore: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const daily: Record<string, number> = {};

    for (const l of data) {
      bySource[l.source] = (bySource[l.source] || 0) + 1;
      const score = l.manual_score || l.auto_score;
      byScore[score] = (byScore[score] || 0) + 1;
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      const day = l.discovered_at?.slice(0, 10);
      if (day) daily[day] = (daily[day] || 0) + 1;
    }

    const todayCount = daily[today] || 0;
    const converted = byStatus["converted"] || 0;
    const convRate = data.length > 0 ? Math.round((converted / data.length) * 100) : 0;

    const text = [
      `📊 LEAD STATS — Last ${days_back} Days`,
      ``,
      `Total (all time): ${totalCount.count || 0}`,
      `Period total: ${data.length}`,
      `Today: ${todayCount}`,
      ``,
      `BY SOURCE:`,
      ...Object.entries(bySource).map(([s, n]) => `  ${s}: ${n}`),
      ``,
      `BY SCORE:`,
      `  🔴 High: ${byScore["high"] || 0}`,
      `  🟡 Medium: ${byScore["medium"] || 0}`,
      `  🟢 Low: ${byScore["low"] || 0}`,
      `  ⚪ Unscored: ${byScore["unscored"] || 0}`,
      ``,
      `BY STATUS:`,
      ...Object.entries(byStatus).map(([s, n]) => `  ${s}: ${n}`),
      ``,
      `Conversion rate: ${convRate}% (${converted} converted)`,
      ``,
      `DAILY VOLUME (last 7 days):`,
      ...Object.entries(daily).sort().slice(-7).map(([d, n]) => `  ${d}: ${n} leads`),
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ===== Tool 8: search_leads =====
server.tool(
  "search_leads",
  "Full-text search across lead titles and bodies.",
  {
    query: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ query, limit }) => {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .or(`title.ilike.%${query}%,body.ilike.%${query}%`)
      .order("discovered_at", { ascending: false })
      .limit(limit);

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: `No leads found matching: "${query}"` }] };
    }

    const formatted = data.map(formatLead).join("\n\n");
    return {
      content: [{
        type: "text",
        text: `Found ${data.length} leads matching "${query}":\n\n${formatted}`,
      }],
    };
  }
);

// ===== Tool 9: manage_keywords =====
server.tool(
  "manage_keywords",
  "Add, remove, or list monitored keywords for lead detection.",
  {
    action: z.enum(["list", "add", "remove", "toggle"]),
    keyword: z.string().optional(),
    category: z.string().optional().describe("One of: sourcing_intent, competitor_mentions, competitor_complaints, material_specific, competition_teams, geographic_europe"),
    keyword_id: z.number().optional().describe("Keyword ID for remove/toggle actions"),
    is_active: z.boolean().optional().describe("For toggle action"),
  },
  async ({ action, keyword, category, keyword_id, is_active }) => {
    if (action === "list") {
      const { data } = await supabase
        .from("lead_keywords")
        .select("*")
        .order("category")
        .order("weight", { ascending: false });

      if (!data || data.length === 0) return { content: [{ type: "text", text: "No keywords configured." }] };

      const byCategory: Record<string, any[]> = {};
      for (const kw of data) {
        if (!byCategory[kw.category]) byCategory[kw.category] = [];
        byCategory[kw.category].push(kw);
      }

      const text = Object.entries(byCategory)
        .map(([cat, kws]) =>
          `${cat.toUpperCase()}:\n${kws.map((k) => `  [${k.id}] ${k.is_active ? "✓" : "✗"} "${k.keyword}" (w${k.weight}, matched ${k.match_count}x)`).join("\n")}`
        )
        .join("\n\n");

      return { content: [{ type: "text", text: `ACTIVE KEYWORDS:\n\n${text}` }] };
    }

    if (action === "add") {
      if (!keyword || !category) return { content: [{ type: "text", text: "keyword and category are required for add action" }] };
      const { data, error } = await supabase.from("lead_keywords").insert({ keyword, category, weight: 2 }).select().single();
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Added keyword: "${keyword}" in category "${category}" (ID: ${data.id})` }] };
    }

    if (action === "remove") {
      if (!keyword_id) return { content: [{ type: "text", text: "keyword_id is required for remove action" }] };
      const { error } = await supabase.from("lead_keywords").delete().eq("id", keyword_id);
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Keyword ${keyword_id} removed.` }] };
    }

    if (action === "toggle") {
      if (!keyword_id || is_active === undefined) return { content: [{ type: "text", text: "keyword_id and is_active are required for toggle action" }] };
      const { error } = await supabase.from("lead_keywords").update({ is_active }).eq("id", keyword_id);
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Keyword ${keyword_id} ${is_active ? "enabled" : "disabled"}.` }] };
    }

    return { content: [{ type: "text", text: "Unknown action" }] };
  }
);

// ===== Tool 10: manage_subreddits =====
server.tool(
  "manage_subreddits",
  "Add, remove, or list monitored subreddits.",
  {
    action: z.enum(["list", "add", "remove", "toggle"]),
    subreddit: z.string().optional(),
    tier: z.number().optional().describe("1-5, where 1 scans most frequently (every 15 min)"),
    subreddit_id: z.number().optional().describe("Subreddit ID for remove/toggle actions"),
    is_active: z.boolean().optional().describe("For toggle action"),
  },
  async ({ action, subreddit, tier, subreddit_id, is_active }) => {
    if (action === "list") {
      const { data } = await supabase
        .from("monitored_subreddits")
        .select("*")
        .order("tier")
        .order("subreddit");

      if (!data || data.length === 0) return { content: [{ type: "text", text: "No subreddits configured." }] };

      const byTier: Record<number, any[]> = {};
      for (const s of data) {
        if (!byTier[s.tier]) byTier[s.tier] = [];
        byTier[s.tier].push(s);
      }

      const intervalMap: Record<number, string> = { 1: "15min", 2: "30min", 3: "30min", 4: "60min", 5: "2hr" };
      const text = Object.entries(byTier)
        .map(([t, subs]) =>
          `TIER ${t} (every ${intervalMap[parseInt(t)] || "?"}):\n${subs.map((s) => `  [${s.id}] ${s.is_active ? "✓" : "✗"} r/${s.subreddit} — last scan: ${s.last_scanned_at ? new Date(s.last_scanned_at).toLocaleString() : "never"}`).join("\n")}`
        )
        .join("\n\n");

      return { content: [{ type: "text", text: `MONITORED SUBREDDITS:\n\n${text}` }] };
    }

    if (action === "add") {
      if (!subreddit) return { content: [{ type: "text", text: "subreddit is required" }] };
      const cleanName = subreddit.replace(/^r\//, "");
      const scanTier = tier || 3;
      const intervalMap: Record<number, number> = { 1: 15, 2: 30, 3: 30, 4: 60, 5: 120 };
      const { data, error } = await supabase.from("monitored_subreddits").insert({
        subreddit: cleanName,
        tier: scanTier,
        scan_interval_minutes: intervalMap[scanTier] || 30,
      }).select().single();
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Added r/${cleanName} as Tier ${scanTier} (ID: ${data.id})` }] };
    }

    if (action === "remove") {
      if (!subreddit_id) return { content: [{ type: "text", text: "subreddit_id is required" }] };
      const { error } = await supabase.from("monitored_subreddits").delete().eq("id", subreddit_id);
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Subreddit ${subreddit_id} removed.` }] };
    }

    if (action === "toggle") {
      if (!subreddit_id || is_active === undefined) return { content: [{ type: "text", text: "subreddit_id and is_active are required" }] };
      const { error } = await supabase.from("monitored_subreddits").update({ is_active }).eq("id", subreddit_id);
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      return { content: [{ type: "text", text: `✅ Subreddit ${subreddit_id} ${is_active ? "enabled" : "disabled"}.` }] };
    }

    return { content: [{ type: "text", text: "Unknown action" }] };
  }
);

// ===== Tool 11: scan_directory =====
server.tool(
  "scan_directory",
  "Scan Europages or wlw for companies matching a search URL. Returns a list of discovered companies and stores them in the database.",
  {
    url: z.string().describe("Search results URL from Europages (e.g. https://www.europages.co.uk/companies/germany/robotics.html) or wlw (e.g. https://www.wlw.com/en/search/robotics/country/germany)"),
    maxPages: z.number().optional().default(3).describe("Maximum number of result pages to scan (default 3)"),
    enrichProfiles: z.boolean().optional().default(false).describe("Visit each company profile to get website URL and contact details (slower but more data)"),
  },
  async ({ url, maxPages, enrichProfiles }) => {
    // Detect source
    const source = url.toLowerCase().includes("europages") ? "europages"
      : (url.toLowerCase().includes("wlw.") ? "wlw" : "unknown");

    if (source === "unknown") {
      return { content: [{ type: "text", text: "❌ URL not recognized. Supported: europages.co.uk/de/fr/etc, wlw.com/de" }] };
    }

    // Build page URLs and scan via the Vercel API
    const siteUrl = process.env.SITE_URL || "https://www.micronshub.eu";
    let totalFound = 0;
    let totalNew = 0;
    const errors: string[] = [];

    function buildPageUrl(baseUrl: string, page: number): string {
      if (page === 1) return baseUrl;
      if (source === "europages") {
        const cleaned = baseUrl.replace(/\/p-\d+\.html$/, ".html").replace(/\.html$/, "");
        return `${cleaned}/p-${page}.html`;
      }
      const cleaned = baseUrl.replace(/\/page\/\d+/, "").replace(/\/$/, "");
      return `${cleaned}/page/${page}`;
    }

    for (let pg = 1; pg <= maxPages; pg++) {
      const pageUrl = buildPageUrl(url, pg);
      try {
        const resp = await fetch(`${siteUrl}/api/scan-directory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pageUrl, source }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          errors.push(`Page ${pg}: ${(err as any).error || "unknown"}`);
          if (resp.status === 429 || resp.status === 403) break;
          continue;
        }

        const data: any = await resp.json();
        const companies = data.companies || [];
        if (companies.length === 0) break;

        totalFound += companies.length;

        // Upsert into Supabase
        const { data: upserted, error: upsertErr } = await supabase
          .from("company_leads")
          .upsert(companies, { onConflict: "source,source_url", ignoreDuplicates: false })
          .select("id");

        if (upsertErr) {
          errors.push(`Page ${pg} DB: ${upsertErr.message}`);
        } else {
          totalNew += upserted?.length || 0;
        }

        if (!data.hasNextPage) break;

        // Rate limiting
        await new Promise(r => setTimeout(r, source === "wlw" ? 4000 : 2500));
      } catch (err: any) {
        errors.push(`Page ${pg}: ${err.message}`);
      }
    }

    const text = [
      `✅ Directory scan complete`,
      `Source: ${source.toUpperCase()}`,
      `URL: ${url}`,
      `Pages scanned: up to ${maxPages}`,
      `Companies found: ${totalFound}`,
      `Companies stored (new): ${totalNew}`,
      enrichProfiles ? `Note: Profile enrichment requested — run enrich_company_emails separately for website scraping.` : "",
      errors.length > 0 ? `\n⚠️ Errors:\n${errors.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ===== Tool 12: get_companies =====
server.tool(
  "get_companies",
  "Get companies from the directory scanner database. Filter by source, country, email status, or outreach status.",
  {
    source: z.enum(["europages", "wlw", "all"]).optional().default("all"),
    country: z.string().optional().describe("Filter by country (partial match)"),
    outreach_status: z.enum(["new", "email_found", "contacted", "responded", "converted", "not_relevant", "all"]).optional().default("all"),
    email_status: z.enum(["pending", "scraped", "no_emails", "failed", "all"]).optional().default("all"),
    search: z.string().optional().describe("Search by company name"),
    limit: z.number().optional().default(20),
  },
  async ({ source, country, outreach_status, email_status, search, limit }) => {
    let query = supabase
      .from("company_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (source !== "all") query = query.eq("source", source);
    if (outreach_status !== "all") query = query.eq("outreach_status", outreach_status);
    if (email_status !== "all") query = query.eq("email_scrape_status", email_status);
    if (country) query = query.ilike("country", `%${country}%`);
    if (search) query = query.ilike("company_name", `%${search}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No companies found matching the criteria." }] };
    }

    const formatted = data.map((c: any) => [
      `🏢 ${c.company_name} [${c.source.toUpperCase()}]`,
      `   📍 ${[c.city, c.country].filter(Boolean).join(", ") || "Location unknown"}`,
      c.website_url ? `   🌐 ${c.website_url}` : "",
      c.scraped_emails?.length ? `   📧 ${c.scraped_emails.join(", ")}` : (c.email ? `   📧 ${c.email} (directory)` : ""),
      c.phone ? `   📞 ${c.phone}` : "",
      c.employee_count ? `   👥 ${c.employee_count} employees` : "",
      `   Status: ${c.outreach_status} | Email: ${c.email_scrape_status}`,
      `   ID: ${c.id}`,
    ].filter(Boolean).join("\n")).join("\n\n");

    return {
      content: [{ type: "text", text: `Found ${data.length} companies:\n\n${formatted}` }],
    };
  }
);

// ===== Tool 13: enrich_company_emails =====
server.tool(
  "enrich_company_emails",
  "Trigger email scraping for companies that have a website URL but no emails yet. Uses the existing website email scraper.",
  {
    company_ids: z.array(z.string()).optional().describe("Specific company IDs to enrich"),
    country: z.string().optional().describe("Enrich all pending companies from this country"),
    limit: z.number().optional().default(10).describe("Max companies to enrich (default 10)"),
  },
  async ({ company_ids, country, limit }) => {
    let query = supabase
      .from("company_leads")
      .select("id, company_name, website_url")
      .not("website_url", "is", null)
      .eq("email_scrape_status", "pending")
      .limit(limit);

    if (company_ids && company_ids.length > 0) {
      query = supabase
        .from("company_leads")
        .select("id, company_name, website_url")
        .in("id", company_ids)
        .not("website_url", "is", null);
    } else if (country) {
      query = query.ilike("country", `%${country}%`);
    }

    const { data: toEnrich, error } = await query;
    if (error) return { content: [{ type: "text", text: `Error fetching companies: ${error.message}` }] };
    if (!toEnrich || toEnrich.length === 0) {
      return { content: [{ type: "text", text: "No companies found to enrich (need website_url + pending status)." }] };
    }

    const siteUrl = process.env.SITE_URL || "https://www.micronshub.eu";
    const results: string[] = [];

    for (const company of toEnrich) {
      try {
        const resp = await fetch(`${siteUrl}/api/scrape-website`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: [company.website_url] }),
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const result = data.results?.[0];
          const emails: string[] = result?.emails || [];

          await supabase.from("company_leads").update({
            scraped_emails: emails,
            email_scrape_status: emails.length > 0 ? "scraped" : "no_emails",
            email_scraped_at: new Date().toISOString(),
            outreach_status: emails.length > 0 ? "email_found" : undefined,
          }).eq("id", company.id);

          results.push(`${emails.length > 0 ? "✅" : "⚠️"} ${company.company_name}: ${emails.length > 0 ? emails.join(", ") : "no emails found"}`);
        } else {
          results.push(`❌ ${company.company_name}: scraper returned ${resp.status}`);
          await supabase.from("company_leads").update({ email_scrape_status: "failed" }).eq("id", company.id);
        }
      } catch (err: any) {
        results.push(`❌ ${company.company_name}: ${err.message}`);
        await supabase.from("company_leads").update({ email_scrape_status: "failed" }).eq("id", company.id);
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    return {
      content: [{
        type: "text",
        text: `Email enrichment complete for ${toEnrich.length} companies:\n\n${results.join("\n")}`,
      }],
    };
  }
);

// ===== Tool 14: update_company =====
server.tool(
  "update_company",
  "Update a company lead's outreach status or add notes.",
  {
    company_id: z.string().describe("Company UUID"),
    outreach_status: z.enum(["new", "email_found", "contacted", "responded", "converted", "not_relevant"]).optional(),
    notes: z.string().optional().describe("Notes to add/replace"),
  },
  async ({ company_id, outreach_status, notes }) => {
    const updates: any = { updated_at: new Date().toISOString() };
    if (outreach_status) updates.outreach_status = outreach_status;
    if (notes) updates.outreach_notes = notes;
    if (outreach_status === "contacted") updates.contacted_at = new Date().toISOString();

    const { error } = await supabase.from("company_leads").update(updates).eq("id", company_id);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    return {
      content: [{
        type: "text",
        text: `✅ Company ${company_id} updated${outreach_status ? ` — status: ${outreach_status}` : ""}${notes ? " — notes saved" : ""}`,
      }],
    };
  }
);

// ===== Tool 15: get_saved_searches =====
server.tool(
  "get_saved_searches",
  "List all saved directory search configurations.",
  {},
  async () => {
    const { data, error } = await supabase
      .from("saved_searches")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No saved searches found." }] };
    }

    const formatted = data.map((s: any) => [
      `[${s.id}] ${s.name}`,
      `   Source: ${s.source.toUpperCase()} | Keyword: ${s.keyword || "-"} | Country: ${s.country || "-"}`,
      `   Max pages: ${s.max_pages} | Active: ${s.is_active ? "yes" : "no"}`,
      `   Last run: ${s.last_run_at ? new Date(s.last_run_at).toLocaleDateString() : "never"} | Found: ${s.last_run_count || 0}`,
      `   URL: ${s.search_url}`,
    ].join("\n")).join("\n\n");

    return { content: [{ type: "text", text: `SAVED SEARCHES (${data.length}):\n\n${formatted}` }] };
  }
);

// ===== Tool 16: run_saved_search =====
server.tool(
  "run_saved_search",
  "Re-run a saved search to find new companies.",
  {
    saved_search_id: z.number().describe("The saved search ID from get_saved_searches"),
  },
  async ({ saved_search_id }) => {
    const { data: ss, error } = await supabase
      .from("saved_searches")
      .select("*")
      .eq("id", saved_search_id)
      .single();

    if (error || !ss) {
      return { content: [{ type: "text", text: `Saved search not found: ${saved_search_id}` }] };
    }

    const source = ss.source;
    const siteUrl = process.env.SITE_URL || "https://www.micronshub.eu";
    let totalFound = 0;
    let totalNew = 0;
    const errors: string[] = [];

    function buildPageUrl(baseUrl: string, page: number): string {
      if (page === 1) return baseUrl;
      if (source === "europages") {
        const cleaned = baseUrl.replace(/\/p-\d+\.html$/, ".html").replace(/\.html$/, "");
        return `${cleaned}/p-${page}.html`;
      }
      const cleaned = baseUrl.replace(/\/page\/\d+/, "").replace(/\/$/, "");
      return `${cleaned}/page/${page}`;
    }

    for (let pg = 1; pg <= ss.max_pages; pg++) {
      const pageUrl = buildPageUrl(ss.search_url, pg);
      try {
        const resp = await fetch(`${siteUrl}/api/scan-directory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pageUrl, source }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          errors.push(`Page ${pg}: ${(err as any).error || "unknown"}`);
          if (resp.status === 429 || resp.status === 403) break;
          continue;
        }

        const data: any = await resp.json();
        const companies = data.companies || [];
        if (companies.length === 0) break;

        totalFound += companies.length;

        const { data: upserted, error: upsertErr } = await supabase
          .from("company_leads")
          .upsert(companies, { onConflict: "source,source_url", ignoreDuplicates: false })
          .select("id");

        if (upsertErr) errors.push(`DB: ${upsertErr.message}`);
        else totalNew += upserted?.length || 0;

        if (!data.hasNextPage) break;
        await new Promise(r => setTimeout(r, source === "wlw" ? 4000 : 2500));
      } catch (err: any) {
        errors.push(`Page ${pg}: ${err.message}`);
      }
    }

    // Update last_run
    await supabase.from("saved_searches").update({
      last_run_at: new Date().toISOString(),
      last_run_count: totalNew,
    }).eq("id", saved_search_id);

    const text = [
      `✅ Saved search "${ss.name}" complete`,
      `Found: ${totalFound} | New: ${totalNew}`,
      errors.length > 0 ? `Errors: ${errors.join("; ")}` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ===== Resources =====
server.resource(
  "leads://today",
  "leads://today",
  { description: "Summary of today's leads with counts by source and score" },
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("leads")
      .select("id, source, auto_score, status, title, discovered_at")
      .gte("discovered_at", today + "T00:00:00Z")
      .order("discovered_at", { ascending: false });

    const total = data?.length || 0;
    const byScore: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const l of data || []) {
      byScore[l.auto_score] = (byScore[l.auto_score] || 0) + 1;
      bySource[l.source] = (bySource[l.source] || 0) + 1;
    }

    const text = `TODAY'S LEADS — ${new Date().toLocaleDateString()}\n\n` +
      `Total: ${total}\n` +
      `High: ${byScore["high"] || 0} | Medium: ${byScore["medium"] || 0} | Low: ${byScore["low"] || 0}\n\n` +
      `By source: ${Object.entries(bySource).map(([s, n]) => `${s}=${n}`).join(", ")}\n\n` +
      (data?.slice(0, 5).map((l) => `• [${l.auto_score?.toUpperCase()}] ${l.title.slice(0, 60)}...`).join("\n") || "No leads yet today");

    return { contents: [{ uri: "leads://today", text, mimeType: "text/plain" }] };
  }
);

server.resource(
  "leads://keywords",
  "leads://keywords",
  { description: "Currently active monitoring keywords by category" },
  async () => {
    const { data } = await supabase.from("lead_keywords").select("*").eq("is_active", true).order("category");

    const byCategory: Record<string, string[]> = {};
    for (const kw of data || []) {
      if (!byCategory[kw.category]) byCategory[kw.category] = [];
      byCategory[kw.category].push(kw.keyword);
    }

    const text = Object.entries(byCategory)
      .map(([cat, kws]) => `${cat.toUpperCase()}:\n${kws.map((k) => `  • ${k}`).join("\n")}`)
      .join("\n\n");

    return { contents: [{ uri: "leads://keywords", text, mimeType: "text/plain" }] };
  }
);

server.resource(
  "leads://subreddits",
  "leads://subreddits",
  { description: "Currently monitored subreddits with scan tiers and intervals" },
  async () => {
    const { data } = await supabase.from("monitored_subreddits").select("*").eq("is_active", true).order("tier");

    const byTier: Record<number, string[]> = {};
    for (const s of data || []) {
      if (!byTier[s.tier]) byTier[s.tier] = [];
      byTier[s.tier].push(`r/${s.subreddit}`);
    }

    const intervalMap: Record<number, string> = { 1: "15min", 2: "30min", 3: "30min", 4: "60min", 5: "2hr" };
    const text = Object.entries(byTier)
      .map(([t, subs]) => `TIER ${t} (every ${intervalMap[parseInt(t)] || "?"}):\n${subs.join(", ")}`)
      .join("\n\n");

    return { contents: [{ uri: "leads://subreddits", text, mimeType: "text/plain" }] };
  }
);

// ===== Prompts =====
server.prompt(
  "draft_lead_response",
  "Draft a helpful, non-salesy response to a lead post on behalf of Microns Hub",
  [{ name: "lead_id", description: "The lead UUID to respond to", required: true }],
  async ({ lead_id }) => {
    const { data: lead } = await supabase.from("leads").select("*").eq("id", lead_id).single();

    if (!lead) {
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Lead not found: ${lead_id}` },
        }],
      };
    }

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Draft a response to this post on behalf of Microns Hub:

POST DETAILS:
Title: ${lead.title}
Source: ${lead.subreddit || lead.source}
Body: ${lead.body || "(no body)"}
Keywords matched: ${(lead.matched_keywords || []).join(", ")}

MICRONS HUB INFO:
- European on-demand manufacturing platform (micronshub.eu)
- Based in Heraklion, Greece — ships across all of Europe
- Services: CNC machining (3/4/5-axis), sheet metal fabrication (laser, plasma, waterjet, bending), 3D printing (FDM, SLA, SLS, MJF, DMLS/metal), injection molding, vacuum casting, die casting, surface finishing, rapid prototyping
- 200+ materials: aluminum (6061, 7075), stainless (304, 316L), titanium, PEEK, Delrin, Inconel and many more
- Certifications & inspection reports available
- Special: educational discounts and sponsorships for Formula Student / student teams

RESPONSE GUIDELINES:
1. Be genuinely helpful, not salesy
2. Answer their specific question or address their specific need first
3. Only mention Microns Hub if it's naturally relevant
4. If they're students/competition teams, mention our educational sponsorship program
5. Keep it under 200 words
6. Sound like a knowledgeable professional, not a sales pitch
7. Include a subtle mention of micronshub.eu at the end if appropriate

Draft the response now:`,
        },
      }],
    };
  }
);

server.prompt(
  "daily_lead_review",
  "Review today's leads and suggest actions for each high-intent lead",
  [],
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: leads } = await supabase
      .from("leads")
      .select("*")
      .gte("discovered_at", today + "T00:00:00Z")
      .in("auto_score", ["high", "medium"])
      .eq("status", "new")
      .order("auto_score");

    const leadsText = leads?.map(formatLead).join("\n\n") || "No unreviewed leads today.";

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Review today's unreviewed leads for Microns Hub and suggest the best actions:

${leadsText}

For each lead:
1. Assess how strong the buying intent is and why
2. Suggest whether to: respond, contact, save for later, or dismiss
3. If responding, suggest the key points to mention
4. Prioritize European leads and competition/student teams

Provide a concise, actionable review:`,
        },
      }],
    };
  }
);

// ═══════════════════════════════════════════════════════════════
// TENDER MONITOR TOOLS
// ═══════════════════════════════════════════════════════════════

function formatTender(t: any): string {
  const flagMap: Record<string, string> = {
    NL: "🇳🇱", IE: "🇮🇪", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹",
    ES: "🇪🇸", PL: "🇵🇱", BE: "🇧🇪", SE: "🇸🇪", AT: "🇦🇹",
    DK: "🇩🇰", FI: "🇫🇮", PT: "🇵🇹", RO: "🇷🇴", EE: "🇪🇪",
    NO: "🇳🇴", CZ: "🇨🇿", HU: "🇭🇺", HR: "🇭🇷", SK: "🇸🇰",
    SI: "🇸🇮", BG: "🇧🇬", LT: "🇱🇹", LV: "🇱🇻", CY: "🇨🇾",
    LU: "🇱🇺", MT: "🇲🇹",
  };
  const flag = flagMap[t.country_code] || "";
  const scoreEmoji = t.relevance_score >= 70 ? "🟢" : t.relevance_score >= 40 ? "🟡" : "⚫";
  const value = t.estimated_value_eur ? `€${Math.round(t.estimated_value_eur).toLocaleString()}` : "N/A";
  const deadline = t.submission_deadline ? new Date(t.submission_deadline).toLocaleDateString("en-GB") : "N/A";
  return [
    `${scoreEmoji} [${t.relevance_score}] ${flag} ${t.country_name} — ${t.title}`,
    `   🏢 ${t.buyer_name || "Unknown buyer"} | 💰 ${value} | 📅 ${deadline}`,
    `   Status: ${t.status} | CPV: ${(t.cpv_codes || []).slice(0, 2).join(", ") || "N/A"}`,
    `   Keywords: ${(t.matched_keywords || []).slice(0, 5).join(", ") || "none"}`,
    `   ID: ${t.id}`,
    t.portal_url ? `   🔗 ${t.portal_url}` : "",
  ].filter(Boolean).join("\n");
}

// ===== Tender Tool 1: get_tenders =====
server.tool(
  "get_tenders",
  "Get procurement tenders from EU national portals. Filter by country, CPV code, value range, deadline, relevance score.",
  {
    country: z.string().optional().describe("ISO 2-letter country code: DE, FR, NL, IT, ES, PL, etc."),
    cpv_prefix: z.string().optional().describe("CPV code category prefix, e.g. '42' for machinery, '44' for metal products"),
    min_value: z.number().optional().describe("Minimum estimated value in EUR"),
    max_value: z.number().optional().describe("Maximum estimated value in EUR"),
    min_score: z.number().optional().default(0).describe("Minimum relevance score (0-100)"),
    deadline_within_days: z.number().optional().describe("Only show tenders with deadline within N days"),
    status: z.enum(["new", "reviewed", "interested", "bidding", "won", "lost", "expired", "not_relevant", "all"]).optional().default("all"),
    relevant_only: z.boolean().optional().default(false),
    search: z.string().optional().describe("Text search across title, description, buyer name"),
    limit: z.number().optional().default(20),
  },
  async ({ country, cpv_prefix, min_value, max_value, min_score, deadline_within_days, status, relevant_only, search, limit }) => {
    let query = supabase
      .from("tenders")
      .select("*")
      .order("relevance_score", { ascending: false })
      .limit(limit);

    if (country) query = query.eq("country_code", country.toUpperCase());
    if (status && status !== "all") query = query.eq("status", status);
    if (relevant_only) query = query.eq("is_relevant", true);
    if (min_score && min_score > 0) query = query.gte("relevance_score", min_score);
    if (min_value) query = query.gte("estimated_value_eur", min_value);
    if (max_value) query = query.lte("estimated_value_eur", max_value);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,buyer_name.ilike.%${search}%`);
    if (deadline_within_days) {
      const future = new Date(Date.now() + deadline_within_days * 86400000).toISOString();
      query = query.gte("submission_deadline", new Date().toISOString()).lte("submission_deadline", future);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data || data.length === 0) return { content: [{ type: "text", text: "No tenders found." }] };

    let filtered = data;
    if (cpv_prefix) {
      filtered = data.filter((t: any) => (t.cpv_codes || []).some((c: string) => String(c).startsWith(cpv_prefix)));
    }

    return { content: [{ type: "text", text: `Found ${filtered.length} tenders:\n\n${filtered.map(formatTender).join("\n\n")}` }] };
  }
);

// ===== Tender Tool 2: get_tender_detail =====
server.tool(
  "get_tender_detail",
  "Get full details of a specific tender by its UUID.",
  { tender_id: z.string().describe("Tender UUID or short ID prefix (8 chars)") },
  async ({ tender_id }) => {
    let query = supabase.from("tenders").select("*");
    if (tender_id.length === 36) {
      query = query.eq("id", tender_id);
    } else {
      query = query.ilike("id", `${tender_id}%`);
    }
    const { data, error } = await query.limit(1).single();
    if (error || !data) return { content: [{ type: "text", text: `Tender not found: ${tender_id}` }] };

    const t = data;
    const text = [
      `=== TENDER DETAIL ===`,
      `ID: ${t.id}`,
      `Country: ${t.country_name} (${t.country_code})`,
      `Portal: ${t.portal_name}`,
      `Reference: ${t.tender_reference || "N/A"}`,
      `Title: ${t.title}`,
      `Buyer: ${t.buyer_name || "N/A"} (${t.buyer_type || "N/A"})`,
      ``,
      `CPV Codes: ${(t.cpv_codes || []).join(", ") || "N/A"}`,
      `Nature: ${t.nature_of_contract || "N/A"}`,
      `Procedure: ${t.procedure_type || "N/A"}`,
      ``,
      `Value: €${t.estimated_value_eur ? Math.round(t.estimated_value_eur).toLocaleString() : "N/A"}`,
      `Currency: ${t.currency || "EUR"}`,
      ``,
      `Published: ${t.publication_date ? new Date(t.publication_date).toLocaleDateString() : "N/A"}`,
      `Deadline: ${t.submission_deadline ? new Date(t.submission_deadline).toLocaleString() : "N/A"}`,
      `Place: ${t.place_of_performance || "N/A"} (NUTS: ${t.nuts_code || "N/A"})`,
      ``,
      `Relevance Score: ${t.relevance_score}/100`,
      `Is Relevant: ${t.is_relevant}`,
      `Matched Keywords: ${(t.matched_keywords || []).join(", ") || "none"}`,
      `Matched CPV: ${(t.matched_cpv || []).join(", ") || "none"}`,
      ``,
      `Status: ${t.status}`,
      t.notes ? `Notes: ${t.notes}` : "",
      `Discovered: ${new Date(t.discovered_at).toLocaleString()}`,
      ``,
      t.description ? `=== DESCRIPTION ===\n${t.description.substring(0, 800)}` : "",
      t.portal_url ? `\nPortal Link: ${t.portal_url}` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ===== Tender Tool 3: update_tender_status =====
server.tool(
  "update_tender_status",
  "Update the status of a tender (new, reviewed, interested, bidding, won, lost, expired, not_relevant) and optionally add notes.",
  {
    tender_id: z.string().describe("Tender UUID or short 8-char prefix"),
    status: z.enum(["new", "reviewed", "interested", "bidding", "won", "lost", "expired", "not_relevant"]),
    notes: z.string().optional(),
  },
  async ({ tender_id, status, notes }) => {
    let query = supabase.from("tenders");
    const updates: any = { status };
    if (notes !== undefined) updates.notes = notes;

    if (tender_id.length === 36) {
      await query.update(updates).eq("id", tender_id);
    } else {
      const { data } = await supabase.from("tenders").select("id").ilike("id", `${tender_id}%`).limit(1).single();
      if (!data) return { content: [{ type: "text", text: `Tender not found: ${tender_id}` }] };
      await supabase.from("tenders").update(updates).eq("id", data.id);
    }

    return { content: [{ type: "text", text: `✅ Tender ${tender_id} status updated to "${status}"${notes ? " with notes" : ""}.` }] };
  }
);

// ===== Tender Tool 4: get_tender_stats =====
server.tool(
  "get_tender_stats",
  "Get tender statistics: counts by country, by status, trends, high-score tenders.",
  { days_back: z.number().optional().default(30) },
  async ({ days_back }) => {
    const since = new Date(Date.now() - days_back * 86400000).toISOString();
    const [
      { count: total },
      { count: relevant },
      { count: recent },
      { data: byCountry },
      { data: highScore },
    ] = await Promise.all([
      supabase.from("tenders").select("*", { count: "exact", head: true }),
      supabase.from("tenders").select("*", { count: "exact", head: true }).eq("is_relevant", true),
      supabase.from("tenders").select("*", { count: "exact", head: true }).gte("discovered_at", since),
      supabase.from("tenders").select("country_code, country_name").eq("is_relevant", true),
      supabase.from("tenders").select("id, country_code, title, relevance_score, submission_deadline")
        .gte("relevance_score", 70).eq("status", "new")
        .order("relevance_score", { ascending: false }).limit(5),
    ]);

    const countryMap: Record<string, number> = {};
    (byCountry || []).forEach((t: any) => {
      countryMap[t.country_code] = (countryMap[t.country_code] || 0) + 1;
    });
    const topCountries = Object.entries(countryMap)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([cc, n]) => `  ${cc}: ${n}`)
      .join("\n");

    const topTenders = (highScore || [])
      .map((t: any) => `  [${t.relevance_score}] ${t.country_code}: ${t.title.substring(0, 60)}`)
      .join("\n");

    return {
      content: [{
        type: "text",
        text: `=== TENDER STATISTICS ===\n\nTotal: ${total || 0}\nRelevant: ${relevant || 0}\nLast ${days_back} days: ${recent || 0}\n\nTop countries (relevant):\n${topCountries || "  None"}\n\nTop unreviewed (score 70+):\n${topTenders || "  None"}`,
      }],
    };
  }
);

// ===== Tender Tool 5: search_tenders =====
server.tool(
  "search_tenders",
  "Full-text search across tender titles, descriptions, and buyer names.",
  {
    query: z.string().describe("Search text"),
    limit: z.number().optional().default(20),
    min_score: z.number().optional().default(0),
  },
  async ({ query: searchQuery, limit, min_score }) => {
    const { data, error } = await supabase
      .from("tenders")
      .select("*")
      .or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,buyer_name.ilike.%${searchQuery}%`)
      .gte("relevance_score", min_score)
      .order("relevance_score", { ascending: false })
      .limit(limit);

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data || data.length === 0) return { content: [{ type: "text", text: `No tenders matching "${searchQuery}".` }] };

    return { content: [{ type: "text", text: `Found ${data.length} tenders for "${searchQuery}":\n\n${data.map(formatTender).join("\n\n")}` }] };
  }
);

// ===== Tender Tool 6: get_connector_status =====
server.tool(
  "get_connector_status",
  "Check the status of all country connectors — last scan time, errors, active/inactive.",
  {},
  async () => {
    const { data, error } = await supabase
      .from("tender_connectors")
      .select("country_code, country_name, portal_name, access_method, is_active, last_scan_at, last_scan_count, last_error, scan_frequency_hours")
      .order("country_code");

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };

    const lines = (data || []).map((c: any) => {
      const hoursSince = c.last_scan_at ? Math.round((Date.now() - new Date(c.last_scan_at).getTime()) / 3600000) : null;
      const health = !c.is_active ? "⭕ inactive" : !c.last_scan_at ? "⏳ never scanned" : c.last_error ? "⚠️ error" : "✅ ok";
      return `${health} ${c.country_code} — ${c.portal_name} | ${hoursSince !== null ? `${hoursSince}h ago` : "never"} | ${c.last_scan_count || 0} found${c.last_error ? ` | ERR: ${c.last_error.substring(0, 60)}` : ""}`;
    });

    return { content: [{ type: "text", text: `=== CONNECTOR STATUS ===\n\n${lines.join("\n")}` }] };
  }
);

// ===== Tender Tool 7: trigger_country_scan =====
server.tool(
  "trigger_country_scan",
  "Manually trigger a scan for a specific country connector to fetch new tenders.",
  {
    country_code: z.string().describe("ISO 2-letter country code, e.g. DE, FR, NL"),
    api_base_url: z.string().optional().describe("Base URL of the API, defaults to https://micronshub.eu"),
  },
  async ({ country_code, api_base_url }) => {
    const baseUrl = api_base_url || "https://micronshub.eu";
    try {
      const resp = await fetch(`${baseUrl}/api/tender-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country_code: country_code.toUpperCase() }),
        signal: AbortSignal.timeout(55000),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { content: [{ type: "text", text: `Scan failed for ${country_code}: HTTP ${resp.status} — ${text.substring(0, 200)}` }] };
      }

      const result = await resp.json();
      return {
        content: [{
          type: "text",
          text: `✅ Scan complete for ${country_code}:\n  Found: ${result.tenders_found}\n  New: ${result.tenders_new}\n  Relevant: ${result.tenders_relevant}\n  Errors: ${(result.errors || []).join("; ") || "none"}\n  Duration: ${result.duration_ms}ms`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Scan error for ${country_code}: ${err.message}` }] };
    }
  }
);

// ===== Tender Tool 8: export_tenders_csv =====
server.tool(
  "export_tenders_csv",
  "Get a URL to download filtered tenders as CSV.",
  {
    country: z.string().optional(),
    min_score: z.number().optional(),
    status: z.string().optional(),
    relevant_only: z.boolean().optional(),
    api_base_url: z.string().optional(),
  },
  async ({ country, min_score, status, relevant_only, api_base_url }) => {
    const baseUrl = api_base_url || "https://micronshub.eu";
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (min_score) params.set("min_score", String(min_score));
    if (status) params.set("status", status);
    if (relevant_only) params.set("relevant_only", "true");
    const url = `${baseUrl}/api/tenders-export?${params.toString()}`;
    return { content: [{ type: "text", text: `CSV export URL:\n${url}\n\nOpen this URL in a browser to download the CSV file.` }] };
  }
);

// ===== Start server =====
async function main() {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http");

  if (useHttp) {
    // HTTP transport for Claude Cowork
    console.error("HTTP transport not yet available in this build. Use stdio transport.");
    console.error("For remote access, deploy this server behind a reverse proxy.");
    process.exit(1);
  } else {
    // stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Microns Hub Lead Monitor MCP server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
