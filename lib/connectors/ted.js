/**
 * TED (Tenders Electronic Daily) connector
 * EU's official procurement publication portal.
 * Used as primary source for EU-wide notices AND as fallback for national portals.
 *
 * Strategies:
 *  1. TED v3 REST API (POST search) — fixed query syntax
 *  2. TED Open Data bulk RSS feed
 *  3. TED search results HTML scrape
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getJsonHeaders, getBrowserHeaders, delay } from '../utils.js';

const TED_API_BASE = 'https://api.ted.europa.eu/v3';
const TED_SEARCH_URL = `${TED_API_BASE}/notices/search`;
const TED_WEB_BASE = 'https://ted.europa.eu';

// ISO 3166-1 alpha-2 → alpha-3 mapping required by TED API v3
const CC3 = {
  AT: 'AUT', BE: 'BEL', BG: 'BGR', HR: 'HRV', CY: 'CYP', CZ: 'CZE', DK: 'DNK',
  EE: 'EST', FI: 'FIN', FR: 'FRA', DE: 'DEU', GR: 'GRC', HU: 'HUN', IE: 'IRL',
  IT: 'ITA', LV: 'LVA', LT: 'LTU', LU: 'LUX', MT: 'MLT', NL: 'NLD', PL: 'POL',
  PT: 'PRT', RO: 'ROU', SK: 'SVK', SI: 'SVN', ES: 'ESP', SE: 'SWE', NO: 'NOR',
  CH: 'CHE',
};

// Manufacturing CPV divisions (2-digit prefixes)
const MFG_CPV = ['42', '44', '43', '14', '38', '33', '34', '35', '50'];

const COUNTRY_NAMES = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
  DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
  LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands',
  PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia',
  ES: 'Spain', SE: 'Sweden', NO: 'Norway', CH: 'Switzerland',
};

/**
 * Search TED for manufacturing tenders in a specific country.
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {{ tenders: Array, errors: string[] }}
 */
export async function fetchTed(countryCode) {
  const cc = countryCode.toUpperCase();
  const tenders = [];
  const errors = [];

  // Strategy 1: TED v3 POST API with corrected query syntax
  try {
    const results = await searchTedV3Post(cc);
    tenders.push(...results);
    if (results.length > 0) {
      console.log(`[TED] ${cc}: ${results.length} tenders via API`);
    }
  } catch (err) {
    errors.push(`TED v3 POST API: ${err.message}`);
  }

  // Strategy 2: TED search RSS feed (works without JS rendering)
  if (tenders.length === 0) {
    try {
      await delay(500);
      const results = await fetchTedRss(cc);
      tenders.push(...results);
      if (results.length > 0) {
        console.log(`[TED] ${cc}: ${results.length} tenders via RSS`);
      }
    } catch (err) {
      errors.push(`TED RSS: ${err.message}`);
    }
  }

  // Strategy 3: TED search HTML scrape (last resort)
  if (tenders.length === 0) {
    try {
      await delay(500);
      const results = await scrapeTedSearch(cc);
      tenders.push(...results);
      if (results.length > 0) {
        console.log(`[TED] ${cc}: ${results.length} tenders via scrape`);
      }
    } catch (err) {
      errors.push(`TED web scrape: ${err.message}`);
    }
  }

  // Deduplicate by reference
  const seen = new Set();
  const deduped = tenders.filter(t => {
    if (!t.tenderReference || seen.has(t.tenderReference)) return false;
    seen.add(t.tenderReference);
    return true;
  });

  return { tenders: deduped, errors };
}

// ─── Strategy 1: TED v3 POST API ─────────────────────────────

