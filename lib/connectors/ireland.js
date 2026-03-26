/**
 * Ireland — eTenders connector
 * Access: RSS feeds + search scraping
 * Language: English (huge advantage)
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getBrowserHeaders, getJsonHeaders, delay } from '../utils.js';

const COUNTRY_CODE = 'IE';
const COUNTRY_NAME = 'Ireland';
const PORTAL_NAME = 'eTenders';
const PORTAL_BASE = 'https://etenders.gov.ie';
const LANGUAGE = 'en';

// Manufacturing-relevant search terms for eTenders search
const SEARCH_TERMS = [
  'CNC machining', 'sheet metal', '3D printing', 'metal fabrication',
  'precision parts', 'injection molding', 'machined components',
  'metal components', 'laser cutting', 'prototype',
];

/**
 * Fetch tenders from eTenders (Ireland)
 * Strategy 1: RSS feed for new notices
 * Strategy 2: Search page scraping
 */
export async function fetchIreland() {
  const tenders = [];
  const errors = [];

  // Strategy 1: RSS feed
  try {
    const rssUrl = `${PORTAL_BASE}/rss/notices.xml`;
    const resp = await fetchWithTimeout(rssUrl, {
      headers: {
        ...getJsonHeaders(),
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    }, 15000);

    if (resp.ok) {
      const xml = await resp.text();
      const parsed = parseRss(xml);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`eTenders RSS: ${err.message}`);
  }

  // Strategy 2: Search page with manufacturing keywords
  for (const term of SEARCH_TERMS.slice(0, 5)) {
    try {
      await delay(1000);
      const searchUrl = `${PORTAL_BASE}/epps/quickSearchAction.do?d-3116927-p=1&searchMode=quick&searchType=N&searchText=${encodeURIComponent(term)}&STATUS=A`;
      const resp = await fetchWithTimeout(searchUrl, {
        headers: getBrowserHeaders('en-US,en;q=0.9'),
      }, 20000);

      if (resp.ok) {
        const html = await resp.text();
        const parsed = parseETendersHtml(html, term);
        tenders.push(...parsed);
      }
    } catch (err) {
      errors.push(`eTenders search "${term}": ${err.message}`);
    }
  }

  // Strategy 3: Try the newer eTenders portal
  try {
    await delay(500);
    const newUrl = `${PORTAL_BASE}/organisation/supplier/opportunityListing/list.html?categoryId=0&status=ACTIVE`;
    const resp = await fetchWithTimeout(newUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 20000);
    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseETendersNewPortal(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`eTenders listing: ${err.message}`);
  }

  // Strategy 4: TED search for Irish tenders as additional source
  try {
    await delay(500);
    const tedUrl = 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=IE';
    const resp = await fetchWithTimeout(tedUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 20000);
    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseTedHtmlFallback(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`TED IE search: ${err.message}`);
  }

  // Deduplicate
  const seen = new Set();
  const deduped = tenders.filter(t => {
    if (seen.has(t.tenderReference)) return false;
    seen.add(t.tenderReference);
    return true;
  });

  return { tenders: deduped, errors };
}

function parseRss(xml) {
  const tenders = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const desc = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');
    const guid = extractTag(block, 'guid');

    if (!title) continue;

    // Extract reference from URL
    const refM = (link || guid || '').match(/[?&]id=(\d+)|\/(\d+)(?:\/|$)/);
    const ref = refM ? (refM[1] || refM[2]) : `ie-rss-${Date.now()}-${tenders.length}`;

    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: link || `${PORTAL_BASE}`,
      tenderReference: ref,
      title: cleanText(title),
      description: cleanText(desc),
      publicationDate: parseIsoDate(pubDate),
      originalLanguage: LANGUAGE,
    });
  }
  return tenders;
}

function parseETendersHtml(html, searchTerm) {
  const tenders = [];

  // Try to find tender rows in search results table
  const rowRx = /<tr[^>]*class="[^"]*(?:result|search-result|list-item)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRx.exec(html)) !== null && tenders.length < 30) {
    const row = m[1];
    const titleM = row.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!titleM) continue;

    const link = titleM[1].startsWith('http') ? titleM[1] : `${PORTAL_BASE}${titleM[1]}`;
    const refM = link.match(/[?&](?:id|refId|noticeId)=(\w+)|\/(\w+)(?:\?|$)/);
    const ref = refM ? (refM[1] || refM[2]) : `ie-${searchTerm.substring(0, 5)}-${tenders.length}`;

    // Extract value if present
    const valueM = row.match(/€[\s]*([\d,\.]+)/);
    let valueEur;
    if (valueM) {
      valueEur = parseFloat(valueM[1].replace(/,/g, ''));
    }

    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: link,
      tenderReference: String(ref),
      title: cleanText(titleM[2]),
      estimatedValueEur: valueEur,
      currency: 'EUR',
      originalLanguage: LANGUAGE,
    });
  }

  // Fallback: generic link extraction
  if (tenders.length === 0) {
    const linkRx = /href="([^"]*(?:opportunity|notice|tender|contract)[^"]*)"[^>]*>([^<]{10,120})</gi;
    while ((m = linkRx.exec(html)) !== null && tenders.length < 20) {
      const url = m[1].startsWith('http') ? m[1] : `${PORTAL_BASE}${m[1]}`;
      const refM = url.match(/[?&]id=(\w+)|\/(\d+)(?:\/|$)/);
      const ref = refM ? (refM[1] || refM[2]) : `ie-${tenders.length}`;
      tenders.push({
        countryCode: COUNTRY_CODE,
        countryName: COUNTRY_NAME,
        portalName: PORTAL_NAME,
        portalUrl: url,
        tenderReference: `ie-${ref}`,
        title: cleanText(m[2]),
        originalLanguage: LANGUAGE,
      });
    }
  }

  return tenders;
}

function parseTedHtmlFallback(html) {
  const tenders = [];
  const seen = new Set();
  const linkRx = /href="([^"]*\/notice[s]?\/[^"]*)"[^>]*>([^<]{10,200})<\/a>/gi;
  let m;
  while ((m = linkRx.exec(html)) !== null && tenders.length < 30) {
    const url = m[1].startsWith('http') ? m[1] : `https://ted.europa.eu${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const idM = url.match(/notice[/-](\d{5,})/i);
    const ref = idM ? `ted-${idM[1]}` : `ted-ie-${tenders.length}`;
    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: 'TED (Tenders Electronic Daily)',
      portalUrl: url,
      tenderReference: ref,
      title: cleanText(m[2]),
      originalLanguage: 'en',
    });
  }
  return tenders;
}

function parseETendersNewPortal(html) {
  const tenders = [];
  // New portal structure
  const cardRx = /class="[^"]*opportunity[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*opportunity[^"]*"|<\/ul>|<\/div>\s*<\/div>)/gi;
  let m;
  while ((m = cardRx.exec(html)) !== null && tenders.length < 30) {
    const card = m[1];
    const titleM = card.match(/<h[2-4][^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i)
      || card.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*title[^"]*">([^<]+)<\/a>/i);
    if (!titleM) continue;
    const url = titleM[1].startsWith('http') ? titleM[1] : `${PORTAL_BASE}${titleM[1]}`;
    const refM = url.match(/\/(\d+)(?:\/|$)|[?&]id=(\d+)/);
    const ref = refM ? (refM[1] || refM[2]) : `ie-new-${tenders.length}`;
    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: url,
      tenderReference: `ie-${ref}`,
      title: cleanText(titleM[2]),
      originalLanguage: LANGUAGE,
    });
  }
  return tenders;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return (m[1] || m[2] || '').trim();
}
