// Consolidated email marketing API endpoint
// Routes via ?action= parameter:
//   action=track      — Open pixel, click redirect, unsubscribe
//   action=webhook    — Resend webhook handler (bounces, complaints, etc.)
//   action=google-auth — Google OAuth2 flow (authorize, callback, refresh via &step=)

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars:', {
    SUPABASE_URL: !!supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: !!supabaseKey,
  });
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Tracking constants ───────────────────────────────────────────────────────

const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// ─── Webhook constants ────────────────────────────────────────────────────────

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

function verifyWebhookSignature(body, signature) {
  if (!RESEND_WEBHOOK_SECRET) return true;
  const hmac = createHmac('sha256', RESEND_WEBHOOK_SECRET);
  hmac.update(body);
  const expectedSignature = hmac.digest('hex');
  return signature === `sha256=${expectedSignature}`;
}

// ─── Google OAuth constants ───────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/marketing?action=google-auth&step=callback`;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

// ─── Main router ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { action } = req.query;

  switch (action) {
    case 'track':
      return handleTrack(req, res);
    case 'webhook':
      return handleWebhook(req, res);
    case 'google-auth':
      return handleGoogleAuth(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action. Use: track, webhook, or google-auth' });
  }
}

// ─── Track handler ────────────────────────────────────────────────────────────

async function handleTrack(req, res) {
  const { type, eid, cid, url } = req.query;

  if (!eid || !cid) {
    if (type === 'open') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return res.end(TRACKING_PIXEL);
    }
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    if (type === 'open') {
      const { data: sentEvent } = await supabase
        .from('marketing_events')
        .select('subscriber_id, campaign_id')
        .eq('id', eid)
        .eq('campaign_id', cid)
        .eq('event_type', 'sent')
        .maybeSingle();

      if (sentEvent) {
        const { data: existing } = await supabase
          .from('marketing_events')
          .select('id')
          .eq('campaign_id', cid)
          .eq('subscriber_id', sentEvent.subscriber_id)
          .eq('event_type', 'opened')
          .maybeSingle();

        if (!existing) {
          await supabase.from('marketing_events').insert({
            campaign_id: cid,
            subscriber_id: sentEvent.subscriber_id,
            event_type: 'opened',
            metadata: { tracked_via: 'pixel', sent_event_id: eid },
          });

          await supabase.rpc('increment_analytics_opens', { p_campaign_id: cid }).catch(() => {
            return supabase
              .from('marketing_analytics')
              .upsert(
                { campaign_id: cid, opens: 1, clicks: 0, bounces: 0 },
                { onConflict: 'campaign_id', ignoreDuplicates: false }
              );
          });
        }
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.end(TRACKING_PIXEL);
    }

    if (type === 'click') {
      if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const decodedUrl = decodeURIComponent(url);

      const { data: sentEvent } = await supabase
        .from('marketing_events')
        .select('subscriber_id, campaign_id')
        .eq('id', eid)
        .eq('campaign_id', cid)
        .eq('event_type', 'sent')
        .maybeSingle();

      if (sentEvent) {
        const { data: existing } = await supabase
          .from('marketing_events')
          .select('id')
          .eq('campaign_id', cid)
          .eq('subscriber_id', sentEvent.subscriber_id)
          .eq('event_type', 'clicked')
          .contains('metadata', { url: decodedUrl })
          .maybeSingle();

        if (!existing) {
          await supabase.from('marketing_events').insert({
            campaign_id: cid,
            subscriber_id: sentEvent.subscriber_id,
            event_type: 'clicked',
            metadata: { url: decodedUrl, sent_event_id: eid },
          });

          await supabase
            .from('marketing_analytics')
            .upsert(
              { campaign_id: cid, opens: 0, clicks: 1, bounces: 0 },
              { onConflict: 'campaign_id' }
            )
            .catch(() => null);
        }
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, decodedUrl);
    }

    if (type === 'unsubscribe') {
      const { data: sentEvent } = await supabase
        .from('marketing_events')
        .select('subscriber_id')
        .eq('id', eid)
        .eq('campaign_id', cid)
        .eq('event_type', 'sent')
        .maybeSingle();

      if (sentEvent) {
        await supabase
          .from('marketing_subscribers')
          .update({ status: 'unsubscribed' })
          .eq('id', sentEvent.subscriber_id);

        await supabase.from('marketing_events').insert({
          campaign_id: cid,
          subscriber_id: sentEvent.subscriber_id,
          event_type: 'unsubscribed',
          metadata: { sent_event_id: eid },
        });
      }

      res.setHeader('Content-Type', 'text/html');
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Unsubscribed</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
        .box{text-align:center;padding:2rem;max-width:400px;}</style>
        </head>
        <body><div class="box">
          <h1>You've been unsubscribed</h1>
          <p>You will no longer receive emails from this sender. This may take up to 24 hours to take effect.</p>
        </div></body>
        </html>
      `);
    }

    return res.status(400).json({ error: 'Invalid tracking type' });
  } catch (error) {
    console.error('Tracking error:', error);
    if (type === 'open') {
      res.setHeader('Content-Type', 'image/png');
      return res.end(TRACKING_PIXEL);
    }
    if (type === 'click' && url) {
      return res.redirect(302, decodeURIComponent(url));
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

async function handleWebhook(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    const { data: sentEvent } = await supabase
      .from('marketing_events')
      .select('id, subscriber_id, campaign_id')
      .eq('resend_email_id', data.email_id)
      .eq('event_type', 'sent')
      .maybeSingle();

    if (!sentEvent) {
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

        await supabase
          .from('marketing_subscribers')
          .update({ status: 'unsubscribed' })
          .eq('id', subscriber_id);
        break;
      }

      case 'email.opened': {
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

// ─── Google Auth handler ──────────────────────────────────────────────────────

async function handleGoogleAuth(req, res) {
  const { step, code, state, account_id, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(200).send(`<!DOCTYPE html>
<html><head><title>Google Connection Failed</title></head>
<body>
<p>OAuth error: ${oauthError}. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-error', error: '${oauthError}' }, '*');
    window.close();
  } else {
    window.location.href = '/dashboard/email-marketing?tab=settings&google_error=' + encodeURIComponent('${oauthError}');
  }
</script>
</body></html>`);
  }

  switch (step) {
    case 'authorize': {
      if (!GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google Client ID not configured. Set GOOGLE_CLIENT_ID environment variable.' });
      }

      const stateData = JSON.stringify({ account_id: account_id || 'new' });
      const encodedState = Buffer.from(stateData).toString('base64');

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: GMAIL_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: encodedState,
      });

      return res.redirect(302, `${GOOGLE_AUTH_URL}?${params.toString()}`);
    }

    case 'callback': {
      if (!code) {
        return res.status(200).send(`<!DOCTYPE html>
<html><head><title>Google Connection Failed</title></head>
<body>
<p>No authorization code received. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-error', error: 'no_code' }, '*');
    window.close();
  } else {
    window.location.href = '/dashboard/email-marketing?tab=settings&google_error=no_code';
  }
</script>
</body></html>`);
      }

      try {
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
          }).toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok || tokens.error) {
          console.error('Token exchange error:', tokens);
          const tokenErr = tokens.error || 'token_error';
          return res.status(200).send(`<!DOCTYPE html>
<html><head><title>Google Connection Failed</title></head>
<body>
<p>Token exchange failed. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-error', error: '${tokenErr}' }, '*');
    window.close();
  } else {
    window.location.href = '/dashboard/email-marketing?tab=settings&google_error=${encodeURIComponent(tokenErr)}';
  }
