// Follow-up email scheduler
// Invoked periodically (cron or manual) to send scheduled follow-up emails.
// Queries marketing_campaign_recipients where sequence_number > 1 and it's time to send.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const trackingDomain = Deno.env.get("TRACKING_DOMAIN") || "https://micronshub.eu";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseSpintax(text: string): string {
  if (!text || !text.includes("{")) return text;
  let result = text;
  let iterations = 0;
  while (/\{([^{}]+)\}/.test(result) && iterations < 10) {
    result = result.replace(/\{([^{}]+)\}/g, (_match, group) => {
      const options = group.split("|");
      if (options.length === 1) return `{${group}}`;
      return options[Math.floor(Math.random() * options.length)];
    });
    iterations++;
  }
  return result;
}

function replaceVariables(text: string, vars: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), value || "");
  }
  return result;
}

function injectTrackingPixel(html: string, eventId: string, campaignId: string): string {
  const url = `${trackingDomain}/api/marketing?action=track&type=open&eid=${eventId}&cid=${campaignId}`;
  const pixel = `<img src="${url}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (html.includes("</body>")) return html.replace("</body>", `${pixel}</body>`);
  return html + pixel;
}

function injectUnsubscribeLink(html: string, eventId: string, campaignId: string): string {
  const url = `${trackingDomain}/api/marketing?action=track&type=unsubscribe&eid=${eventId}&cid=${campaignId}`;
  const block = `
<div style="text-align:center;margin-top:32px;padding:16px;font-size:12px;color:#999;border-top:1px solid #eee;">
  <a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
</div>`;
  if (html.includes("</body>")) return html.replace("</body>", `${block}</body>`);
  return html + block;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("Processing follow-up emails...");

    // Find pending follow-ups that are due
    // A follow-up is due when: the initial email (seq 1) for that subscriber+campaign
    // was sent at least delay_days ago.
    const { data: pendingFollowUps, error } = await supabase
      .from("marketing_campaign_recipients")
      .select(`
        *,
        marketing_subscribers(id, email, name, status),
        marketing_campaigns(id, name, sender_account_ids)
      `)
      .eq("status", "pending")
      .gt("sequence_number", 1)
      .order("sequence_number", { ascending: true });

    if (error) throw error;
    if (!pendingFollowUps || pendingFollowUps.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending follow-ups", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let skipped = 0;

    for (const followUp of pendingFollowUps) {
      try {
        const sub = (followUp as any).marketing_subscribers;
        if (!sub || sub.status !== "active") {
          await supabase
            .from("marketing_campaign_recipients")
            .update({ status: "skipped" })
            .eq("id", followUp.id);
          skipped++;
          continue;
        }

        // Check if subscriber has replied (skip if replied)
        if (sub.replied_at) {
          await supabase
            .from("marketing_campaign_recipients")
            .update({ status: "skipped" })
            .eq("id", followUp.id);
          skipped++;
          continue;
        }

        // Find the previous sequence's sent_at to determine if delay has passed
        const prevSeq = followUp.sequence_number - 1;
        const { data: prevRecord } = await supabase
          .from("marketing_campaign_recipients")
          .select("sent_at, status")
          .eq("campaign_id", followUp.campaign_id)
          .eq("subscriber_id", followUp.subscriber_id)
          .eq("sequence_number", prevSeq)
          .maybeSingle();

        // If prev sequence doesn't exist, check marketing_events for seq=1
        let baseSentAt: Date | null = null;

        if (prevRecord?.sent_at) {
          baseSentAt = new Date(prevRecord.sent_at);
        } else if (prevSeq === 1) {
          // Look in marketing_events for the initial send
          const { data: sentEvent } = await supabase
            .from("marketing_events")
            .select("created_at")
            .eq("campaign_id", followUp.campaign_id)
            .eq("subscriber_id", followUp.subscriber_id)
            .eq("event_type", "sent")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (sentEvent) {
            baseSentAt = new Date(sentEvent.created_at);
          }
        }

        if (!baseSentAt) {
          // Previous sequence hasn't been sent yet — skip for now
          continue;
        }

        const dueDate = new Date(baseSentAt.getTime() + followUp.delay_days * 24 * 60 * 60 * 1000);
        if (new Date() < dueDate) {
          // Not yet due
          continue;
        }

        // Send the follow-up
        const vars: Record<string, string> = {
          name: sub.name || "there",
          email: sub.email,
          company: "",
        };

        let subject = replaceVariables(parseSpintax(followUp.custom_subject || "Following up"), vars);
        let body = replaceVariables(parseSpintax(followUp.custom_body || ""), vars);

        // Log sent event first
        const { data: sentEvent } = await supabase
          .from("marketing_events")
          .insert({
            campaign_id: followUp.campaign_id,
            subscriber_id: sub.id,
            event_type: "sent",
            metadata: { sequence_number: followUp.sequence_number, follow_up: true },
          })
          .select("id")
          .single();

        const eventId = sentEvent?.id;
        if (eventId) {
          body = injectTrackingPixel(body, eventId, followUp.campaign_id);
          body = injectUnsubscribeLink(body, eventId, followUp.campaign_id);
        }

        const { error: sendError } = await resend.emails.send({
          from: "Microns Hub <info@micronshub.eu>",
          to: [sub.email],
          subject,
          html: body,
        });

        if (sendError) {
          console.error(`Failed to send follow-up to ${sub.email}:`, sendError);
          await supabase
            .from("marketing_campaign_recipients")
            .update({ status: "failed" })
            .eq("id", followUp.id);
        } else {
          await supabase
            .from("marketing_campaign_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", followUp.id);
          processed++;
        }
      } catch (err) {
        console.error(`Error processing follow-up ${followUp.id}:`, err);
      }
    }

    console.log(`Follow-ups processed: ${processed}, skipped: ${skipped}`);

    return new Response(
      JSON.stringify({ message: "Follow-up processing complete", processed, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
