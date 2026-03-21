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
