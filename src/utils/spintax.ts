/**
 * Spintax parser for email personalization
 * Supports: {option1|option2|option3} syntax
 * Example: {Hi|Hello|Hey} {{{name}}} — we appreciate your interest!
 */

/**
 * Parse spintax and return a random variation for each {a|b|c} group
 */
export function parseSpintax(text: string): string {
  if (!text || !text.includes('{')) return text;

  // Process innermost braces first (handles nested spintax)
  const spintaxRegex = /\{([^{}]+)\}/g;

  let result = text;
  let hasSpintax = spintaxRegex.test(result);

  // Process up to 10 levels of nesting
  let iterations = 0;
  while (hasSpintax && iterations < 10) {
    result = result.replace(/\{([^{}]+)\}/g, (_match, group) => {
      // Check if it's a template variable like {{name}} — skip those
      // Note: after outer {} is consumed, inner {name} check is done by detecting no |
      const options = group.split('|');
      if (options.length === 1) {
        // Not spintax — might be a template var escaped as {varname}
        // Return as-is (but without braces — caller should handle {{varname}} separately)
        return `{${group}}`;
      }
      return options[Math.floor(Math.random() * options.length)];
    });

    hasSpintax = /\{([^{}]+)\}/.test(result);
    iterations++;
  }

  return result;
}

/**
 * Replace template variables in email content
 * Handles: {{name}}, {{company}}, {{email}} and any custom variables
 */
export function replaceTemplateVariables(
  text: string,
  variables: Record<string, string>
): string {
  if (!text) return text;

  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'gi'), value || '');
  }

  return result;
}

/**
 * Process email content: first apply spintax, then replace variables
 */
export function processEmailContent(
  text: string,
  variables: Record<string, string> = {}
): string {
  if (!text) return text;
  const withSpintax = parseSpintax(text);
  return replaceTemplateVariables(withSpintax, variables);
}

/**
 * Inject open tracking pixel into HTML email body
 */
export function injectTrackingPixel(
  html: string,
  eventId: string,
  campaignId: string,
  trackingDomain: string
): string {
  const pixelUrl = `${trackingDomain}/api/track?type=open&eid=${eventId}&cid=${campaignId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;outline:none;" alt="" />`;

  // Inject before closing </body> tag, or append if no body tag
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Rewrite links in HTML email for click tracking
 */
export function injectClickTracking(
  html: string,
  eventId: string,
  campaignId: string,
  trackingDomain: string
): string {
  // Match <a href="..."> tags, but skip mailto: and unsubscribe links
  return html.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_match, before, href, after) => {
      // Skip mailto, tel, anchor links, and already-tracking links
      if (
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#') ||
        href.includes('/api/track') ||
        href.includes('unsubscribe')
      ) {
        return `<a ${before}href="${href}"${after}>`;
      }

      const trackUrl = `${trackingDomain}/api/track?type=click&eid=${eventId}&cid=${campaignId}&url=${encodeURIComponent(href)}`;
      return `<a ${before}href="${trackUrl}"${after}>`;
    }
  );
}

/**
 * Inject unsubscribe link into HTML email
 */
export function injectUnsubscribeLink(
  html: string,
  eventId: string,
  campaignId: string,
  trackingDomain: string
): string {
  const unsubUrl = `${trackingDomain}/api/track?type=unsubscribe&eid=${eventId}&cid=${campaignId}`;
  const unsubHtml = `
<div style="text-align:center;margin-top:40px;padding:20px;font-size:12px;color:#999;border-top:1px solid #eee;">
  <p>You received this email because you subscribed to our mailing list.</p>
  <p><a href="${unsubUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a> from future emails.</p>
</div>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${unsubHtml}</body>`);
  }
  return html + unsubHtml;
}
