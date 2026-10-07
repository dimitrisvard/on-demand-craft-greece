// Directory search-page parsers, ported unchanged from api/scan-directory.js:41-311 (cleanText, detectSource,
// extractSearchMeta, parseEuropages, hasNextPageEuropages, parseWlw, hasNextPageWlw, slugToName, dedupByUrl) and
// the answer it builds at :403-440. api/* stays as it is (it moves only in Phase 6); a test runs the Vercel handler
// through the Phase 2 shim on the same synthetic HTML and requires byte-equal JSON.
//
// Rules
//   - Every function keeps the handler's logic and the key order of the objects it builds (the JSON is compared
//     byte for byte); JSON values from the page are untyped, as in the handler.
//   - Pure: no fetch, no clock, no logging.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type DirectorySource = 'europages' | 'wlw';

export interface DirectoryCompany {
  company_name: string;
  source_url: string;
  country: string;
  city: string;
  description: string;
  website_url?: string;
  industry_tags: string[];
  employee_count?: string;
  [key: string]: unknown;
}

/** The 200 answer of /api/scan-directory (api/scan-directory.js:432-440). */
export interface DirectoryPageBody {
  source: string;
  keyword: string;
  country: string;
  companies: Array<DirectoryCompany & {
    source: string;
    search_url: string;
    search_query: string;
    search_country: string;
    email_scrape_status: 'pending';
    outreach_status: 'new';
  }>;
  companiesFound: number;
  hasNextPage: boolean;
  pageUrl: string;
}

export function cleanText(text: Json): string {
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

export function detectSource(url: string): DirectorySource | 'unknown' {
  const lower = url.toLowerCase();
  if (lower.includes('europages.')) return 'europages';
  if (lower.includes('wlw.com') || lower.includes('wlw.de') || lower.includes('wlw.at') || lower.includes('wlw.be')) return 'wlw';
  return 'unknown';
}

export function extractSearchMeta(url: string, source: string): { keyword: string; country: string } {
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

export function parseEuropages(html: string, _searchUrl: string): DirectoryCompany[] {
  const companies: DirectoryCompany[] = [];
  const baseUrl = 'https://www.europages.co.uk';

  // Strategy 1: JSON-LD structured data
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data: Json = JSON.parse(jm[1]);
      const items: Json[] = Array.isArray(data) ? data : [data];
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

  // Strategy 2: profile URLs from the HTML
  const seenUrls = new Set<string>();

  // Absolute profile links
  const absLinkRx = /href="(https?:\/\/www\.europages\.[a-z.]+\/(?!companies\/|search\/|categories\/)([^"?#]+?)\.html)"/gi;
  let m: RegExpExecArray | null;
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

  // Strategy 3: company name patterns near links
  const cardRx = /<(?:article|div)[^>]*class="[^"]*(?:company|result|card|listing)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  const parsed: DirectoryCompany[] = [];
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

export function hasNextPageEuropages(html: string, currentPage: number): boolean {
  return html.includes(`/p-${currentPage + 1}`) || html.includes(`page=${currentPage + 1}`);
}

export function parseWlw(html: string, _searchUrl: string): DirectoryCompany[] {
  const companies: DirectoryCompany[] = [];
  const baseUrl = 'https://www.wlw.com';

  // Strategy 1: __NEXT_DATA__ JSON blob (Next.js)
  const nextDataRx = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const ndMatch = nextDataRx.exec(html);
  if (ndMatch) {
    try {
      const data: Json = JSON.parse(ndMatch[1]);
      const pageProps = data?.props?.pageProps;
      const results: Json[] =
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
          industry_tags: Array.isArray(c.tags) ? c.tags.map((t: Json) => (typeof t === 'string' ? t : t.name || '')) : [],
          employee_count: c.employeeCount || c.employees || '',
        });
      }
    } catch (_) { /* skip */ }
  }

  if (companies.length > 0) return dedupByUrl(companies);

  // Strategy 2: JSON-LD
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data: Json = JSON.parse(jm[1]);
      const items: Json[] = Array.isArray(data) ? data : [data];
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

  // Strategy 3: company profile links (/en/company/slug or /de/unternehmen/slug)
  const seenUrls = new Set<string>();
  const profileRx = /href="((?:https?:\/\/www\.wlw\.com)?\/(?:en|de|fr|nl)\/(?:company|unternehmen|entreprise|bedrijf)\/([^"?#/]+))"/gi;
  let m: RegExpExecArray | null;
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

export function hasNextPageWlw(html: string, currentPage: number): boolean {
  return (
    html.includes(`/page/${currentPage + 1}`) ||
    html.includes(`page=${currentPage + 1}`) ||
    html.includes(`"currentPage":${currentPage}`) ||
    html.includes(`"page":${currentPage + 1}`)
  );
}

export function slugToName(slug: string): string {
  if (!slug) return 'Unknown';
  // Remove numeric suffixes like -12345 at the end
  const cleaned = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
  return cleaned.replace(/\b\w/g, (l) => l.toUpperCase());
}

export function dedupByUrl<T extends { source_url: string }>(companies: T[]): T[] {
  const seen = new Set<string>();
  return companies.filter((c) => {
    if (!c.source_url || seen.has(c.source_url)) return false;
    seen.add(c.source_url);
    return true;
  });
}

/** Companies and next-page flag of one fetched search page, as the handler computes them (:403-417). */
export function parseDirectoryPage(html: string, url: string, source: string): { companies: DirectoryCompany[]; hasNextPage: boolean } {
  let companies: DirectoryCompany[] = [];
  let hasNextPage = false;
  if (source === 'europages') {
    companies = parseEuropages(html, url);
    const pageMatch = url.match(/\/p-(\d+)(?:\.html)?/);
    const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
    hasNextPage = hasNextPageEuropages(html, currentPage);
  } else if (source === 'wlw') {
    companies = parseWlw(html, url);
    const pageMatch = url.match(/\/page\/(\d+)/);
    const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
    hasNextPage = hasNextPageWlw(html, currentPage);
  }
  return { companies, hasNextPage };
}

/** The handler's 200 body for a fetched page (:403-440): parsed companies with the scan metadata attached. */
export function directoryPageBody(html: string, url: string, source: string, meta: { keyword: string; country: string }): DirectoryPageBody {
  const { companies, hasNextPage } = parseDirectoryPage(html, url, source);
  const enrichedCompanies = companies.map((c) => ({
    ...c,
    source,
    search_url: url,
    search_query: meta.keyword,
    search_country: meta.country,
    email_scrape_status: 'pending' as const,
    outreach_status: 'new' as const,
  }));
  return {
    source,
    keyword: meta.keyword,
    country: meta.country,
    companies: enrichedCompanies,
    companiesFound: enrichedCompanies.length,
    hasNextPage,
    pageUrl: url,
  };
}

/** Page n of a search URL (the page scheme of the scan loops, mcp-server/src/index.ts:641-649). */
export function buildPageUrl(baseUrl: string, page: number, source: DirectorySource): string {
  if (page === 1) return baseUrl;
  if (source === 'europages') {
    const cleaned = baseUrl.replace(/\/p-\d+\.html$/, '.html').replace(/\.html$/, '');
    return `${cleaned}/p-${page}.html`;
  }
  const cleaned = baseUrl.replace(/\/page\/\d+/, '').replace(/\/$/, '');
  return `${cleaned}/page/${page}`;
}
