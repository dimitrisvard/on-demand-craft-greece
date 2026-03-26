/**
 * TED (Tenders Electronic Daily) connector
 * Queries the EU's official TED API as a reliable fallback for all EU countries.
 * TED publishes all above-threshold EU public procurement notices.
 *
 * Strategies:
 *  1. TED v3 REST API (POST search)
 *  2. TED v3 GET search fallback
 *  3. TED search results HTML scrape fallback
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getJsonHeaders, getBrowserHeaders, delay } from '../utils.js';

const TED_API_BASE = 'https://api.ted.europa.eu/v3';
const TED_SEARCH_URL = `${TED_API_BASE}/notices/search`;
const TED_WEB_BASE = 'https://ted.europa.eu';

// Manufacturing / industrial CPV codes (division level)
const MFG_CPV_DIVISIONS = ['42', '43', '44', '45'];

const COUNTRY_NAMES = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
  DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
  LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands',
  PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia',
  ES: 'Spain', SE: 'Sweden', NO: 'Norway', CH: 'Switzerland',
};

/**
 * Search TED for tenders in a specific country.
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {{ tenders: Array, errors: string[] }}
 */
export async function fetchTed(countryCode) {
  const cc = countryCode.toUpperCase();
  const tenders = [];
  const errors = [];

  // Strategy 1: TED v3 POST search API
  try {
    const results = await searchTedV3Post(cc);
    tenders.push(...results);
  } catch (err) {
    errors.push(`TED v3 POST API: ${err.message}`);
  }

  // Strategy 2: TED v3 GET search API (fallback)
  if (tenders.length === 0) {
    try {
      await delay(500);
      const results = await searchTedV3Get(cc);
      tenders.push(...results);
    } catch (err) {
      errors.push(`TED v3 GET API: ${err.message}`);
    }
  }

  // Strategy 3: TED web search scraping (final fallback)
  if (tenders.length === 0) {
    try {
      await delay(500);
      const results = await scrapeTedSearch(cc);
      tenders.push(...results);
    } catch (err) {
      errors.push(`TED web scrape: ${err.message}`);
    }
  }

  // Deduplicate by reference
  const seen = new Set();
  const deduped = tenders.filter(t => {
    if (seen.has(t.tenderReference)) return false;
    seen.add(t.tenderReference);
    return true;
  });

  return { tenders: deduped, errors };
}

// ─── Strategy 1: TED v3 POST search ──────────────────────────

