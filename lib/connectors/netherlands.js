/**
 * Netherlands — TenderNed connector
 * Access: TenderNed open data API (OCDS-compatible)
 * Language: Dutch / English
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getJsonHeaders, getBrowserHeaders, delay } from '../utils.js';

const COUNTRY_CODE = 'NL';
const COUNTRY_NAME = 'Netherlands';
const PORTAL_NAME = 'TenderNed';
const PORTAL_BASE = 'https://www.tenderned.nl';
const LANGUAGE = 'nl';

// CPV prefixes for manufacturing (API accepts cpv parameter)
const MFG_CPV_PREFIXES = ['42', '44', '14', '38', '33', '34', '35', '50'];

/**
 * Fetch tenders from TenderNed open data API
 * Docs: https://tenderned.nl/api/
 */
export async function fetchNetherlands() {
  const tenders = [];
  const errors = [];

  // TenderNed has a public search API endpoint
  // We iterate over relevant CPV prefix categories
  for (const prefix of MFG_CPV_PREFIXES.slice(0, 4)) {
    try {
      await delay(800);

      // TenderNed search API
      const searchUrl = `${PORTAL_BASE}/aankondigingen/overzicht?cpv=${prefix}&page=1&pageSize=50`;
      const resp = await fetchWithTimeout(searchUrl, {
        headers: {
          ...getJsonHeaders(),
          'Accept': 'application/json',
        },
      }, 20000);

      if (!resp.ok) {
        errors.push(`TenderNed CPV ${prefix}: HTTP ${resp.status}`);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';

      // Try JSON first (API mode)
      if (contentType.includes('json')) {
        const data = await resp.json();
        const items = data?.items || data?.results || data?.aankondigingen || [];
        for (const item of items) {
          const tender = normalizeTenderNed(item);
          if (tender) tenders.push(tender);
        }
      } else {
        // HTML fallback - parse RSS/HTML page
        const html = await resp.text();
        const parsed = parseTenderNedHtml(html);
        tenders.push(...parsed);
      }
    } catch (err) {
      errors.push(`TenderNed CPV ${prefix}: ${err.message}`);
    }
  }

  // Also try the OCDS open data feed
  try {
    const ocdsUrl = `${PORTAL_BASE}/TenderNed/api/tenderned/publicatie/v1/?publicatietype=aankondiging_opdracht&page=0&size=50`;
    const resp = await fetchWithTimeout(ocdsUrl, { headers: getJsonHeaders() }, 20000);
    if (resp.ok) {
      const data = await resp.json();
      const items = data?.content || data?.items || [];
      for (const item of items) {
        const tender = normalizeTenderNedOcds(item);
        if (tender) tenders.push(tender);
      }
    }
  } catch (err) {
    errors.push(`TenderNed OCDS: ${err.message}`);
  }

  // Strategy 3: TED search as additional source
  try {
    await delay(500);
    const tedUrl = 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=NL';
    const resp = await fetchWithTimeout(tedUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 20000);
    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseTedHtmlFallback(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`TED NL search: ${err.message}`);
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

function normalizeTenderNed(item) {
  const ref = item?.publicatienummer || item?.id || item?.referentienummer;
  if (!ref) return null;

  return {
    countryCode: COUNTRY_CODE,
    countryName: COUNTRY_NAME,
    portalName: PORTAL_NAME,
    portalUrl: item?.url || `${PORTAL_BASE}/aankondigingen/details/${ref}`,
    tenderReference: String(ref),
    title: cleanText(item?.titel || item?.title || item?.naam || ''),
    description: cleanText(item?.omschrijving || item?.description || ''),
    buyerName: cleanText(item?.aanbestedendeDienst?.naam || item?.buyer || ''),
    cpvCodes: extractCpvCodes(item),
    estimatedValueEur: item?.waarde || item?.estimatedValue,
    currency: 'EUR',
    publicationDate: parseIsoDate(item?.publicatiedatum || item?.publicationDate),
    submissionDeadline: parseIsoDate(item?.sluitingsdatum || item?.deadline || item?.submissionDeadline),
    placeOfPerformance: cleanText(item?.plaatsVanUitvoering || item?.placeOfPerformance || ''),
    nutsCode: item?.nutsCode || item?.nuts,
    procedureType: mapProcedureType(item?.proceduretype || item?.procedureType),
    originalLanguage: LANGUAGE,
    rawData: item,
  };
}

function normalizeTenderNedOcds(item) {
  const ref = item?.referentienummer || item?.id;
  if (!ref) return null;

  const tender = item?.tender || item;
  return {
    countryCode: COUNTRY_CODE,
    countryName: COUNTRY_NAME,
    portalName: PORTAL_NAME,
    portalUrl: `${PORTAL_BASE}/aankondigingen/details/${ref}`,
    tenderReference: String(ref),
    title: cleanText(tender?.titel || tender?.title || ''),
    description: cleanText(tender?.omschrijving || ''),
    buyerName: cleanText(item?.aanbestedendeDienst?.naam || ''),
    cpvCodes: extractCpvCodes(tender),
    estimatedValueEur: tender?.waarde?.totaal,
    currency: 'EUR',
    publicationDate: parseIsoDate(item?.publicatiedatum),
    submissionDeadline: parseIsoDate(tender?.sluitingsdatum),
    originalLanguage: LANGUAGE,
    rawData: item,
  };
}

function parseTenderNedHtml(html) {
  const tenders = [];
  // Extract tender items from search results HTML
  const itemRx = /class="[^"]*(?:result|aankondiging|tender)[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*(?:result|aankondiging|tender)[^"]*"|$)/gi;
  let m;
  while ((m = itemRx.exec(html)) !== null && tenders.length < 50) {
    const block = m[1];
    const titleM = block.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i);
    const linkM = block.match(/href="([^"]*aankondigingen\/details\/[^"]+)"/i);
    const refM = block.match(/aankondigingen\/details\/([^"/?]+)/i);
    if (titleM && (linkM || refM)) {
      const ref = refM ? refM[1] : `nl-${Date.now()}-${tenders.length}`;
      tenders.push({
        countryCode: COUNTRY_CODE,
        countryName: COUNTRY_NAME,
        portalName: PORTAL_NAME,
        portalUrl: linkM ? `${PORTAL_BASE}${linkM[1]}` : `${PORTAL_BASE}/aankondigingen/details/${ref}`,
        tenderReference: ref,
        title: cleanText(titleM[1]),
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
    const ref = idM ? `ted-${idM[1]}` : `ted-nl-${tenders.length}`;
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

function extractCpvCodes(item) {
  if (!item) return [];
  const codes = [];
  if (item?.cpvCodes) codes.push(...(Array.isArray(item.cpvCodes) ? item.cpvCodes : [item.cpvCodes]));
  if (item?.cpv) codes.push(...(Array.isArray(item.cpv) ? item.cpv : [item.cpv]));
  if (item?.cpvCode) codes.push(item.cpvCode);
  // Extract CPV codes from text pattern like "42610000"
  const cpvRx = /\b(1[4-9]|3[3-5]|38|42|44|50)\d{6}\b/g;
  const text = JSON.stringify(item);
  let m;
  while ((m = cpvRx.exec(text)) !== null) {
    codes.push(m[0]);
  }
  return [...new Set(codes.map(c => String(c).replace(/[^0-9]/g, '')).filter(c => c.length >= 8))];
}

function mapProcedureType(raw) {
  if (!raw) return undefined;
  const r = raw.toLowerCase();
  if (r.includes('open')) return 'open';
  if (r.includes('restrict') || r.includes('beperkt')) return 'restricted';
  if (r.includes('negoti') || r.includes('onderhandel')) return 'negotiated';
  return raw;
}
