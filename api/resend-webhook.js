// Resend webhook handler
// Registers: email.delivered, email.bounced, email.complained
// POST /api/resend-webhook

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

function verifyWebhookSignature(body, signature) {
  if (!RESEND_WEBHOOK_SECRET) return true; // Skip if not configured
  const hmac = createHmac('sha256', RESEND_WEBHOOK_SECRET);
  hmac.update(body);
  const expectedSignature = hmac.digest('hex');
  return signature === `sha256=${expectedSignature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['svix-signature'] || req.headers['resend-signature'] || '';

  if (RESEND_WEBHOOK_SECRET && !verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event?.type;
  const data = event?.data;

  if (!eventType || !data) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  try {
    // Look up our marketing_event by resend email id
    const { data: sentEvent } = await supabase
      .from('marketing_events')
      .select('id, subscriber_id, campaign_id')
      .eq('resend_email_id', data.email_id)
      .eq('event_type', 'sent')
      .maybeSingle();

    if (!sentEvent) {
      // Not a marketing email — ignore
      return res.status(200).json({ received: true, action: 'ignored' });
    }

    const { subscriber_id, campaign_id } = sentEvent;

    switch (eventType) {
      case 'email.delivered': {
        await supabase.from('marketing_events').insert({
          campaign_id,
          subscriber_id,
          event_type: 'delivered',
          resend_email_id: data.email_id,
          metadata: { resend_event: eventType },
        });
        break;
      }

      case 'email.bounced': {
        await supabase.from('marketing_events').insert({
          campaign_id,
          subscriber_id,
          event_type: 'bounced',
          resend_email_id: data.email_id,
          metadata: {
            resend_event: eventType,
            bounce_type: data.bounce?.type,
            bounce_description: data.bounce?.description,
          },
        });

        // Increment bounce count and auto-disable after 3 bounces
        const { data: subscriber } = await supabase
          .from('marketing_subscribers')
          .select('bounce_count, email')
          .eq('id', subscriber_id)
          .maybeSingle();

        const newBounceCount = (subscriber?.bounce_count || 0) + 1;

        const updatePayload = { bounce_count: newBounceCount };
        if (newBounceCount >= 3) {
          updatePayload.status = 'unsubscribed';
          console.log(`Auto-disabling subscriber ${subscriber?.email} after ${newBounceCount} bounces`);
        }

        await supabase
          .from('marketing_subscribers')
          .update(updatePayload)
          .eq('id', subscriber_id);

        // Update analytics
        await supabase
          .from('marketing_analytics')
          .upsert(
            { campaign_id, opens: 0, clicks: 0, bounces: 1 },
            { onConflict: 'campaign_id' }
          )
          .catch(() => null);
        break;
      }

      case 'email.complained': {
        await supabase.from('marketing_events').insert({
          campaign_id,
          subscriber_id,
          event_type: 'complained',
          resend_email_id: data.email_id,
          metadata: { resend_event: eventType },
        });

        // Auto-unsubscribe on spam complaint
        await supabase
          .from('marketing_subscribers')
          .update({ status: 'unsubscribed' })
          .eq('id', subscriber_id);
        break;
      }

      case 'email.opened': {
        // Resend also sends open events if enabled
        const { data: existing } = await supabase
          .from('marketing_events')
          .select('id')
          .eq('campaign_id', campaign_id)
          .eq('subscriber_id', subscriber_id)
          .eq('event_type', 'opened')
          .maybeSingle();

        if (!existing) {
          await supabase.from('marketing_events').insert({
            campaign_id,
            subscriber_id,
            event_type: 'opened',
            resend_email_id: data.email_id,
            metadata: { resend_event: eventType },
          });
        }
        break;
      }

      case 'email.clicked': {
        await supabase.from('marketing_events').insert({
          campaign_id,
          subscriber_id,
          event_type: 'clicked',
          resend_email_id: data.email_id,
          metadata: { resend_event: eventType, url: data.click?.link },
        });
        break;
      }

      default:
        console.log(`Unhandled Resend webhook event: ${eventType}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
