import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendMessage(chatId: string | number, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  return resp.json();
}

async function handleCommand(command: string, chatId: number): Promise<string> {
  const cmd = command.split(" ")[0].replace(/^\//, "").toLowerCase();
  const arg = command.split("_").slice(1).join("_"); // For /view_UUID etc.

  if (cmd === "leads" || cmd === "start") {
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayLeads } = await supabase
      .from("leads")
      .select("id, auto_score, status")
      .gte("discovered_at", today + "T00:00:00Z");

    const total = todayLeads?.length || 0;
    const high = todayLeads?.filter((l) => l.auto_score === "high").length || 0;
    const medium = todayLeads?.filter((l) => l.auto_score === "medium").length || 0;
    const unreviewed = todayLeads?.filter((l) => l.status === "new").length || 0;

    return `📊 TODAY'S LEAD SUMMARY\n\n` +
      `Total: ${total} leads\n` +
      `🔴 High Intent: ${high}\n` +
      `🟡 Medium Intent: ${medium}\n` +
      `📥 Unreviewed: ${unreviewed}\n\n` +
      `Commands:\n` +
      `/high — View high intent leads\n` +
      `/stats — Full stats\n` +
      `/digest — Medium lead digest`;
  }

  if (cmd === "high") {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, title, subreddit, source, author, discovered_at, source_url")
      .eq("auto_score", "high")
      .eq("status", "new")
      .order("discovered_at", { ascending: false })
      .limit(5);

    if (!leads || leads.length === 0) return "✅ No unreviewed high intent leads.";

    let msg = `🔴 HIGH INTENT LEADS (${leads.length} unreviewed)\n\n`;
    for (const lead of leads) {
      const timeAgo = Math.round((Date.now() - new Date(lead.discovered_at).getTime()) / 60000);
      const time = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`;
      msg += `📌 ${lead.title.slice(0, 60)}...\n`;
      msg += `   ${lead.subreddit || lead.source} • ${time}\n`;
      msg += `   🔗 ${lead.source_url}\n\n`;
    }
    return msg;
  }

  if (cmd === "stats") {
    const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: leads } = await supabase.from("leads").select("source, auto_score, status").gte("discovered_at", since7);

    const total = leads?.length || 0;
    const bySource: Record<string, number> = {};
    const byScore: Record<string, number> = {};
    for (const l of leads || []) {
      bySource[l.source] = (bySource[l.source] || 0) + 1;
      byScore[l.auto_score] = (byScore[l.auto_score] || 0) + 1;
    }
    const converted = leads?.filter((l) => l.status === "converted").length || 0;

    return `📊 LEAD STATS — Last 7 Days\n\n` +
      `Total Leads: ${total}\n\n` +
      `By Source:\n${Object.entries(bySource).map(([s, n]) => `  ${s}: ${n}`).join("\n")}\n\n` +
      `By Score:\n  🔴 High: ${byScore["high"] || 0}\n  🟡 Medium: ${byScore["medium"] || 0}\n  🟢 Low: ${byScore["low"] || 0}\n\n` +
      `Converted: ${converted}\n` +
      `Conversion Rate: ${total ? Math.round((converted / total) * 100) : 0}%`;
  }

  if (cmd === "digest") {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, title, subreddit, source, auto_score, discovered_at")
      .eq("auto_score", "medium")
      .eq("status", "new")
      .order("discovered_at", { ascending: false })
      .limit(10);

    if (!leads || leads.length === 0) return "No unreviewed medium intent leads.";

    let msg = `📊 MEDIUM INTENT DIGEST — ${leads.length} leads\n\n`;
    leads.forEach((lead, i) => {
      msg += `${i + 1}. [${lead.subreddit || lead.source}] ${lead.title.slice(0, 60)}...\n`;
    });
    msg += `\nOpen dashboard: /dashboard/leads`;
    return msg;
  }

  // Handle lead-specific commands: /view_UUID, /contact_UUID, /save_UUID, /dismiss_UUID
  const leadActions = ["view", "contact", "save", "dismiss"];
  for (const action of leadActions) {
    if (cmd === action && arg) {
      const leadId = arg;
      if (action === "view") {
        const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
        if (!lead) return `Lead ${leadId} not found.`;
        return `📌 ${lead.title}\n\n` +
          `Source: ${lead.subreddit || lead.source}\n` +
          `Author: ${lead.author || "unknown"}\n` +
          `Score: ${lead.manual_score || lead.auto_score}\n` +
          `Status: ${lead.status}\n` +
          `Keywords: ${(lead.matched_keywords || []).slice(0, 5).join(", ")}\n\n` +
          `${lead.body ? lead.body.slice(0, 500) + "..." : ""}\n\n` +
          `🔗 ${lead.source_url}`;
      }

      const statusMap: Record<string, string> = {
        contact: "contacted",
        save: "saved",
        dismiss: "dismissed",
      };

      const newStatus = statusMap[action];
      if (newStatus) {
        const { error } = await supabase
          .from("leads")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", leadId);

        if (error) return `Failed to update lead: ${error.message}`;

        await supabase.from("lead_activity").insert({
          lead_id: leadId,
          action: "status_changed",
          new_value: newStatus,
          performed_by: "telegram",
        });

        return `✅ Lead marked as ${newStatus}.`;
      }
    }
  }

  if (cmd === "keywords") {
    const { data: keywords } = await supabase
      .from("lead_keywords")
      .select("keyword, category")
      .eq("is_active", true)
      .order("category");

    if (!keywords || keywords.length === 0) return "No active keywords configured.";

    const byCategory: Record<string, string[]> = {};
    for (const kw of keywords) {
      if (!byCategory[kw.category]) byCategory[kw.category] = [];
      byCategory[kw.category].push(kw.keyword);
    }

    let msg = `🔍 ACTIVE KEYWORDS\n\n`;
    for (const [cat, kws] of Object.entries(byCategory)) {
      msg += `${cat}:\n${kws.slice(0, 5).map((k) => `  • ${k}`).join("\n")}\n`;
      if (kws.length > 5) msg += `  ... and ${kws.length - 5} more\n`;
      msg += "\n";
    }
    return msg;
  }

  return `Available commands:\n` +
    `/leads — Today's summary\n` +
    `/high — High intent leads\n` +
    `/medium — Medium intent leads\n` +
    `/stats — 7-day stats\n` +
    `/digest — Medium lead digest\n` +
    `/keywords — Active keywords\n` +
    `/view_<id> — View lead details\n` +
    `/contact_<id> — Mark as contacted\n` +
    `/save_<id> — Save lead\n` +
    `/dismiss_<id> — Dismiss lead`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle Telegram webhook
  if (req.method === "POST") {
    try {
      const update = await req.json();

      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const response = await handleCommand(text, chatId);
        await sendMessage(chatId, response);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Telegram webhook error:", error);
      return new Response("OK", { status: 200 }); // Always return 200 to Telegram
    }
  }

  // GET: Send a digest manually
  if (req.method === "GET") {
    const action = new URL(req.url).searchParams.get("action");

    if (action === "digest" && telegramChatId) {
      const response = await handleCommand("/digest", parseInt(telegramChatId));
      await sendMessage(telegramChatId, response);
      return new Response(JSON.stringify({ success: true, message: response }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "Telegram bot is running" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
});
