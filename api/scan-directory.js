/**
 * Directory Scanner API — Europages & wlw
 *
 * POST /api/scan-directory
 * Body: { url: string, source?: 'europages'|'wlw'|'auto' }
 *
 * Fetches ONE search results page from Europages or wlw and extracts company cards.
 * Returns raw company data (no database writes — the frontend stores via Supabase).
 *
 * Architecture: Node.js built-in fetch + Regex. No Puppeteer, no Cheerio.
 */

// ─────────────────────────────────────────────
// CORS helper
// ─────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getBrowserHeaders() {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  };
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────
// Source Detector
// ─────────────────────────────────────────────
function detectSource(url) {
  const lower = url.toLowerCase();
  if (lower.includes('europages.')) return 'europages';
  if (lower.includes('wlw.com') || lower.includes('wlw.de') || lower.includes('wlw.at') || lower.includes('wlw.be')) return 'wlw';
  return 'unknown';
}

function extractSearchMeta(url, source) {
  let keyword = '';
  let country = '';

  if (source === 'europages') {
    // /companies/{country}/{keyword}.html  OR  /companies/{keyword}.html
    const m = url.match(/\/companies\/(?:([^/]+?)\/)?([^/]+?)(?:\.html|\/p-\d+|$)/i);
    if (m) {
      if (m[2]) keyword = decodeURIComponent(m[2]).replace(/-/g, ' ');
      if (m[1] && !m[1].startsWith('p-') && m[1] !== 'manufacturer%20producer' && m[1] !== 'manufacturer producer') country = m[1];
    }
  }

  if (source === 'wlw') {
    const kwM = url.match(/\/(?:en|de|fr)\/(?:search|suche)\/([^/?#]+)/i);
    const countryM = url.match(/\/country\/([^/?#]+)/i);
    if (kwM) keyword = decodeURIComponent(kwM[1]).replace(/-/g, ' ');
    if (countryM) country = countryM[1];
  }

  return { keyword: keyword.trim(), country: country.trim() };
}

// ─────────────────────────────────────────────
// Europages Scraper
// ─────────────────────────────────────────────
function parseEuropages(html, searchUrl) {
  const companies = [];
  const baseUrl = 'https://www.europages.co.uk';

  // Strategy 1: JSON-LD structured data (most reliable)
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
          for (const el of item.itemListElement) {
            const org = el.item || el;
            if (org.name && (org.url || el.url)) {
              companies.push({
                company_name: cleanText(org.name),
                source_url: org.url || el.url || '',
                country: org.address?.addressCountry || '',
                city: org.address?.addressLocality || '',
                description: cleanText(org.description || ''),
                industry_tags: [],
              });
            }
          }
        } else if (['Organization', 'LocalBusiness', 'Corporation'].includes(item['@type']) && item.name) {
          companies.push({
            company_name: cleanText(item.name),
            source_url: item.url || '',
            country: item.address?.addressCountry || '',
            city: item.address?.addressLocality || '',
            description: cleanText(item.description || ''),
            industry_tags: [],
          });
        }
      }
    } catch (_) { /* skip invalid JSON */ }
  }

  if (companies.length > 0) return companies;

  // Strategy 2: Extract profile URLs from HTML
  // Europages profile URLs: /COMPANY-NAME-SLUG.html (relative) or full URL
  const seenUrls = new Set();

  // Absolute profile links
  const absLinkRx = /href="(https?:\/\/www\.europages\.[a-z.]+\/(?!companies\/|search\/|categories\/)([^"?#]+?)\.html)"/gi;
  let m;
  while ((m = absLinkRx.exec(html)) !== null) {
    const profileUrl = m[1];
    if (!seenUrls.has(profileUrl) && !profileUrl.includes('/p-') && !profileUrl.match(/\/companies\//)) {
      seenUrls.add(profileUrl);
      const slug = m[2].split('/').pop() || '';
      companies.push({
        company_name: slugToName(slug),
        source_url: profileUrl,
        country: '',
        city: '',
        description: '',
        industry_tags: [],
      });
    }
  }

  // Relative profile links
  const relLinkRx = /href="(\/(?!companies\/|search\/|categories\/)([^"?#/][^"?#]*?)\.html)"/gi;
  while ((m = relLinkRx.exec(html)) !== null) {
    const profileUrl = baseUrl + m[1];
    if (!seenUrls.has(profileUrl) && !m[1].includes('/p-')) {
      seenUrls.add(profileUrl);
      const slug = m[2].split('/').pop() || '';
      companies.push({
        company_name: slugToName(slug),
        source_url: profileUrl,
        country: '',
        city: '',
        description: '',
        industry_tags: [],
      });
    }
  }

  // Strategy 3: Look for company name patterns near links
  // Extract company blocks — look for h2/h3 near company links
  const cardRx = /<(?:article|div)[^>]*class="[^"]*(?:company|result|card|listing)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  const parsed = [];
  while ((m = cardRx.exec(html)) !== null) {
    const block = m[1];
    const nameM = block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
    const urlM = block.match(/href="([^"]+\.html)"/i);
    if (nameM && urlM) {
      const url = urlM[1].startsWith('http') ? urlM[1] : baseUrl + urlM[1];
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        parsed.push({
          company_name: cleanText(nameM[1]),
          source_url: url,
          country: '',
          city: '',
          description: '',
          industry_tags: [],
        });
      }
    }
  }
  companies.push(...parsed);

  return dedupByUrl(companies);
}

function hasNextPageEuropages(html, currentPage) {
  return html.includes(`/p-${currentPage + 1}`) || html.includes(`page=${currentPage + 1}`);
}

