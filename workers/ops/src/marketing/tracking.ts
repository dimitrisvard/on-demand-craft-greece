// Open pixel, click tracking and unsubscribe link of campaign and follow-up mails, ported from
// supabase/functions/send-campaign/index.ts:42-76 and process-followups/index.ts:44-59. The URLs keep the repo format
// /api/marketing?action=track&type=<open|click|unsubscribe>&eid=<event id>&cid=<campaign id>[&url=…], so the Phase 2
// track action (site action MK-1) records them unchanged.
//
// Rules
//   - Tracking domain: marketing_settings.tracking_domain when set, else the var TRACKING_DOMAIN, else
//     https://micronshub.eu (the repo function's default).
//   - Campaign mails: pixel, then click tracking (mailto:, tel:, # links, /api/marketing links and links containing
//     "unsubscribe" are left as they are), then the unsubscribe block when marketing_settings.unsubscribe_link_enabled
//     is not false. Follow-ups: pixel and their own unsubscribe block, always, and no click tracking (as the repo).
//   - The pixel and the unsubscribe block go before the first </body>, else at the end.
//   - Nothing is added without an event id (as the repo).

import type { MailKind } from './personalise';

export const DEFAULT_TRACKING_DOMAIN = 'https://micronshub.eu';

export function trackingDomainOf(settings: { tracking_domain?: unknown } | null | undefined, env: { TRACKING_DOMAIN?: string }): string {
  const own = settings?.tracking_domain;
  if (typeof own === 'string' && own !== '') return own;
  return env.TRACKING_DOMAIN || DEFAULT_TRACKING_DOMAIN;
}

export function trackUrl(domain: string, type: 'open' | 'click' | 'unsubscribe', eventId: string, campaignId: string): string {
  return `${domain}/api/marketing?action=track&type=${type}&eid=${eventId}&cid=${campaignId}`;
}

export function injectTrackingPixel(html: string, eventId: string, campaignId: string, domain: string): string {
  const url = trackUrl(domain, 'open', eventId, campaignId);
  const pixel = `<img src="${url}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  if (html.includes('</body>')) return html.replace('</body>', () => `${pixel}</body>`);
  return html + pixel;
}

export function injectClickTracking(html: string, eventId: string, campaignId: string, domain: string): string {
  return html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi, (_match, before: string, href: string, after: string) => {
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#') || href.includes('/api/marketing') || href.includes('unsubscribe')) {
      return `<a ${before}href="${href}"${after}>`;
    }
    const url = `${trackUrl(domain, 'click', eventId, campaignId)}&url=${encodeURIComponent(href)}`;
    return `<a ${before}href="${url}"${after}>`;
  });
}

/** The unsubscribe block of the mail kind (campaign: notice + link; follow-up: link only), exactly as the repo. */
export function unsubscribeBlock(url: string, kind: MailKind): string {
  if (kind === 'followup') {
    return `
<div style="text-align:center;margin-top:32px;padding:16px;font-size:12px;color:#999;border-top:1px solid #eee;">
  <a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
</div>`;
  }
  return `
<div style="text-align:center;margin-top:32px;padding:16px;font-size:12px;color:#999;border-top:1px solid #eee;">
  <p style="margin:0 0 4px;">You received this email because you subscribed to our mailing list.</p>
  <p style="margin:0;"><a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe</a></p>
</div>`;
}

export function injectUnsubscribeLink(html: string, eventId: string, campaignId: string, domain: string, kind: MailKind = 'campaign'): string {
  const block = unsubscribeBlock(trackUrl(domain, 'unsubscribe', eventId, campaignId), kind);
  if (html.includes('</body>')) return html.replace('</body>', () => `${block}</body>`);
  return html + block;
}

/** The tracked body of one mail (rules above). */
export function applyTracking(html: string, o: { eventId: string | null; campaignId: string; domain: string; kind: MailKind; unsubscribeEnabled: boolean }): string {
  if (!o.eventId) return html;
  let body = injectTrackingPixel(html, o.eventId, o.campaignId, o.domain);
  if (o.kind === 'followup') return injectUnsubscribeLink(body, o.eventId, o.campaignId, o.domain, 'followup');
  body = injectClickTracking(body, o.eventId, o.campaignId, o.domain);
  if (o.unsubscribeEnabled) body = injectUnsubscribeLink(body, o.eventId, o.campaignId, o.domain, 'campaign');
  return body;
}
