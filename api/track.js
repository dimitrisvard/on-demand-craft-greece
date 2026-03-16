// Email tracking endpoint: open pixel and click redirect
// GET /api/track?type=open&eid={event_id}&cid={campaign_id}
// GET /api/track?type=click&eid={event_id}&cid={campaign_id}&url={encoded_url}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1x1 transparent PNG pixel
const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

export default async function handler(req, res) {
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
      // Look up the sent event to get subscriber_id
      const { data: sentEvent } = await supabase
        .from('marketing_events')
        .select('subscriber_id, campaign_id')
        .eq('id', eid)
        .eq('campaign_id', cid)
        .eq('event_type', 'sent')
        .maybeSingle();

      if (sentEvent) {
        // Check if already tracked (deduplication)
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

          // Update marketing_analytics
          await supabase.rpc('increment_analytics_opens', { p_campaign_id: cid }).catch(() => {
            // Fallback: manual upsert
            return supabase
              .from('marketing_analytics')
              .upsert(
                { campaign_id: cid, opens: 1, clicks: 0, bounces: 0 },
                {
                  onConflict: 'campaign_id',
                  ignoreDuplicates: false,
                }
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

      // Look up the sent event
      const { data: sentEvent } = await supabase
        .from('marketing_events')
        .select('subscriber_id, campaign_id')
        .eq('id', eid)
        .eq('campaign_id', cid)
        .eq('event_type', 'sent')
        .maybeSingle();

      if (sentEvent) {
        // Check deduplication per URL
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

          // Update marketing_analytics clicks
          await supabase
            .from('marketing_analytics')
            .upsert(
              { campaign_id: cid, opens: 0, clicks: 1, bounces: 0 },
              { onConflict: 'campaign_id' }
            )
            .catch(() => null);
        }
      }

      // Redirect to the actual URL
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
        // Mark subscriber as unsubscribed
        await supabase
          .from('marketing_subscribers')
          .update({ status: 'unsubscribed' })
          .eq('id', sentEvent.subscriber_id);

        // Log unsubscribe event
        await supabase.from('marketing_events').insert({
          campaign_id: cid,
          subscriber_id: sentEvent.subscriber_id,
          event_type: 'unsubscribed',
          metadata: { sent_event_id: eid },
        });
      }

      // Return a simple confirmation page
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
    // Always return the pixel for open tracking even on error
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