async function searchTedV3Post(countryCode) {
  const cpvQuery = MFG_CPV_DIVISIONS.map(d => `cpv:${d}*`).join(' OR ');
  const query = `(${cpvQuery}) AND country:${countryCode} AND status:active`;

  const body = {
    q: query,
    page: 1,
    pageSize: 50,
    scope: 'ALL',
    sortField: 'publication-date',
    sortOrder: 'DESC',
  };

  const resp = await fetchWithTimeout(TED_SEARCH_URL, {
    method: 'POST',
    headers: {
      ...getJsonHeaders(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  }, 25000);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const items = data?.notices || data?.results || data?.hits || data?.content || [];
  return (Array.isArray(items) ? items : []).slice(0, 60).map(item => normalizeTedNotice(item, countryCode)).filter(Boolean);
}

// ─── Strategy 2: TED v3 GET search ───────────────────────────

async function searchTedV3Get(countryCode) {
  const cpvPart = MFG_CPV_DIVISIONS.map(d => `cpv=${d}000000`).join('&');
  const url = `${TED_SEARCH_URL}?q=country:${countryCode}&${cpvPart}&pageSize=50&page=1&sortField=publication-date&sortOrder=DESC`;

  const resp = await fetchWithTimeout(url, {
    headers: {
      ...getJsonHeaders(),
      'Accept': 'application/json',
    },
  }, 25000);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('json')) {
    const data = await resp.json();
    const items = data?.notices || data?.results || data?.hits || data?.content || [];
    return (Array.isArray(items) ? items : []).slice(0, 60).map(item => normalizeTedNotice(item, countryCode)).filter(Boolean);
  }

  // If we got XML/RSS back, parse it
  if (contentType.includes('xml') || contentType.includes('rss')) {
    const xml = await resp.text();
    return parseTedRss(xml, countryCode);
  }

  return [];
}

// ─── Strategy 3: Scrape TED web search ───────────────────────

async function scrapeTedSearch(countryCode) {
  const tenders = [];

  for (const cpvDiv of MFG_CPV_DIVISIONS.slice(0, 2)) {
    if (tenders.length >= 30) break;
    await delay(600);

    const searchUrl = `${TED_WEB_BASE}/en/search/result?SF_S_CPV%5B%5D=${cpvDiv}000000&SF_S_COUNTRY%5B%5D=${countryCode}`;
    const resp = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 25000);

    if (!resp.ok) continue;

    const html = await resp.text();

    // Try to extract JSON data embedded in the page (common in modern SPAs)
    const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
      || html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
      || html.match(/window\.__DATA__\s*=\s*({[\s\S]*?});/);

    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const notices = data?.props?.pageProps?.notices
          || data?.props?.pageProps?.results
          || data?.notices || data?.results || [];
        for (const item of (Array.isArray(notices) ? notices : []).slice(0, 30)) {
          const t = normalizeTedNotice(item, countryCode);
          if (t) tenders.push(t);
        }
        continue;
      } catch { /* fall through to HTML parsing */ }
    }

    // Parse HTML directly - TED search result items
    const rowRx = /class="[^"]*(?:notice|result|search-result|list-item)[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*(?:notice|result|search-result|list-item)[^"]*"|<\/(?:ul|div|section|tbody)>)/gi;
    let m;
    while ((m = rowRx.exec(html)) !== null && tenders.length < 50) {
      const block = m[1];
      const titleM = block.match(/<a[^>]*href="([^"]*(?:\/notice\/|\/udl\?)[^"]*)"[^>]*>([^<]{5,250})<\/a>/i)
        || block.match(/<h[2-4][^>]*>([^<]{5,250})<\/h[2-4]>/i);
      if (!titleM) continue;

      const hasLink = titleM[2] !== undefined;
      const link = hasLink
        ? (titleM[1].startsWith('http') ? titleM[1] : `${TED_WEB_BASE}${titleM[1]}`)
        : '';
      const title = cleanText(hasLink ? titleM[2] : titleM[1]);

      // Extract notice ID from URL or block
      const idM = (link || block).match(/notice[/-](\d{5,})/i) || (link || block).match(/udl\?uri=TED:NOTICE:(\d+)/i);
      const ref = idM ? idM[1] : `ted-${countryCode.toLowerCase()}-${cpvDiv}-${tenders.length}`;

      // Extract buyer name
      const buyerM = block.match(/class="[^"]*(?:buyer|authority|organisation)[^"]*"[^>]*>([^<]+)</i);

      // Extract deadline
      const deadlineM = block.match(/(\d{2}\/\d{2}\/\d{4})/);
      let deadline;
      if (deadlineM) {
        const parts = deadlineM[1].split('/');
        if (parts.length === 3) {
          deadline = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }

      tenders.push({
        countryCode,
        countryName: COUNTRY_NAMES[countryCode] || countryCode,
        portalName: 'TED (Tenders Electronic Daily)',
        portalUrl: link || `${TED_WEB_BASE}/en/notice/-/${ref}`,
        tenderReference: `ted-${ref}`,
        title,
        buyerName: buyerM ? cleanText(buyerM[1]) : undefined,
        submissionDeadline: deadline ? parseIsoDate(deadline) : undefined,
        originalLanguage: 'en',
      });
    }

    // Fallback: grab any links that look like tender notices
    if (tenders.length === 0) {
      const linkRx = /href="([^"]*\/notice[s]?\/[^"]*)"[^>]*>([^<]{10,200})<\/a>/gi;
      while ((m = linkRx.exec(html)) !== null && tenders.length < 30) {
        const url = m[1].startsWith('http') ? m[1] : `${TED_WEB_BASE}${m[1]}`;
        const idM = url.match(/notice[/-](\d{5,})/i);
        const ref = idM ? idM[1] : `ted-${countryCode.toLowerCase()}-fb-${tenders.length}`;
        tenders.push({
          countryCode,
          countryName: COUNTRY_NAMES[countryCode] || countryCode,
          portalName: 'TED (Tenders Electronic Daily)',
          portalUrl: url,
          tenderReference: `ted-${ref}`,
          title: cleanText(m[2]),
          originalLanguage: 'en',
        });
      }
    }
  }

  return tenders;
}

// ─── RSS parser ──────────────────────────────────────────────

function parseTedRss(xml, countryCode) {
  const tenders = [];
  const entryRx = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = entryRx.exec(xml)) !== null && tenders.length < 50) {
    const block = m[1];
    const title = extractXmlTag(block, 'title');
    const link = extractXmlTag(block, 'link') || extractAtomLink(block);
    const desc = extractXmlTag(block, 'description') || extractXmlTag(block, 'summary');
    const pubDate = extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'published');
    if (!title || title.length < 5) continue;

    const idM = (link || '').match(/notice[/-](\d{5,})/i) || (link || '').match(/(\d{6,})/);
    const ref = idM ? idM[1] : `ted-rss-${countryCode.toLowerCase()}-${tenders.length}`;

    tenders.push({
      countryCode,
      countryName: COUNTRY_NAMES[countryCode] || countryCode,
      portalName: 'TED (Tenders Electronic Daily)',
      portalUrl: link || `${TED_WEB_BASE}/en/notice/-/${ref}`,
      tenderReference: `ted-${ref}`,
      title: cleanText(title),
      description: cleanText(desc).substring(0, 500),
      publicationDate: parseIsoDate(pubDate),
      originalLanguage: 'en',
    });
  }
  return tenders;
}