// ─────────────────────────────────────────────
// wlw Scraper
// ─────────────────────────────────────────────
function parseWlw(html, searchUrl) {
  const companies = [];
  const baseUrl = 'https://www.wlw.com';

  // Strategy 1: __NEXT_DATA__ JSON blob (Next.js)
  const nextDataRx = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const ndMatch = nextDataRx.exec(html);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      // Navigate potential paths
      const pageProps = data?.props?.pageProps;
      const results =
        pageProps?.searchResults?.results ||
        pageProps?.searchResults?.companies ||
        pageProps?.results?.companies ||
        pageProps?.companies ||
        pageProps?.hits ||
        [];

      for (const c of results) {
        if (!c) continue;
        const slug = c.slug || c.id || '';
        companies.push({
          company_name: cleanText(c.name || c.companyName || c.title || ''),
          source_url: slug ? `${baseUrl}/en/company/${slug}` : (c.url || c.profileUrl || ''),
          country: c.country || c.address?.country || c.location?.country || '',
          city: c.city || c.address?.city || c.location?.city || '',
          description: cleanText(c.description || c.shortDescription || c.teaser || ''),
          website_url: c.website || c.websiteUrl || '',
          industry_tags: Array.isArray(c.tags) ? c.tags.map(t => (typeof t === 'string' ? t : t.name || '')) : [],
          employee_count: c.employeeCount || c.employees || '',
        });
      }
    } catch (_) { /* skip */ }
  }

  if (companies.length > 0) return dedupByUrl(companies);

  // Strategy 2: JSON-LD
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (['Organization', 'LocalBusiness', 'Corporation'].includes(item['@type']) && item.name) {
          companies.push({
            company_name: cleanText(item.name),
            source_url: item.url || '',
            country: item.address?.addressCountry || '',
            city: item.address?.addressLocality || '',
            description: cleanText(item.description || ''),
            website_url: item.sameAs || '',
            industry_tags: [],
          });
        }
      }
    } catch (_) { /* skip */ }
  }

  if (companies.length > 0) return dedupByUrl(companies);

  // Strategy 3: Extract company profile links
  const seenUrls = new Set();
  // wlw profile URLs: /en/company/slug or /de/unternehmen/slug
  const profileRx = /href="((?:https?:\/\/www\.wlw\.com)?\/(?:en|de|fr|nl)\/(?:company|unternehmen|entreprise|bedrijf)\/([^"?#/]+))"/gi;
  let m;
  while ((m = profileRx.exec(html)) !== null) {
    const profilePath = m[1];
    const profileUrl = profilePath.startsWith('http') ? profilePath : baseUrl + profilePath;
    if (!seenUrls.has(profileUrl)) {
      seenUrls.add(profileUrl);
      companies.push({
        company_name: slugToName(m[2]),
        source_url: profileUrl,
        country: '',
        city: '',
        description: '',
        industry_tags: [],
      });
    }
  }

  return dedupByUrl(companies);
}

function hasNextPageWlw(html, currentPage) {
  return (
    html.includes(`/page/${currentPage + 1}`) ||
    html.includes(`page=${currentPage + 1}`) ||
    html.includes(`"currentPage":${currentPage}`) ||
    html.includes(`"page":${currentPage + 1}`)
  );
}

// ─────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────
function slugToName(slug) {
  if (!slug) return 'Unknown';
  // Remove numeric suffixes like -12345 at the end
  const cleaned = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
  return cleaned.replace(/\b\w/g, l => l.toUpperCase());
}

function dedupByUrl(companies) {
  const seen = new Set();
  return companies.filter(c => {
    if (!c.source_url || seen.has(c.source_url)) return false;
    seen.add(c.source_url);
    return true;
  });
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

  const { url, source: providedSource } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // Detect source
  const source = providedSource && providedSource !== 'auto' ? providedSource : detectSource(url);
  if (source === 'unknown') {
    return res.status(400).json({ error: 'URL not recognized as Europages or wlw. Supported: europages.co.uk, europages.de, wlw.com, wlw.de, etc.' });
  }

  const { keyword, country } = extractSearchMeta(url, source);

  // Fetch the page
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let html;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: getBrowserHeaders(),
      redirect: 'follow',
    });

    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate limited by directory. Please wait 30 seconds before retrying.', retryAfter: 30 });
    }
    if (response.status === 403) {
      return res.status(403).json({ error: 'Access blocked by directory (403). Try again with a different browser or use a VPN.' });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `Directory returned HTTP ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return res.status(502).json({ error: 'Directory returned non-HTML response' });
    }

    html = await response.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out fetching directory page' });
    }
    return res.status(502).json({ error: `Failed to fetch directory: ${err.message}` });
  } finally {
    clearTimeout(timeout);
  }

  // Parse companies from HTML
  let companies = [];
  let hasNextPage = false;

  if (source === 'europages') {
    companies = parseEuropages(html, url);
    // Extract current page number from URL
    const pageMatch = url.match(/\/p-(\d+)(?:\.html)?/);
    const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
    hasNextPage = hasNextPageEuropages(html, currentPage);
  } else if (source === 'wlw') {
    companies = parseWlw(html, url);
    const pageMatch = url.match(/\/page\/(\d+)/);
    const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
    hasNextPage = hasNextPageWlw(html, currentPage);
  }

  // Attach metadata to each company
  const enrichedCompanies = companies.map(c => ({
    ...c,
    source,
    search_url: url,
    search_query: keyword,
    search_country: country,
    email_scrape_status: 'pending',
    outreach_status: 'new',
  }));

  return res.status(200).json({
    source,
    keyword,
    country,
    companies: enrichedCompanies,
    companiesFound: enrichedCompanies.length,
    hasNextPage,
    pageUrl: url,
  });
}