async function searchTedV3Post(countryCode) {
  const cc3 = CC3[countryCode] || countryCode;

  // Build CPV query with correct TED v3 field name: "cpv-code"
  // Country field: "buyer-country" with ISO alpha-3 code
  // No "status:active" field — TED doesn't have this; filter by notice type instead
  const cpvPart = MFG_CPV.map(d => `cpv-code:${d}*`).join(' OR ');
  const query = `(${cpvPart}) AND buyer-country:${cc3}`;

  const body = {
    q: query,
    page: 0,
    pageSize: 50,
    fields: [
      'notice-id', 'publication-number', 'title-text', 'buyer-name',
      'cpv-code', 'buyer-country', 'publication-date',
      'deadline-receipt-request', 'estimated-value-highest',
      'procedure-type', 'notice-type', 'nuts-code',
    ],
    sortField: 'publication-date',
    sortOrder: 'DESC',
  };

  const resp = await fetchWithTimeout(TED_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  }, 25000);

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} — ${errBody.slice(0, 200)}`);
  }

  const data = await resp.json();
  // TED v3 response: { notices: [...], total: N, page: 0, pageSize: 50 }
  const items = data?.notices || data?.results || data?.hits || data?.content || [];
  return (Array.isArray(items) ? items : []).slice(0, 60)
    .map(item => normalizeTedNotice(item, countryCode))
    .filter(Boolean);
}

// ─── Strategy 2: TED RSS feed ────────────────────────────────

async function fetchTedRss(countryCode) {
  // TED provides RSS for search results
  // Try two CPV categories (42=industrial machinery, 44=metal products)
  const tenders = [];
  for (const cpv of ['42000000', '44000000', '43000000'].slice(0, 2)) {
    if (tenders.length >= 30) break;
    await delay(400);

    // TED search with RSS output — uses URL params
    const url = `${TED_WEB_BASE}/en/search/result?SF_S_CPV%5B%5D=${cpv}&SF_S_COUNTRY%5B%5D=${countryCode}&format=rss`;
    const resp = await fetchWithTimeout(url, {
      headers: { ...getBrowserHeaders('en-US,en;q=0.9'), 'Accept': 'application/rss+xml, application/xml, text/xml' },
    }, 20000);

    if (!resp.ok) continue;
    const xml = await resp.text();
    if (!xml.includes('<item') && !xml.includes('<entry')) continue;
    const parsed = parseTedRss(xml, countryCode);
    tenders.push(...parsed);
  }
  return tenders;
}

// ─── Strategy 3: TED search HTML scrape ──────────────────────

async function scrapeTedSearch(countryCode) {
  const tenders = [];

  for (const cpvDiv of ['42000000', '44000000'].slice(0, 2)) {
    if (tenders.length >= 30) break;
    await delay(600);

    const searchUrl = `${TED_WEB_BASE}/en/search/result?SF_S_CPV%5B%5D=${cpvDiv}&SF_S_COUNTRY%5B%5D=${countryCode}`;
    const resp = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 25000);

    if (!resp.ok) continue;
    const html = await resp.text();

    // Try JSON embedded in page (Next.js __NEXT_DATA__)
    const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const notices = data?.props?.pageProps?.notices
          || data?.props?.pageProps?.results
          || data?.notices || [];
        for (const item of (Array.isArray(notices) ? notices : []).slice(0, 30)) {
          const t = normalizeTedNotice(item, countryCode);
          if (t) tenders.push(t);
        }
        continue;
      } catch { /* fall through to HTML parsing */ }
    }

    // Parse actual tender notice links from HTML
    // TED notice links: /en/notice/-/detail/XXXXXX-YYYY or /en/notice/XXXXXX-YYYY
    const noticeLinks = new Map();
    const noticeLinkRx = /href="(https?:\/\/ted\.europa\.eu\/en\/notice\/[^"]+|\/en\/notice\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = noticeLinkRx.exec(html)) !== null && noticeLinks.size < 50) {
      const rawUrl = m[1];
      const rawTitle = m[2].replace(/<[^>]+>/g, '').trim();
      if (!rawTitle || rawTitle.length < 5) continue;
      // Skip navigation links
      if (/legal.notice|statistics|enotices|sending.electronic|my.ted|about.ted|advanced.search/i.test(rawUrl + rawTitle)) continue;

      const url = rawUrl.startsWith('http') ? rawUrl : `${TED_WEB_BASE}${rawUrl}`;
      // Extract notice ID from URL
      const idM = url.match(/\/notice\/(?:-\/detail\/)?([0-9]+-[0-9]+)/i)
        || url.match(/\/notice\/([^/?#]+)/i);
      const noticeId = idM ? idM[1] : null;
      if (noticeId && !noticeLinks.has(noticeId)) {
        noticeLinks.set(noticeId, { url, title: cleanText(rawTitle) });
      }
    }

    for (const [noticeId, { url, title }] of noticeLinks) {
      tenders.push({
        countryCode,
        countryName: COUNTRY_NAMES[countryCode] || countryCode,
        portalName: 'TED (Tenders Electronic Daily)',
        portalUrl: url,
        tenderReference: `ted-${noticeId}`,
        title,
        originalLanguage: 'en',
      });
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
    // Skip navigation/info links
    if (/legal.notice|statistics|enotices|sending.electronic/i.test(title + link)) continue;

    const idM = (link || '').match(/\/notice\/(?:-\/detail\/)?([0-9]+-[0-9]+)/i)
      || (link || '').match(/(\d{6,})/);
    const ref = idM ? idM[1] : `ted-rss-${countryCode.toLowerCase()}-${tenders.length}`;

    tenders.push({
      countryCode,
      countryName: COUNTRY_NAMES[countryCode] || countryCode,
      portalName: 'TED (Tenders Electronic Daily)',
      portalUrl: link ? (link.startsWith('http') ? link : `${TED_WEB_BASE}${link}`) : `${TED_WEB_BASE}/en/notice/-/detail/${ref}`,
      tenderReference: `ted-${ref}`,
      title: cleanText(title),
      description: cleanText(desc).substring(0, 500),
      publicationDate: parseIsoDate(pubDate),
      originalLanguage: 'en',
    });
  }
  return tenders;
}

// ─── Normalize a TED API v3 notice ───────────────────────────

function normalizeTedNotice(item, countryCode) {
  if (!item) return null;

  const notice = item?.notice || item?._source || item;

  // Try various ID field names used by TED v3
  const ref = notice?.['notice-id'] || notice?.['publication-number']
    || notice?.noticeId || notice?.tedNoticeId || notice?.documentNumber
    || notice?.id || notice?.publicationNumber;
  if (!ref) return null;

  // Title: TED v3 uses title-text as an object { ENG: "...", DEU: "..." }
  let titleRaw = notice?.['title-text'] || notice?.title || notice?.titleText
    || notice?.objectDescription || notice?.shortDescription || '';
  if (typeof titleRaw === 'object') {
    titleRaw = titleRaw?.ENG || titleRaw?.eng || Object.values(titleRaw)[0] || '';
  }
  const title = cleanText(String(titleRaw));
  if (!title || title.length < 5) return null;

  // Skip obvious non-tenders
  if (/legal.notice|statistics|enotices|sending.electronic|about.ted/i.test(title)) return null;

  // CPV codes
  const cpvCodes = [];
  const rawCpv = notice?.['cpv-code'] || notice?.cpv;
  if (rawCpv) {
    const cpvArr = Array.isArray(rawCpv) ? rawCpv : [rawCpv];
    for (const c of cpvArr) {
      const code = typeof c === 'object' ? (c?.code || c?.cpvCode || String(c?.value || '')) : String(c);
      const clean = code.replace(/[^0-9]/g, '');
      if (clean.length >= 2) cpvCodes.push(clean);
    }
  }
  // Also extract from raw JSON
  const cpvRx = /\b(42|43|44|45|14|38|33|34|35|50)\d{6}\b/g;
  const text = JSON.stringify(notice);
  let cm;
  while ((cm = cpvRx.exec(text)) !== null) cpvCodes.push(cm[0]);

  // Value
  let estimatedValueEur;
  const val = notice?.['estimated-value-highest'] || notice?.['estimated-value']
    || notice?.estimatedValue || notice?.totalValue || notice?.value;
  if (typeof val === 'number') estimatedValueEur = val;
  else if (val?.amount) estimatedValueEur = val.amount;
  else if (typeof val === 'string') estimatedValueEur = parseFloat(val) || undefined;

  // Buyer name: TED v3 uses buyer-name as object or array
  let buyerName = notice?.['buyer-name'] || notice?.buyerName
    || notice?.['contracting-authority']?.officialName
    || notice?.contractingAuthority?.officialName
    || notice?.buyer?.name || notice?.organisation?.name || '';
  if (typeof buyerName === 'object') {
    buyerName = buyerName?.ENG || buyerName?.eng || Object.values(buyerName)[0] || '';
  }
  if (Array.isArray(buyerName)) buyerName = buyerName[0] || '';

  // Build portal URL
  const noticeRef = String(ref).replace(/[^0-9A-Za-z-_]/g, '');
  const portalUrl = notice?.url || notice?.links?.html
    || `${TED_WEB_BASE}/en/notice/-/detail/${noticeRef}`;

  return {
    countryCode,
    countryName: COUNTRY_NAMES[countryCode] || countryCode,
    portalName: 'TED (Tenders Electronic Daily)',
    portalUrl,
    tenderReference: `ted-${ref}`,
    title,
    description: cleanText(
      (() => {
        let d = notice?.description || notice?.shortDescription || notice?.['short-description']
          || notice?.objectDescription || '';
        if (typeof d === 'object') d = d?.ENG || Object.values(d)[0] || '';
        return String(d);
      })()
    ).substring(0, 500),
    buyerName: cleanText(String(buyerName)),
    cpvCodes: [...new Set(cpvCodes.filter(c => /^\d{2,}$/.test(c)))],
    natureOfContract: mapNature(notice?.['contract-nature'] || notice?.nature || notice?.contractType),
    estimatedValueEur,
    currency: notice?.currency || 'EUR',
    publicationDate: parseIsoDate(
      notice?.['publication-date'] || notice?.publicationDate || notice?.published
    ),
    submissionDeadline: parseIsoDate(
      notice?.['deadline-receipt-request'] || notice?.submissionDeadline
      || notice?.deadline || notice?.['time-limit'] || notice?.receiptTenderDate
    ),
    nutsCode: notice?.['nuts-code'] || notice?.nutsCode || notice?.nuts,
    procedureType: mapProcedure(notice?.['procedure-type'] || notice?.procedureType || notice?.procedure),
    originalLanguage: notice?.language || notice?.originalLanguage || 'en',
    rawData: { tedId: String(ref), source: 'TED' },
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