</script>
</body></html>`);
        }

        const userInfoResponse = await fetch(
          `https://www.googleapis.com/oauth2/v2/userinfo`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        const userInfo = await userInfoResponse.json();

        let stateData = { account_id: 'new' };
        if (state) {
          try {
            stateData = JSON.parse(Buffer.from(state, 'base64').toString());
          } catch (e) {
            // Ignore parse error
          }
        }

        const providerConfig = {
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          token_expiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
          google_email: userInfo.email,
        };

        if (stateData.account_id && stateData.account_id !== 'new') {
          await supabase
            .from('marketing_sender_accounts')
            .update({
              provider_config: providerConfig,
              updated_at: new Date().toISOString(),
            })
            .eq('id', stateData.account_id);
        } else {
          await supabase.from('marketing_sender_accounts').upsert(
            {
              email: userInfo.email,
              display_name: userInfo.name || userInfo.email,
              provider: 'google_workspace',
              provider_config: providerConfig,
              is_active: true,
            },
            { onConflict: 'email' }
          );
        }

        // Return an HTML page that communicates back to the opener window and closes the popup
        return res.status(200).send(`<!DOCTYPE html>
<html><head><title>Google Connected</title></head>
<body>
<p>Google account connected successfully. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-success', email: ${JSON.stringify(userInfo.email)} }, '*');
    window.close();
  } else {
    window.location.href = '/dashboard/email-marketing?tab=settings&google_connected=1';
  }
</script>
</body></html>`);
      } catch (error) {
        console.error('Google OAuth callback error:', error);
        const errorMsg = error.message || 'Unknown error';
        return res.status(200).send(`<!DOCTYPE html>
<html><head><title>Google Connection Failed</title></head>
<body>
<p>Failed to connect Google account. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-error', error: ${JSON.stringify(error.message || 'Unknown error')} }, '*');
    window.close();
  } else {
    window.location.href = '/dashboard/email-marketing?tab=settings&google_error=' + encodeURIComponent(${JSON.stringify(error.message || 'Unknown error')});
  }
</script>
</body></html>`);
      }
    }

    case 'refresh': {
      const { data: account } = await supabase
        .from('marketing_sender_accounts')
        .select('provider_config')
        .eq('id', account_id)
        .single();

      if (!account?.provider_config?.refresh_token) {
        return res.status(400).json({ error: 'No refresh token available' });
      }

      try {
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: account.provider_config.refresh_token,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
          }).toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
          return res.status(400).json({ error: tokens.error });
        }

        await supabase
          .from('marketing_sender_accounts')
          .update({
            provider_config: {
              ...account.provider_config,
              access_token: tokens.access_token,
              token_expiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
            },
          })
          .eq('id', account_id);

        return res.status(200).json({ access_token: tokens.access_token });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    default:
      return res.status(400).json({ error: 'Invalid step. Use: authorize, callback, or refresh' });
  }
}
