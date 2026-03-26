/**
 * France — BOAMP connector
 * Access: Open data API on data.gouv.fr
 * Language: French
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getJsonHeaders, getBrowserHeaders, delay } from '../utils.js';

const COUNTRY_CODE = 'FR';
const COUNTRY_NAME = 'France';
const PORTAL_NAME = 'BOAMP';
const PORTAL_BASE = 'https://www.boamp.fr';
const DATAGOUV_API = 'https://www.data.gouv.fr/api/1';
const LANGUAGE = 'fr';

// data.gouv.fr dataset IDs for BOAMP
const BOAMP_DATASET_ID = 'boamp';
const PLACE_DATASET = 'marches-publics-boamp';

/**
 * Fetch tenders from BOAMP via data.gouv.fr open data API
 */
export async function fetchFrance() {
  const tenders = [];
  const errors = [];

  // Strategy 1: data.gouv.fr API - get BOAMP dataset resources
  try {
    const apiUrl = `${DATAGOUV_API}/datasets/?q=BOAMP+marches+publics&page=1&page_size=5`;
    const resp = await fetchWithTimeout(apiUrl, { headers: getJsonHeaders() }, 15000);
    if (resp.ok) {
      const data = await resp.json();
      const datasets = data?.data || [];
      for (const ds of datasets.slice(0, 2)) {
        if (ds?.id) {
          const dsUrl = `${DATAGOUV_API}/datasets/${ds.id}/`;
          const dsResp = await fetchWithTimeout(dsUrl, { headers: getJsonHeaders() }, 15000);
          if (dsResp.ok) {
            const dsData = await dsResp.json();
            const resources = dsData?.resources || [];
            // Get most recent JSON/CSV resource
            const jsonResource = resources.find(r =>
              r?.format?.toLowerCase() === 'json' ||
              r?.url?.includes('.json')
            );
            if (jsonResource?.url) {
              const fileResp = await fetchWithTimeout(jsonResource.url, { headers: getJsonHeaders() }, 30000);
              if (fileResp.ok) {
                const fileData = await fileResp.json();
                const items = Array.isArray(fileData) ? fileData : (fileData?.features || fileData?.data || []);
                for (const item of items.slice(0, 100)) {
                  const t = normalizeBoamp(item);
                  if (t) tenders.push(t);
                }
              }
            }
          }
        }
        await delay(500);
      }
    }
  } catch (err) {
    errors.push(`BOAMP data.gouv.fr API: ${err.message}`);
  }

  // Strategy 2: BOAMP direct search API
  try {
    await delay(500);
    // BOAMP has a search endpoint - manufacturing CPV codes
    const cpvGroups = ['42', '44', '38'];
    for (const cpv of cpvGroups) {
      const searchUrl = `${PORTAL_BASE}/boamp/api/search/?q=&cpv_code=${cpv}&rows=50&start=0`;
      const resp = await fetchWithTimeout(searchUrl, {
        headers: { ...getJsonHeaders(), 'Accept': 'application/json' },
      }, 15000);

      if (resp.ok) {
        const data = await resp.json();
        const items = data?.results || data?.items || data?.hits?.hits || [];
        for (const item of items) {
          const t = normalizeBoampSearch(item);
          if (t) tenders.push(t);
        }
      }
      await delay(600);
    }
  } catch (err) {
    errors.push(`BOAMP search API: ${err.message}`);
  }

  // Strategy 3: BOAMP RSS/Atom feed
  try {
    const rssUrl = `${PORTAL_BASE}/boamp/avis/rss/?types=appel_offres`;
    const resp = await fetchWithTimeout(rssUrl, {
      headers: { ...getJsonHeaders(), 'Accept': 'application/rss+xml, application/xml' },
    }, 15000);
    if (resp.ok) {
      const xml = await resp.text();
      const parsed = parseBoampRss(xml);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`BOAMP RSS: ${err.message}`);
  }

  // Strategy 4: TED search for French tenders as additional source
  try {
    await delay(500);
    const tedUrl = 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=FR';
    const resp = await fetchWithTimeout(tedUrl, {
      headers: getBrowserHeaders('en-US,en;q=0.9'),
    }, 20000);
    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseTedHtmlFallback(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`TED FR search: ${err.message}`);
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

function normalizeBoamp(item) {
  const ref = item?.idweb || item?.id || item?.numero || item?.reference;
  if (!ref) return null;

  return {
    countryCode: COUNTRY_CODE,
    countryName: COUNTRY_NAME,
    portalName: PORTAL_NAME,
    portalUrl: item?.url || `${PORTAL_BASE}/boamp/avis/${ref}`,
    tenderReference: String(ref),
    title: cleanText(item?.objet || item?.titre || item?.title || item?.intitule || ''),
    description: cleanText(item?.description || item?.nature_marche || ''),
    buyerName: cleanText(item?.acheteur?.denomination || item?.organisme || item?.buyer || ''),
    cpvCodes: extractCpvFromBoamp(item),
    estimatedValueEur: item?.valeur_estimee || item?.montant || item?.value,
    currency: 'EUR',
    publicationDate: parseIsoDate(item?.date_publication || item?.published_at),
    submissionDeadline: parseIsoDate(item?.date_limite || item?.date_remise_offres || item?.deadline),
    placeOfPerformance: cleanText(item?.lieu_execution || item?.commune || item?.departement || ''),
    nutsCode: item?.code_nuts,
    procedureType: mapFrProcedure(item?.procedure || item?.type_marche),
    natureOfContract: mapFrNature(item?.nature || item?.type),
    originalLanguage: LANGUAGE,
    rawData: { idweb: ref, objet: item?.objet, acheteur: item?.acheteur },
  };
}

function normalizeBoampSearch(item) {
  const src = item?._source || item;
  const ref = src?.idweb || src?.id || item?._id;
  if (!ref) return null;

  return {
    countryCode: COUNTRY_CODE,
    countryName: COUNTRY_NAME,
    portalName: PORTAL_NAME,
    portalUrl: `${PORTAL_BASE}/boamp/avis/${ref}`,
    tenderReference: String(ref),
    title: cleanText(src?.objet || src?.intitule || ''),
    description: cleanText(src?.description || ''),
    buyerName: cleanText(src?.acheteur?.denomination || ''),
    cpvCodes: extractCpvFromBoamp(src),
    estimatedValueEur: src?.valeur_estimee,
    currency: 'EUR',
    publicationDate: parseIsoDate(src?.date_publication),
    submissionDeadline: parseIsoDate(src?.date_limite_remise_offres),
    originalLanguage: LANGUAGE,
  };
}

function parseBoampRss(xml) {
  const tenders = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null && tenders.length < 50) {
    const block = m[1];
    const title = extractXmlTag(block, 'title');
    const link = extractXmlTag(block, 'link');
    const desc = extractXmlTag(block, 'description');
    const pubDate = extractXmlTag(block, 'pubDate');
    const guid = extractXmlTag(block, 'guid');

    if (!title) continue;

    const refM = (link || guid || '').match(/\/avis\/([^/?#]+)/i) || (link || guid || '').match(/ref=([^&]+)/i);
    const ref = refM ? refM[1] : `fr-rss-${tenders.length}`;

    // Extract CPV codes from description
    const cpvRx = /\b(1[4-9]|3[3-5]|38|42|44|50)\d{6}\b/g;
    const cpvMatches = [];
    let cpvM;
    while ((cpvM = cpvRx.exec(desc || '')) !== null) {
      cpvMatches.push(cpvM[0]);
    }

    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: link || `${PORTAL_BASE}`,
      tenderReference: ref,
      title: cleanText(title),
      description: cleanText(desc),
      cpvCodes: cpvMatches,
      publicationDate: parseIsoDate(pubDate),
      originalLanguage: LANGUAGE,
    });
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
    const ref = idM ? `ted-${idM[1]}` : `ted-fr-${tenders.length}`;
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

function extractCpvFromBoamp(item) {
  const codes = [];
  if (item?.code_cpv) codes.push(String(item.code_cpv));
  if (Array.isArray(item?.cpv)) codes.push(...item.cpv.map(c => String(c)));
  if (item?.cpv_codes) codes.push(...(Array.isArray(item.cpv_codes) ? item.cpv_codes : [item.cpv_codes]).map(c => String(c)));
  // Text scan
  const text = JSON.stringify(item);
  const cpvRx = /\b(1[4-9]|3[3-5]|38|42|44|50)\d{6}\b/g;
  let m;
  while ((m = cpvRx.exec(text)) !== null) codes.push(m[0]);
  return [...new Set(codes.filter(c => /^\d{8}$/.test(c)))];
}

function mapFrProcedure(raw) {
  if (!raw) return undefined;
  const r = raw.toLowerCase();
  if (r.includes('ouverte') || r.includes('open')) return 'open';
  if (r.includes('restreinte') || r.includes('restrict')) return 'restricted';
  if (r.includes('négoci') || r.includes('negoti')) return 'negotiated';
  return raw;
}

function mapFrNature(raw) {
  if (!raw) return undefined;
  const r = raw.toLowerCase();
  if (r.includes('fournitures') || r.includes('supplies')) return 'supplies';
  if (r.includes('services')) return 'services';
  if (r.includes('travaux') || r.includes('works')) return 'works';
  return undefined;
}

function extractXmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return (m[1] || m[2] || '').trim();
}
