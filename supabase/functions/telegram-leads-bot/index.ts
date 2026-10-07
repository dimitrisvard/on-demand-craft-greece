import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
// Agent approval buttons (Phase 4): rules in ./agent-callback.ts.
import { checkWebhookSecret, handleAgentCallback } from "./agent-callback.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")!;
const telegramWebhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const agentApprovalSecret = Deno.env.get("AGENT_APPROVAL_SECRET");
const agentDecisionUrl = Deno.env.get("AGENT_DECISION_URL");
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendMessage(chatId: string | number, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return resp.json();
}

async function handleCommand(command: string, chatId: number): Promise<string> {
  const cmd = command.split(" ")[0].replace(/^\//, "").toLowerCase();
  const arg = command.split("_").slice(1).join("_");

  if (cmd === "leads" || cmd === "start") {
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayLeads } = await supabase
      .from("leads").select("id, auto_score, status").gte("discovered_at", today + "T00:00:00Z");
    const total = todayLeads?.length || 0;
    const high = todayLeads?.filter((l) => l.auto_score === "high").length || 0;
    const medium = todayLeads?.filter((l) => l.auto_score === "medium").length || 0;
    const unreviewed = todayLeads?.filter((l) => l.status === "new").length || 0;
    return `📊 TODAY'S LEAD SUMMARY\n\nTotal: ${total} leads\n🔴 High Intent: ${high}\n🟡 Medium Intent: ${medium}\n📥 Unreviewed: ${unreviewed}\n\nCommands:\n/high — View high intent leads\n/stats — Full stats\n/digest — Medium lead digest`;
  }

  if (cmd === "high") {
    const { data: leads } = await supabase
      .from("leads").select("id, title, subreddit, source, author, discovered_at, source_url")
      .eq("auto_score", "high").eq("status", "new")
      .order("discovered_at", { ascending: false }).limit(5);
    if (!leads || leads.length === 0) return "✅ No unreviewed high intent leads.";
    let msg = `🔴 HIGH INTENT LEADS (${leads.length} unreviewed)\n\n`;
    for (const lead of leads) {
      const timeAgo = Math.round((Date.now() - new Date(lead.discovered_at).getTime()) / 60000);
      const time = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`;
      msg += `📌 ${lead.title.slice(0, 60)}...\n`;
      msg += ` ${lead.subreddit || lead.source} • ${time}\n`;
      msg += ` 🔗 ${lead.source_url}\n\n`;
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
    return `📊 LEAD STATS — Last 7 Days\n\nTotal Leads: ${total}\n\nBy Source:\n${Object.entries(bySource).map(([s, n]) => ` ${s}: ${n}`).join("\n")}\n\nBy Score:\n 🔴 High: ${byScore["high"] || 0}\n 🟡 Medium: ${byScore["medium"] || 0}\n 🟢 Low: ${byScore["low"] || 0}\n\nConverted: ${converted}\nConversion Rate: ${total ? Math.round((converted / total) * 100) : 0}%`;
  }

  if (cmd === "digest") {
    const { data: leads } = await supabase
      .from("leads").select("id, title, subreddit, source, auto_score, discovered_at")
      .eq("auto_score", "medium").eq("status", "new")
      .order("discovered_at", { ascending: false }).limit(10);
    if (!leads || leads.length === 0) return "No unreviewed medium intent leads.";
    let msg = `📊 MEDIUM INTENT DIGEST — ${leads.length} leads\n\n`;
    leads.forEach((lead, i) => { msg += `${i + 1}. [${lead.subreddit || lead.source}] ${lead.title.slice(0, 60)}...\n`; });
    msg += `\nOpen dashboard: /dashboard/leads`;
    return msg;
  }

  const leadActions = ["view", "contact", "save", "dismiss"];
  for (const action of leadActions) {
    if (cmd === action && arg) {
      if (action === "view") {
        const { data: lead } = await supabase.from("leads").select("*").eq("id", arg).maybeSingle();
        if (!lead) return `Lead ${arg} not found.`;
        return `📌 ${lead.title}\n\nSource: ${lead.subreddit || lead.source}\nAuthor: ${lead.author || "unknown"}\nScore: ${lead.manual_score || lead.auto_score}\nStatus: ${lead.status}\nKeywords: ${(lead.matched_keywords || []).slice(0, 5).join(", ")}\n\n${lead.body ? lead.body.slice(0, 500) + "..." : ""}\n\n🔗 ${lead.source_url}`;
      }
      const statusMap: Record<string, string> = { contact: "contacted", save: "saved", dismiss: "dismissed" };
      const newStatus = statusMap[action];
      if (newStatus) {
        await supabase.from("leads").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", arg);
        await supabase.from("lead_activity").insert({ lead_id: arg, action: "status_changed", new_value: newStatus, performed_by: "telegram" });
        return `✅ Lead marked as ${newStatus}.`;
      }
    }
  }

  return `Available commands:\n/leads — Today's summary\n/high — High intent leads\n/stats — 7-day stats\n/digest — Medium lead digest\n/keywords — Active keywords`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "POST") {
    // Updates need the X-Telegram-Bot-Api-Secret-Token header once TELEGRAM_WEBHOOK_SECRET is set.
    if (!checkWebhookSecret(req, telegramWebhookSecret)) return new Response("Unauthorized", { status: 401 });
    try {
      const update = await req.json();
      const agentCallback = update.callback_query;
      if (agentCallback) {
        await handleAgentCallback(agentCallback, {
          webhookSecret: telegramWebhookSecret,
          approvalSecret: agentApprovalSecret,
          decisionUrl: agentDecisionUrl,
          botToken: telegramBotToken,
          ownerChatId: telegramChatId,
          fetch,
          now: Date.now,
        });
        return new Response("OK", { status: 200 });
      }
      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const response = await handleCommand(update.message.text, chatId);
        await sendMessage(chatId, response);
      }
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Telegram webhook error:", error);
      return new Response("OK", { status: 200 });
    }
  }
  if (req.method === "GET") {
    const action = new URL(req.url).searchParams.get("action");
    if (action === "digest" && telegramChatId) {
      const response = await handleCommand("/digest", parseInt(telegramChatId));
      await sendMessage(telegramChatId, response);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "Telegram leads bot running" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response("Method not allowed", { status: 405 });
});
