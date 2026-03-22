/**
 * Spain — Plataforma de Contratación del Estado
 * Access: RSS feeds + search scraping
 * Language: Spanish
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getBrowserHeaders, getJsonHeaders, delay } from '../utils.js';

const COUNTRY_CODE = 'ES';
const COUNTRY_NAME = 'Spain';
const PORTAL_NAME = 'Plataforma de Contratación del Estado';
const PORTAL_BASE = 'https://contrataciondelestado.es';
const LANGUAGE = 'es';

const MFG_CPV_PREFIXES = ['42', '44', '38', '14', '34'];

export async function fetchSpain() {
  const tenders = [];
  const errors = [];

  // Strategy 1: Atom/RSS feeds for each CPV category
  for (const cpv of MFG_CPV_PREFIXES.slice(0, 3)) {
    try {
      await delay(700);
      const feedUrl = `${PORTAL_BASE}/wps/poc?uri=deeplink:perfilContratante&lang=es&codigoCPV=${cpv}0000`;
      const resp = await fetchWithTimeout(feedUrl, {
        headers: { ...getJsonHeaders(), 'Accept': 'application/atom+xml, application/xml, */*' },
      }, 15000);
      if (resp.ok) {
        const xml = await resp.text();
        if (xml.includes('<entry>') || xml.includes('<item>')) {
          const parsed = parseAtomFeed(xml, cpv);
          tenders.push(...parsed);
        }
      }
    } catch (err) {
      errors.push(`PLACE feed CPV${cpv}: ${err.message}`);
    }
  }

  // Strategy 2: Open data API
  try {
    await delay(500);
    const apiUrl = `https://contrataciondelestado.es/api/search?cpv=42&status=ACTIVE&page=1&pageSize=50`;
    const resp = await fetchWithTimeout(apiUrl, { headers: getJsonHeaders() }, 15000);
    if (resp.ok) {
      const data = await resp.json();
      const items = data?.data || data?.items || data?.results || [];
      for (const item of items) {
        const t = normalizeSpain(item);
        if (t) tenders.push(t);
      }
    }
  } catch (err) {
    errors.push(`Contratación API: ${err.message}`);
  }

  // Strategy 3: HTML search scrape
  try {
    await delay(600);
    const searchUrl = `${PORTAL_BASE}/wps/poc?uri=deeplink:licitaciones&lang=es&codigoCPV=42`;
    const resp = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders('es-ES,es;q=0.9,en;q=0.8'),
    }, 20000);
    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseSpainHtml(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`Contratación scrape: ${err.message}`);
  }

  const seen = new Set();
  return {
    tenders: tenders.filter(t => { if (seen.has(t.tenderReference)) return false; seen.add(t.tenderReference); return true; }),
    errors,
  };
}

function parseAtomFeed(xml, cpvPrefix) {
  const tenders = [];
  const entryRx = /<(?:entry|item)>([\s\S]*?)<\/(?:entry|item)>/gi;
  let m;
  while ((m = entryRx.exec(xml)) !== null && tenders.length < 30) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractAtomLink(block);
    const desc = extractTag(block, 'summary') || extractTag(block, 'description');
    const published = extractTag(block, 'published') || extractTag(block, 'pubDate');
    if (!title) continue;
    const refM = (link || '').match(/[?&]id=([^&]+)|\/([A-Z0-9-]{6,})/i);
    const ref = refM ? (refM[1] || refM[2]) : `es-${cpvPrefix}-${tenders.length}`;
    tenders.push({
      countryCode: COUNTRY_CODE, countryName: COUNTRY_NAME, portalName: PORTAL_NAME,
      portalUrl: link || PORTAL_BASE, tenderReference: `es-${ref}`,
      title: cleanText(title), description: cleanText(desc),
      publicationDate: parseIsoDate(published), originalLanguage: LANGUAGE,
    });
  }
  return tenders;
}

function parseSpainHtml(html) {
  const tenders = [];
  const seen = new Set();
  const linkRx = /href="([^"]*(?:licitacion|expediente|contrato)[^"]*)"[^>]*>([^<]{10,200})</gi;
  let m;
  while ((m = linkRx.exec(html)) !== null && tenders.length < 30) {
    const url = m[1].startsWith('http') ? m[1] : `${PORTAL_BASE}${m[1]}`;
    if (seen.has(url)) continue; seen.add(url);
    const refM = url.match(/[?&]id=([^&]+)|\/([A-Z0-9-]{6,})/i);
    const ref = refM ? (refM[1] || refM[2]) : `es-html-${tenders.length}`;
    tenders.push({ countryCode: COUNTRY_CODE, countryName: COUNTRY_NAME, portalName: PORTAL_NAME,
      portalUrl: url, tenderReference: `es-${ref}`, title: cleanText(m[2]), originalLanguage: LANGUAGE });
  }
  return tenders;
}

function normalizeSpain(item) {
  const ref = item?.id || item?.expediente;
  if (!ref) return null;
  return {
    countryCode: COUNTRY_CODE, countryName: COUNTRY_NAME, portalName: PORTAL_NAME,
    portalUrl: item?.url || `${PORTAL_BASE}/expediente/${ref}`, tenderReference: `es-${ref}`,
    title: cleanText(item?.objeto || item?.title || ''),
    description: cleanText(item?.descripcion || ''),
    buyerName: cleanText(item?.organoContratacion || item?.buyer || ''),
    cpvCodes: extractCpvCodes(item),
    estimatedValueEur: item?.valorEstimado || item?.value,
    currency: 'EUR',
    publicationDate: parseIsoDate(item?.fechaPublicacion),
    submissionDeadline: parseIsoDate(item?.fechaLimite),
    originalLanguage: LANGUAGE,
  };
}

function extractAtomLink(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"/) || block.match(/<link>([^<]+)<\/link>/);
  return m ? m[1] : '';
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? (m[1] || m[2] || '').trim() : '';
}

function extractCpvCodes(item) {
  const codes = [];
  const text = JSON.stringify(item);
  const cpvRx = /\b(1[4-9]|3[3-5]|38|42|44|50)\d{6}\b/g;
  let m;
  while ((m = cpvRx.exec(text)) !== null) codes.push(m[0]);
  return [...new Set(codes)];
}