// ─── Normalize a TED API notice ──────────────────────────────

function normalizeTedNotice(item, countryCode) {
  if (!item) return null;

  // TED API responses can have different structures
  const notice = item?.notice || item?._source || item;

  const ref = notice?.noticeId || notice?.tedNoticeId || notice?.documentNumber
    || notice?.id || notice?.['publication-number'] || notice?.publicationNumber;
  if (!ref) return null;

  const title = cleanText(
    notice?.title || notice?.titleText || notice?.['title-text']
    || notice?.objectDescription || notice?.shortDescription || ''
  );
  if (!title || title.length < 5) return null;

  // Extract CPV codes
  const cpvCodes = [];
  const text = JSON.stringify(notice);
  const cpvRx = /\b(42|43|44|45)\d{6}\b/g;
  let cm;
  while ((cm = cpvRx.exec(text)) !== null) cpvCodes.push(cm[0]);
  if (notice?.cpv) {
    const cpvArr = Array.isArray(notice.cpv) ? notice.cpv : [notice.cpv];
    for (const c of cpvArr) {
      const code = typeof c === 'object' ? (c?.code || c?.cpvCode || '') : String(c);
      if (code) cpvCodes.push(String(code).replace(/[^0-9]/g, ''));
    }
  }

  // Extract value
  let estimatedValueEur;
  const val = notice?.estimatedValue || notice?.totalValue || notice?.value || notice?.['estimated-value'];
  if (typeof val === 'number') estimatedValueEur = val;
  else if (val?.amount) estimatedValueEur = val.amount;
  else if (typeof val === 'string') estimatedValueEur = parseFloat(val) || undefined;

  return {
    countryCode,
    countryName: COUNTRY_NAMES[countryCode] || countryCode,
    portalName: 'TED (Tenders Electronic Daily)',
    portalUrl: notice?.url || notice?.links?.html
      || `${TED_WEB_BASE}/en/notice/-/${ref}`,
    tenderReference: `ted-${ref}`,
    title,
    description: cleanText(
      notice?.description || notice?.shortDescription || notice?.['short-description']
      || notice?.objectDescription || ''
    ).substring(0, 500),
    buyerName: cleanText(
      notice?.buyerName || notice?.['contracting-authority']?.officialName
      || notice?.contractingAuthority?.officialName || notice?.buyer?.name
      || notice?.organisation?.name || ''
    ),
    buyerType: notice?.buyerType || notice?.['contracting-authority']?.type || undefined,
    cpvCodes: [...new Set(cpvCodes.filter(c => /^\d{8}$/.test(c)))],
    natureOfContract: mapNature(notice?.nature || notice?.contractType || notice?.['contract-type']),
    estimatedValueEur,
    estimatedValueOriginal: notice?.estimatedValueOriginal || undefined,
    currency: notice?.currency || 'EUR',
    publicationDate: parseIsoDate(
      notice?.publicationDate || notice?.['publication-date'] || notice?.published
    ),
    submissionDeadline: parseIsoDate(
      notice?.submissionDeadline || notice?.deadline || notice?.['time-limit']
      || notice?.receiptTenderDate || notice?.['receipt-tender-date']
    ),
    placeOfPerformance: cleanText(
      notice?.placeOfPerformance || notice?.['place-performance']
      || notice?.deliveryAddress?.town || ''
    ),
    nutsCode: notice?.nutsCode || notice?.['nuts-code'] || notice?.nuts || undefined,
    procedureType: mapProcedure(notice?.procedureType || notice?.['procedure-type'] || notice?.procedure),
    originalLanguage: notice?.language || notice?.originalLanguage || 'en',
    rawData: { tedId: ref, source: 'TED' },
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function mapNature(raw) {
  if (!raw) return undefined;
  const r = String(raw).toLowerCase();
  if (r.includes('supplies') || r.includes('supply')) return 'supplies';
  if (r.includes('service')) return 'services';
  if (r.includes('work')) return 'works';
  return raw;
}

function mapProcedure(raw) {
  if (!raw) return undefined;
  const r = String(raw).toLowerCase();
  if (r.includes('open')) return 'open';
  if (r.includes('restrict')) return 'restricted';
  if (r.includes('negoti') || r.includes('competitive dialogue')) return 'negotiated';
  return raw;
}

function extractXmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? (m[1] || m[2] || '').trim() : '';
}

function extractAtomLink(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"/) || block.match(/<link>([^<]+)<\/link>/);
  return m ? m[1] : '';
}
