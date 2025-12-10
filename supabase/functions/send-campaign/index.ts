import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendCampaignRequest {
  campaign_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { campaign_id } = await req.json() as SendCampaignRequest;

    if (!campaign_id) {
      throw new Error("Campaign ID is required");
    }

    // 1. Fetch Campaign Details
    const { data: campaign, error: campaignError } = await supabase
      .from("marketing_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign not found: ${campaignError?.message}`);
    }

    // 2. Fetch Active Subscribers
    const { data: subscribers, error: subscribersError } = await supabase
      .from("marketing_subscribers")
      .select("*")
      .eq("status", "active");

    if (subscribersError || !subscribers) {
      throw new Error(`Failed to fetch subscribers: ${subscribersError?.message}`);
    }

    // 3. Prepare Batch Sending Logic
    // Resend supports batch sending, or we can loop. For simplicity and limits, we loop here 
    // but in production, batching or queues is better. 
    // Note: Resend Free tier has limits (100 emails/day). 
    
    let sentCount = 0;
    const errors: any[] = [];

    // Simple loop for now - consider Resend Batch API for higher volume
    for (const subscriber of subscribers) {
        try {
            // Determine Subject (A/B Test Logic can be added here)
            // For now, default to subject_a
            let subject = campaign.subject_a;

            // Basic A/B Logic: 50/50 split if enabled (simplified)
            if (campaign.ab_test_config?.enabled) {
               // Simple random split for demonstration
               if (Math.random() > 0.5 && campaign.subject_b) {
                   subject = campaign.subject_b;
               }
            }

            const { data, error } = await resend.emails.send({
                from: "Microns Hub <info@micronshub.eu>",
                to: [subscriber.email],
                subject: subject,
                html: campaign.body, // Assuming body is HTML from Quill
                // reply_to: "support@micronshub.eu" // Optional
            });

            if (error) {
                console.error(`Failed to send to ${subscriber.email}:`, error);
                errors.push({ email: subscriber.email, error });
                 // Log bounce/failure event
                 await supabase.from("marketing_events").insert({
                    campaign_id: campaign.id,
                    subscriber_id: subscriber.id,
                    event_type: "bounced", // or failed
                    metadata: { error }
                });
            } else {
                sentCount++;
                // Log sent event
                await supabase.from("marketing_events").insert({
                    campaign_id: campaign.id,
                    subscriber_id: subscriber.id,
                    event_type: "sent",
                    metadata: { resend_id: data?.id }
                });
            }

        } catch (err) {
            console.error(`Exception sending to ${subscriber.email}:`, err);
             errors.push({ email: subscriber.email, error: err });
        }
    }

    // 4. Update Campaign Status
    await supabase
        .from("marketing_campaigns")
        .update({ 
            status: "sent", 
            sent_count: sentCount,
            updated_at: new Date().toISOString()
        })
        .eq("id", campaign_id);

    return new Response(
      JSON.stringify({ 
        message: "Campaign processing complete", 
        sent: sentCount, 
        errors: errors.length 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});

