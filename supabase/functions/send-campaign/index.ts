import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const defaultResend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const trackingDomain = Deno.env.get("TRACKING_DOMAIN") || "https://micronshub.eu";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Spintax ──────────────────────────────────────────────────────────────────

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

// ─── Tracking ─────────────────────────────────────────────────────────────────

function injectTrackingPixel(html: string, eventId: string, campaignId: string): string {
  const url = `${trackingDomain}/api/track?type=open&eid=${eventId}&cid=${campaignId}`;
  const pixel = `<img src="${url}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (html.includes("</body>")) return html.replace("</body>", `${pixel}</body>`);
  return html + pixel;
}

function injectClickTracking(html: string, eventId: string, campaignId: string): string {
  return html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi, (_match, before, href, after) => {
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#") ||
      href.includes("/api/track") ||
      href.includes("unsubscribe")
    ) {
      return `<a ${before}href="${href}"${after}>`;
    }
    const trackUrl = `${trackingDomain}/api/track?type=click&eid=${eventId}&cid=${campaignId}&url=${encodeURIComponent(href)}`;
    return `<a ${before}href="${trackUrl}"${after}>`;
  });
}

function injectUnsubscribeLink(html: string, eventId: string, campaignId: string): string {
  const url = `${trackingDomain}/api/track?type=unsubscribe&eid=${eventId}&cid=${campaignId}`;
  const block = `
<div style="text-align:center;margin-top:32px;padding:16px;font-size:12px;color:#999;border-top:1px solid #eee;">
  <p style="margin:0 0 4px;">You received this email because you subscribed to our mailing list.</p>
  <p style="margin:0;"><a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe</a></p>
</div>`;
  if (html.includes("</body>")) return html.replace("</body>", `${block}</body>`);
  return html + block;
}

// ─── Google Workspace Sender ───────────────────────────────────────────────────

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
  if (!resp.ok || data.error) {
    console.error("Failed to refresh Google token:", data);
    return null;
  }

  // Update stored token
  await supabase
    .from("marketing_sender_accounts")
    .update({
      provider_config: {
        ...account.provider_config,
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      },
    })
    .eq("id", account.id);

  return data.access_token;
}

async function sendViaGoogle(
  account: any,
  to: string,
  subject: string,
  html: string
): Promise<{ id?: string; error?: any }> {
  let accessToken = account.provider_config?.access_token;

  // Check if token is expired
  const expiry = account.provider_config?.token_expiry;
  if (!accessToken || (expiry && new Date(expiry) <= new Date())) {
    accessToken = await refreshGoogleToken(account);
    if (!accessToken) return { error: "Failed to get Google access token" };
  }

  // Build RFC 2822 message
  const fromHeader = `${account.display_name} <${account.email}>`;
  const boundary = `boundary_${Date.now()}`;
  const rawMessage = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
    `--${boundary}--`,
  ].join("\r\n");

  // Base64url encode
  const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    }
  );

  const data = await resp.json();
  if (!resp.ok) return { error: data };
  return { id: data.id };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

interface SendCampaignRequest {
  campaign_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { campaign_id } = (await req.json()) as SendCampaignRequest;

    if (!campaign_id) throw new Error("Campaign ID is required");

    // 1. Fetch campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("marketing_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign not found: ${campaignError?.message}`);
    }

    // 2. Fetch marketing settings for unsubscribe preference
    const { data: settings } = await supabase
      .from("marketing_settings")
      .select("unsubscribe_link_enabled, tracking_domain")
      .maybeSingle();

    const unsubscribeEnabled = settings?.unsubscribe_link_enabled ?? true;
    const domain = settings?.tracking_domain || trackingDomain;

    // 3. Fetch sender accounts
    let senderAccounts: any[] = [];
    if (campaign.sender_account_ids && campaign.sender_account_ids.length > 0) {
      const { data: accounts } = await supabase
        .from("marketing_sender_accounts")
        .select("*")
        .in("id", campaign.sender_account_ids)
        .eq("is_active", true);
      senderAccounts = accounts || [];
    }

    // 4. Check for per-recipient CSV content
    const { data: csvRecipients } = await supabase
      .from("marketing_campaign_recipients")
      .select("*, marketing_subscribers(id, email, name, status, tags)")
      .eq("campaign_id", campaign_id)
      .eq("sequence_number", 1)
      .eq("status", "pending");

    // 5. Determine recipients
    let recipients: Array<{
      id: string;
      email: string;
      name: string | null;
      subject: string;
      body: string;
      recipientRecordId?: string;
    }> = [];

    if (csvRecipients && csvRecipients.length > 0) {
      // CSV import mode — use per-recipient custom content
      for (const record of csvRecipients) {
        const sub = (record as any).marketing_subscribers;
        if (!sub || sub.status !== "active") continue;
        recipients.push({
          id: sub.id,
          email: sub.email,
          name: sub.name,
          subject: record.custom_subject || campaign.subject_a,
          body: record.custom_body || campaign.body,
          recipientRecordId: record.id,
        });
      }
    } else {
      // Standard mode — tag-based targeting
      let query = supabase
        .from("marketing_subscribers")
        .select("*")
        .eq("status", "active");

      const { data: allSubscribers } = await query;
      if (!allSubscribers) throw new Error("Failed to fetch subscribers");

      let targetSubscribers = allSubscribers;
      if (campaign.target_tags && campaign.target_tags.length > 0) {
        targetSubscribers = allSubscribers.filter((sub) => {
          const subTags = Array.isArray(sub.tags) ? sub.tags : [];
          return campaign.target_tags.some((tag: string) => subTags.includes(tag));
        });
      }

      for (const sub of targetSubscribers) {
        let subject = campaign.subject_a;
        if (campaign.ab_test_config?.enabled && campaign.subject_b && Math.random() > 0.5) {
          subject = campaign.subject_b;
        }
        recipients.push({
          id: sub.id,
          email: sub.email,
          name: sub.name,
          subject,
          body: campaign.body,
        });
      }
    }

    console.log(`Sending campaign ${campaign_id} to ${recipients.length} recipients`);

    let sentCount = 0;
    const errors: any[] = [];
    let senderIndex = 0;

    for (const recipient of recipients) {
      try {
        // Personalise content
        const vars: Record<string, string> = {
          name: recipient.name || "there",
          company: "",
          email: recipient.email,
        };

        let finalSubject = replaceVariables(parseSpintax(recipient.subject), vars);
        let finalBody = replaceVariables(parseSpintax(recipient.body), vars);

        // Log 'sent' event first to get event ID for tracking URLs
        const { data: sentEvent } = await supabase
          .from("marketing_events")
          .insert({
            campaign_id,
            subscriber_id: recipient.id,
            event_type: "sent",
            metadata: {},
          })
          .select("id")
          .single();

        const eventId = sentEvent?.id;

        // Inject tracking
        if (eventId) {
          finalBody = injectTrackingPixel(finalBody, eventId, campaign_id);
          finalBody = injectClickTracking(finalBody, eventId, campaign_id);
        }
        if (unsubscribeEnabled && eventId) {
          finalBody = injectUnsubscribeLink(finalBody, eventId, campaign_id);
        }

        // Pick sender account (round-robin)
        let sendResult: { id?: string; error?: any } = {};
        let fromEmail = "Microns Hub <info@micronshub.eu>";

        if (senderAccounts.length > 0) {
          const account = senderAccounts[senderIndex % senderAccounts.length];
          senderIndex++;

          // Check warmup limit
          const effectiveLimit = account.warmup_enabled
            ? account.warmup_current_limit
            : account.daily_limit;

          if (account.emails_sent_today >= effectiveLimit) {
            // Skip this account, try next
            let found = false;
            for (let i = 1; i < senderAccounts.length; i++) {
              const alt = senderAccounts[(senderIndex + i) % senderAccounts.length];
              const altLimit = alt.warmup_enabled ? alt.warmup_current_limit : alt.daily_limit;
              if (alt.emails_sent_today < altLimit) {
                senderIndex = (senderIndex + i) % senderAccounts.length;
                found = true;
                break;
              }
            }
            if (!found) {
              console.log("All sender accounts at daily limit, using default");
            }
          }

          const activeAccount = senderAccounts[senderIndex % senderAccounts.length];

          if (activeAccount.provider === "google_workspace") {
            sendResult = await sendViaGoogle(activeAccount, recipient.email, finalSubject, finalBody);
          } else {
            // Resend with account-specific API key or default
            const apiKey = activeAccount.provider_config?.api_key || Deno.env.get("RESEND_API_KEY");
            const accountResend = new Resend(apiKey);
            const { data, error } = await accountResend.emails.send({
              from: `${activeAccount.display_name} <${activeAccount.email}>`,
              to: [recipient.email],
              subject: finalSubject,
              html: finalBody,
            });
            sendResult = error ? { error } : { id: data?.id };
          }

          fromEmail = `${activeAccount.display_name} <${activeAccount.email}>`;

          // Increment per-account counter
          await supabase
            .from("marketing_sender_accounts")
            .update({ emails_sent_today: (activeAccount.emails_sent_today || 0) + 1 })
            .eq("id", activeAccount.id);
        } else {
          // Default sender via main Resend API key
          const { data, error } = await defaultResend.emails.send({
            from: "Microns Hub <info@micronshub.eu>",
            to: [recipient.email],
            subject: finalSubject,
            html: finalBody,
          });
          sendResult = error ? { error } : { id: data?.id };
        }

        if (sendResult.error) {
          console.error(`Failed to send to ${recipient.email}:`, sendResult.error);
          errors.push({ email: recipient.email, error: sendResult.error });

          // Update the sent event to reflect failure
          if (eventId) {
            await supabase
              .from("marketing_events")
              .update({ event_type: "bounced", metadata: { error: sendResult.error } })
              .eq("id", eventId);
          }

          // Update recipient record if CSV import
          if (recipient.recipientRecordId) {
            await supabase
              .from("marketing_campaign_recipients")
              .update({ status: "failed" })
              .eq("id", recipient.recipientRecordId);
          }
        } else {
          sentCount++;

          // Update sent event with resend ID
          if (eventId) {
            await supabase
              .from("marketing_events")
              .update({
                metadata: { resend_id: sendResult.id, from: fromEmail },
                resend_email_id: sendResult.id || null,
              })
              .eq("id", eventId);
          }

          // Update recipient record if CSV import
          if (recipient.recipientRecordId) {
            await supabase
              .from("marketing_campaign_recipients")
              .update({ status: "sent", sent_at: new Date().toISOString() })
              .eq("id", recipient.recipientRecordId);
          }
        }
      } catch (err) {
        console.error(`Exception sending to ${recipient.email}:`, err);
        errors.push({ email: recipient.email, error: String(err) });
      }
    }

    // 6. Update campaign status
    await supabase
      .from("marketing_campaigns")
      .update({
        status: "sent",
        sent_count: sentCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({ message: "Campaign processing complete", sent: sentCount, errors: errors.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
