// Website scraper endpoint - extracts emails and company names from URLs

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of URLs' });
    }

    if (urls.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 URLs per request' });
    }

    // Process URLs with limited concurrency (5 at a time)
    const results = [];
    const batchSize = 5;

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(url => scrapeUrl(url))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            url: batch[j],
            status: 'error',
            emails: [],
            companyName: null,
            error: result.reason?.message || 'Unknown error',
          });
        }
      }
    }

    return res.status(200).json({ results });
  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function scrapeUrl(url) {
  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    return {
      url,
      status: 'error',
      emails: [],
      companyName: null,
      error: 'Invalid URL',
    };
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        url,
        status: 'error',
        emails: [],
        companyName: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Limit body size to 500KB
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return {
        url,
        status: 'error',
        emails: [],
        companyName: null,
        error: 'Not an HTML page',
      };
    }

    const html = await response.text();
    const truncatedHtml = html.slice(0, 500000);

    const emails = extractEmails(truncatedHtml);
    const companyName = extractCompanyName(truncatedHtml, parsedUrl);

    return {
      url,
      status: emails.length > 0 ? 'success' : 'no_emails',
      emails,
      companyName,
      error: emails.length === 0 ? 'No emails found on this page' : undefined,
    };
  } catch (error) {
    return {
      url,
      status: 'error',
      emails: [],
      companyName: null,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// False-positive email domains to filter out
const BLOCKED_DOMAINS = [
  'example.com', 'example.org', 'example.net',
  'sentry.io', 'webpack.js.org', 'w3.org',
  'schema.org', 'wixpress.com', 'googleapis.com',
  'gravatar.com', 'wordpress.org', 'wordpress.com',
];

// False-positive patterns
const BLOCKED_PATTERNS = [
  /^[a-f0-9]{32}@/, // hex hashes
  /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i, // file extensions
  /@2x\./i, // retina image references
  /^(no-?reply|noreply|mailer-daemon|postmaster)@/i,
];

function extractEmails(html) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const allMatches = html.match(emailRegex) || [];

  // Also extract from mailto: links
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let match;
  while ((match = mailtoRegex.exec(html)) !== null) {
    allMatches.push(match[1]);
  }

  // Deduplicate and filter
  const unique = [...new Set(allMatches.map(e => e.toLowerCase()))];

  return unique.filter(email => {
    const domain = email.split('@')[1];
    if (BLOCKED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
      return false;
    }
    if (BLOCKED_PATTERNS.some(p => p.test(email))) {
      return false;
    }
    return true;
  });
}

function extractCompanyName(html, parsedUrl) {
  // 1. og:site_name
  const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  if (ogMatch) return ogMatch[1].trim();

  // 2. application-name
  const appMatch = html.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']application-name["']/i);
  if (appMatch) return appMatch[1].trim();

  // 3. JSON-LD Organization name
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const name = findOrgName(data);
      if (name) return name;
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  // 4. Title tag (strip common suffixes)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    let title = titleMatch[1].trim();
    // Remove common suffixes
    title = title.replace(/\s*[\-–—|]\s*(Home|About|Contact|Welcome|Official).*/i, '').trim();
    if (title.length > 0 && title.length < 60) return title;
  }

  // 5. Domain fallback
  const domain = parsedUrl.hostname.replace(/^www\./, '');
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function findOrgName(data) {
  if (!data || typeof data !== 'object') return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const name = findOrgName(item);
      if (name) return name;
    }
    return null;
  }

  if (data['@type'] === 'Organization' || data['@type'] === 'Corporation' || data['@type'] === 'LocalBusiness') {
    return data.name || null;
  }

  // Check publisher or author
  if (data.publisher && typeof data.publisher === 'object') {
    const name = findOrgName(data.publisher);
    if (name) return name;
  }

  return null;
}
