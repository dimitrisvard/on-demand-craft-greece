/**
 * Company Profile Scraper — Europages & wlw
 *
 * POST /api/scrape-company-profile
 * Body: { url: string, source: 'europages'|'wlw' }
 *
 * Fetches ONE company profile page and extracts:
 * - website URL, phone, email, address, employee count, description, certifications
 *
 * Architecture: Node.js built-in fetch + Regex. No Puppeteer, no Cheerio.
 */

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getBrowserHeaders(referer) {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    ...(referer ? { 'Referer': referer } : {}),
  };
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────
// Europages Profile Parser
// ─────────────────────────────────────────────
function parseEuropagesProfile(html, profileUrl) {
  const result = {
    company_name: '',
    description: '',
    country: '',
    city: '',
    full_address: '',
    website_url: '',
    phone: '',
    email: '',
    fax: '',
    employee_count: '',
    year_established: '',
    vat_id: '',
    industry_tags: [],
    products_services: [],
    certifications: [],
  };

  // Try JSON-LD first (most reliable)
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (['Organization', 'LocalBusiness', 'Corporation', 'Company'].includes(item['@type'])) {
          if (item.name) result.company_name = cleanText(item.name);
          if (item.description) result.description = cleanText(item.description);
          if (item.url && !item.url.includes('europages')) result.website_url = item.url;
          if (item.sameAs && !item.sameAs.includes('europages')) result.website_url = result.website_url || item.sameAs;
          if (item.telephone) result.phone = item.telephone;
          if (item.email) result.email = item.email;
          if (item.address) {
            result.country = item.address.addressCountry || '';
            result.city = item.address.addressLocality || '';
            const parts = [
              item.address.streetAddress,
              item.address.postalCode,
              item.address.addressLocality,
              item.address.addressCountry,
            ].filter(Boolean);
            if (parts.length) result.full_address = parts.join(', ');
          }
          if (item.numberOfEmployees) result.employee_count = String(item.numberOfEmployees);
          if (item.foundingDate) result.year_established = String(item.foundingDate).slice(0, 4);
        }
      }
    } catch (_) { /* skip */ }
  }

  // Website URL — look for external links with rel="nofollow" or target="_blank"
  if (!result.website_url) {
    const websitePatterns = [
      /href="(https?:\/\/(?!www\.europages\.[a-z.]+)[^"]+)"[^>]*(?:rel="nofollow|target="_blank)[^>]*>/gi,
      /<a[^>]+(?:rel="nofollow|target="_blank)[^>]+href="(https?:\/\/(?!www\.europages)[^"]{4,100})"/gi,
      /data-website="(https?:\/\/[^"]{4,100})"/gi,
      /class="[^"]*(?:website|web-link|external)[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi,
    ];
    for (const rx of websitePatterns) {
      const m = rx.exec(html);
      if (m && m[1] && !m[1].includes('europages') && !m[1].includes('facebook') && !m[1].includes('linkedin')) {
        result.website_url = m[1];
        break;
      }
    }
  }

  // Phone — tel: links
  if (!result.phone) {
    const phoneM = html.match(/href="tel:([^"]+)"/i);
    if (phoneM) result.phone = phoneM[1].trim();
  }

  // Email — mailto: links
  if (!result.email) {
    const emailM = html.match(/href="mailto:([^"?]+)"/i);
    if (emailM) result.email = emailM[1].trim();
  }

  // Meta description fallback
  if (!result.description) {
    const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,}?)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']{10,}?)["'][^>]+name=["']description["']/i);
    if (metaM) result.description = cleanText(metaM[1]);
  }

  // Company name from title fallback
  if (!result.company_name) {
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleM) result.company_name = cleanText(titleM[1]).replace(/\s*[-|].*$/, '').trim();
    if (!result.company_name) {
      // From og:title
      const ogM = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      if (ogM) result.company_name = cleanText(ogM[1]);
    }
  }

  // Employee count — patterns like "11-50" or "51-200 employees"
  if (!result.employee_count) {
    const empM = html.match(/(\d{1,4}[\s–\-]+\d{1,4})\s*(?:employees|staff|Mitarbeiter|employés|collaborateurs)?/i)
      || html.match(/(?:employees|staff|Mitarbeiter):\s*(\d[\d ,–\-]+)/i);
    if (empM) result.employee_count = empM[1].trim();
  }

  // Year established
  if (!result.year_established) {
    const yearM = html.match(/(?:founded|established|seit|gegründet|fondée?|since)[^<\d]*(\d{4})/i);
    if (yearM) result.year_established = yearM[1];
  }

  // Industry tags — extract from meta keywords or breadcrumbs
  if (!result.industry_tags.length) {
    const kwM = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    if (kwM) {
      result.industry_tags = kwM[1].split(/,\s*/).map(k => cleanText(k)).filter(k => k.length > 1 && k.length < 50).slice(0, 10);
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// wlw Profile Parser
// ─────────────────────────────────────────────
function parseWlwProfile(html, profileUrl) {
  const result = {
    company_name: '',
    description: '',
    country: '',
    city: '',
    full_address: '',
    website_url: '',
    phone: '',
    email: '',
    fax: '',
    employee_count: '',
    year_established: '',
    vat_id: '',
    industry_tags: [],
    products_services: [],
    certifications: [],
    contact_persons: [],
  };

  // Strategy 1: __NEXT_DATA__ (Next.js — most reliable for wlw)
  const nextDataRx = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const ndMatch = nextDataRx.exec(html);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      const pageProps = data?.props?.pageProps;
      const company = pageProps?.company || pageProps?.companyProfile || pageProps?.companyData || {};

      if (company.name) result.company_name = cleanText(company.name);
      if (company.description) result.description = cleanText(company.description);
      if (company.shortDescription) result.description = result.description || cleanText(company.shortDescription);
      if (company.website) result.website_url = company.website;
      if (company.phone || company.telephone) result.phone = company.phone || company.telephone;
      if (company.email) result.email = company.email;
      if (company.fax) result.fax = company.fax;

      // Address
      const addr = company.address || company.location || {};
      if (addr.country) result.country = addr.country;
      if (addr.city) result.city = addr.city;
      const addrParts = [addr.street, addr.postalCode, addr.city, addr.country].filter(Boolean);
      if (addrParts.length) result.full_address = addrParts.join(', ');

      if (company.employeeCount) result.employee_count = String(company.employeeCount);
      if (company.foundingYear) result.year_established = String(company.foundingYear);
      if (company.vatId) result.vat_id = company.vatId;

      // Tags
      if (Array.isArray(company.tags)) {
        result.industry_tags = company.tags.map(t => typeof t === 'string' ? t : (t.name || '')).filter(Boolean);
      }
      if (Array.isArray(company.products)) {
        result.products_services = company.products.map(p => typeof p === 'string' ? p : (p.name || '')).filter(Boolean);
      }
      if (Array.isArray(company.certifications)) {
        result.certifications = company.certifications.map(c => typeof c === 'string' ? c : (c.name || '')).filter(Boolean);
      }

      // Contact persons
      if (Array.isArray(company.contacts)) {
        result.contact_persons = company.contacts.map(cp => ({
          name: cp.name || cp.fullName || '',
          title: cp.title || cp.position || cp.jobTitle || '',
          email: cp.email || '',
          phone: cp.phone || cp.telephone || '',
        })).filter(cp => cp.name);
      }
    } catch (_) { /* fall through to regex */ }
  }

  // Fallbacks via regex if JSON parsing didn't fill everything

  // Website URL
  if (!result.website_url) {
    const websitePatterns = [
      /href="(https?:\/\/(?!www\.wlw\.)[^"]{4,100})"[^>]*(?:rel="nofollow|target="_blank|class="[^"]*(?:website|external))[^>]*>/gi,
      /<a[^>]+class="[^"]*(?:website|web-link)[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi,
      /data-href="(https?:\/\/(?!www\.wlw\.)[^"]{4,100})"/gi,
    ];
    for (const rx of websitePatterns) {
      const m = rx.exec(html);
      if (m && m[1] && !m[1].includes('wlw.') && !m[1].includes('facebook') && !m[1].includes('linkedin')) {
        result.website_url = m[1];
        break;
      }
    }
  }

  // Phone
  if (!result.phone) {
    const phoneM = html.match(/href="tel:([^"]+)"/i);
    if (phoneM) result.phone = phoneM[1].trim();
  }

  // Email
  if (!result.email) {
    const emailM = html.match(/href="mailto:([^"?]+)"/i);
    if (emailM) result.email = emailM[1].trim();
  }

  // Company name fallback
  if (!result.company_name) {
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleM) result.company_name = cleanText(titleM[1]).replace(/\s*[-|].*$/, '').trim();
  }

  // JSON-LD fallback
  if (!result.company_name || !result.website_url) {
    const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jm;
    while ((jm = jsonLdRx.exec(html)) !== null) {
      try {
        const data = JSON.parse(jm[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (['Organization', 'LocalBusiness', 'Corporation'].includes(item['@type'])) {
            if (!result.company_name && item.name) result.company_name = cleanText(item.name);
            if (!result.website_url && item.url && !item.url.includes('wlw.')) result.website_url = item.url;
            if (!result.phone && item.telephone) result.phone = item.telephone;
            if (!result.email && item.email) result.email = item.email;
          }
        }
      } catch (_) { /* skip */ }
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, source } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (!source || !['europages', 'wlw'].includes(source)) {
    return res.status(400).json({ error: 'source must be "europages" or "wlw"' });
  }

  // Determine referer from source
  const referer = source === 'europages'
    ? 'https://www.europages.co.uk/'
    : 'https://www.wlw.com/en/search';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let html;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: getBrowserHeaders(referer),
      redirect: 'follow',
    });

    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate limited. Wait 30 seconds.', retryAfter: 30 });
    }
    if (response.status === 403) {
      return res.status(403).json({ error: 'Access blocked (403). Try again later.' });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `HTTP ${response.status} from directory` });
    }

    html = await response.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout fetching company profile' });
    }
    return res.status(502).json({ error: `Failed to fetch profile: ${err.message}` });
  } finally {
    clearTimeout(timeout);
  }

  let details;
  if (source === 'europages') {
    details = parseEuropagesProfile(html, url);
  } else {
    details = parseWlwProfile(html, url);
  }

  return res.status(200).json({
    url,
    source,
    ...details,
  });
}
