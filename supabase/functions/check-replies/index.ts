// Reply detection for Google Workspace accounts
// Checks Gmail inboxes for replies to campaign emails.
// Marks subscribers who replied — follow-ups will be skipped for them.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(account: any): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = account.provider_config?.refresh_token;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  const data = await resp.json();
  if (!resp.ok || data.error) return null;
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Fetch Google Workspace accounts
    const { data: googleAccounts, error } = await supabase
      .from("marketing_sender_accounts")
      .select("*")
      .eq("provider", "google_workspace")
      .eq("is_active", true);

    if (error) throw error;
    if (!googleAccounts || googleAccounts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No Google Workspace accounts to check" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let repliesFound = 0;

    for (const account of googleAccounts) {
      try {
        let accessToken = account.provider_config?.access_token;

        // Check if token is expired
        const expiry = account.provider_config?.token_expiry;
        if (!accessToken || (expiry && new Date(expiry) <= new Date())) {
          accessToken = await refreshGoogleToken(account);
          if (!accessToken) {
            console.warn(`Cannot refresh token for ${account.email}, skipping`);
            continue;
          }
        }

        // Search for recent replies in Gmail (last 7 days)
        // Query: messages from subscribers that are replies (in:inbox)
        const searchQuery = `in:inbox after:${Math.floor(Date.now() / 1000) - 7 * 24 * 3600}`;

        const listResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(searchQuery)}&maxResults=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!listResp.ok) {
          console.error(`Gmail API error for ${account.email}:`, await listResp.text());
          continue;
        }

        const listData = await listResp.json();
        const messages = listData.messages || [];

        for (const msg of messages) {
          // Get message details (headers only, minimal)
          const msgResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=In-Reply-To`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (!msgResp.ok) continue;

          const msgData = await msgResp.json();
          const headers = msgData.payload?.headers || [];

          const fromHeader = headers.find((h: any) => h.name === "From")?.value || "";
          const inReplyTo = headers.find((h: any) => h.name === "In-Reply-To")?.value;

          // Extract email from From header
          const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/(\S+@\S+)/);
          const senderEmail = emailMatch ? emailMatch[1] : null;

          if (!senderEmail || !inReplyTo) continue;

          // Check if sender is in our subscribers
          const { data: subscriber } = await supabase
            .from("marketing_subscribers")
            .select("id, email, replied_at")
            .eq("email", senderEmail.toLowerCase())
            .maybeSingle();

          if (!subscriber || subscriber.replied_at) continue;

          // Mark subscriber as replied
          await supabase
            .from("marketing_subscribers")
            .update({ replied_at: new Date().toISOString() })
            .eq("id", subscriber.id);

          // Log reply event in marketing_events (best-effort campaign lookup)
          await supabase.from("marketing_events").insert({
            subscriber_id: subscriber.id,
            campaign_id: null, // We can't easily determine which campaign without more context
            event_type: "replied",
            metadata: {
              gmail_message_id: msg.id,
              from_account: account.email,
            },
          }).catch(() => null); // Ignore if campaign_id null violates FK

          console.log(`Reply detected from ${senderEmail}`);
          repliesFound++;
        }
      } catch (accountErr) {
        console.error(`Error checking replies for ${account.email}:`, accountErr);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Reply check complete",
        accounts_checked: googleAccounts.length,
        replies_found: repliesFound,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
