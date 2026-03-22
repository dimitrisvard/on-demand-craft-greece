/**
 * Generic connector template for smaller markets
 * Used for: IT, PL, BE, SE, AT, DK, FI, PT, RO, EE, NO, CZ, HU, HR, SK, SI, BG, LT, LV, CY, LU, MT
 *
 * Each country gets a config object — the generic fetch logic scrapes their portal
 * and returns normalized tenders. As each portal's HTML structure is reverse-engineered,
 * the parsing can be improved in the country-specific config.
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getBrowserHeaders, getJsonHeaders, delay } from '../utils.js';

// Country-specific configurations
export const COUNTRY_CONFIGS = {
  IT: {
    countryCode: 'IT', countryName: 'Italy', language: 'it',
    portalName: 'ANAC / Servizio Contratti Pubblici',
    // ANAC Open Data API
    endpoints: [
      { url: 'https://dati.anticorruzione.it/opendata/api/dataset/contratti/jsonld?page=1&pagesize=50&tipo=avvisi', type: 'json' },
      { url: 'https://www.acquistinretepa.it/opencms/opencms/ricercaContratti?ricercaLibera=CNC', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:contratto|gara|appalto)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://dati.anticorruzione.it',
  },
  PL: {
    countryCode: 'PL', countryName: 'Poland', language: 'pl',
    portalName: 'BZP (Biuletyn Zamówień Publicznych)',
    endpoints: [
      { url: 'https://bzp.uzp.gov.pl/ZP400PodgladOpublikowanego.aspx?id=&SearchText=CNC&Status=1', type: 'html' },
      { url: 'https://ezamowienia.gov.pl/mo-client-board/bzp/search?query=CNC+obrobka&statusFilter=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:ZP400|ogloszenie|zamowienie)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://bzp.uzp.gov.pl',
  },
  BE: {
    countryCode: 'BE', countryName: 'Belgium', language: 'fr',
    portalName: 'e-Notification / e-Procurement',
    endpoints: [
      { url: 'https://eten.publicprocurement.be/etendering/searchNotices.do?searchType=ALL&cpvCode=42000000&status=ACTIVE', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|avis|aankondiging)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://eten.publicprocurement.be',
  },
  SE: {
    countryCode: 'SE', countryName: 'Sweden', language: 'sv',
    portalName: 'Kommers Annons',
    endpoints: [
      { url: 'https://www.kommersannons.se/pub/annons/list.aspx?type=1&cpv=42', type: 'html' },
      { url: 'https://www.tendsign.com/default.aspx?searchCPV=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:annons|notice|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.kommersannons.se',
  },
  AT: {
    countryCode: 'AT', countryName: 'Austria', language: 'de',
    portalName: 'Auftrag.at',
    endpoints: [
      { url: 'https://www.auftrag.at/suche/?cpv=42&status=offen', type: 'html' },
      { url: 'https://www.auftrag.at/rss/', type: 'rss' },
    ],
    linkPattern: /href="([^"]*(?:ausschreibung|auftrag|vergabe)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.auftrag.at',
  },
  DK: {
    countryCode: 'DK', countryName: 'Denmark', language: 'da',
    portalName: 'Udbud.dk',
    endpoints: [
      { url: 'https://www.udbud.dk/udbudsapi/notices?status=Active&cpv=42&page=1&pagesize=50', type: 'json' },
      { url: 'https://www.udbud.dk/notices?cpv=42&status=Active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|udbud|kontrakt)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.udbud.dk',
  },
  FI: {
    countryCode: 'FI', countryName: 'Finland', language: 'fi',
    portalName: 'Hilma',
    endpoints: [
      { url: 'https://hankintailmoitukset.fi/api/search?cpv=42&status=published&page=1&pageSize=50', type: 'json' },
      { url: 'https://www.hilma.fi/fi/notice/list?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|ilmoitus|hankinta)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://hankintailmoitukset.fi',
  },
  PT: {
    countryCode: 'PT', countryName: 'Portugal', language: 'pt',
    portalName: 'BASE',
    endpoints: [
      { url: 'https://www.base.gov.pt/Base4/en/ResultSearch/?type=search&tipo=2&cpv=42&estado=1&page=1&pageSize=50', type: 'html' },
      { url: 'https://www.base.gov.pt/api/announcement/?cpv=42&estado=1&page=1', type: 'json' },
    ],
    linkPattern: /href="([^"]*(?:announcement|anuncio|contrato)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.base.gov.pt',
  },
  RO: {
    countryCode: 'RO', countryName: 'Romania', language: 'ro',
    portalName: 'SEAP/SICAP',
    endpoints: [
      { url: 'https://www.e-licitatie.ro/pub/notices/ca-notices/list/1?cpv=42&status=1', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|anunt|licitatie)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.e-licitatie.ro',
  },
  EE: {
    countryCode: 'EE', countryName: 'Estonia', language: 'et',
    portalName: 'Riigihangete register',
    endpoints: [
      { url: 'https://riigihanked.riik.ee/rhr-web/api/v3/public/procurement-notices?status=ACTIVE&cpv=42&page=0&size=50', type: 'json' },
      { url: 'https://riigihanked.riik.ee/rhr-web/#/procurement?status=ACTIVE&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|hange)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://riigihanked.riik.ee',
  },
  NO: {
    countryCode: 'NO', countryName: 'Norway', language: 'no',
    portalName: 'Doffin',
    endpoints: [
      { url: 'https://doffin.no/api/NoticeSearch/SearchNotices?cpv=42&status=active&page=1&pageSize=50', type: 'json' },
      { url: 'https://doffin.no/Notices?cpv=42&status=A', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|kunngjoring|oppdrag)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://doffin.no',
  },
  CZ: {
    countryCode: 'CZ', countryName: 'Czechia', language: 'cs',
    portalName: 'Věstník veřejných zakázek',
    endpoints: [
      { url: 'https://www.vestnikverejnychzakazek.cz/en/search/?type=Z&cpv=42', type: 'html' },
      { url: 'https://www.portal-vz.cz/en/search/notice?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|contract)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.vestnikverejnychzakazek.cz',
  },
  HU: {
    countryCode: 'HU', countryName: 'Hungary', language: 'hu',
    portalName: 'Közbeszerzési Hatóság',
    endpoints: [
      { url: 'https://www.kozbeszerzes.hu/en/notices/search/?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|hirdetmeny|kozbeszerzés)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.kozbeszerzes.hu',
  },
  HR: {
    countryCode: 'HR', countryName: 'Croatia', language: 'hr',
    portalName: 'EOJN',
    endpoints: [
      { url: 'https://eojn.hr/Oglasnik/notices?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|oglas|nabava)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://eojn.hr',
  },
  SK: {
    countryCode: 'SK', countryName: 'Slovakia', language: 'sk',
    portalName: 'ÚVO',
    endpoints: [
      { url: 'https://www.uvo.gov.sk/vyhladavanie-zakaziek/zoznam-zakaziek?status=1&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|public)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.uvo.gov.sk',
  },
  SI: {
    countryCode: 'SI', countryName: 'Slovenia', language: 'sl',
    portalName: 'e-JN',
    endpoints: [
      { url: 'https://www.ejn.gov.si/ejn/index.html#!/en/procurement-notices?cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|razpis|narocilo)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.ejn.gov.si',
  },
  BG: {
    countryCode: 'BG', countryName: 'Bulgaria', language: 'bg',
    portalName: 'AOP',
    endpoints: [
      { url: 'https://www.aop.bg/e-sender/index.cfm?tab=1&action=searchPublicEn&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:tender|objava|publichna)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.aop.bg',
  },
  LT: {
    countryCode: 'LT', countryName: 'Lithuania', language: 'lt',
    portalName: 'CVP IS',
    endpoints: [
      { url: 'https://cvpp.eviesiejipirkimai.lt/en/notice-search?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|skelbimas|pirkimas)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://cvpp.eviesiejipirkimai.lt',
  },
  LV: {
    countryCode: 'LV', countryName: 'Latvia', language: 'lv',
    portalName: 'IUB / EIS',
    endpoints: [
      { url: 'https://www.eis.gov.lv/EKEIS/Supplier/Procurements?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|iepirkums|paziņojums)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.eis.gov.lv',
  },
  CY: {
    countryCode: 'CY', countryName: 'Cyprus', language: 'en',
    portalName: 'eProcurement',
    endpoints: [
      { url: 'https://eprocurement.gov.cy/epps/cft/listContractNotices.do?resourceId=0&status=ACTIVE', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|contract|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://eprocurement.gov.cy',
  },
  LU: {
    countryCode: 'LU', countryName: 'Luxembourg', language: 'fr',
    portalName: 'Marchés Publics Luxembourg',
    endpoints: [
      { url: 'https://marches.public.lu/fr/recherche-marches.html?cpv=42&statut=publie', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:marche|avis|contrat)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://marches.public.lu',
  },
  MT: {
    countryCode: 'MT', countryName: 'Malta', language: 'en',
    portalName: 'Department of Contracts',
    endpoints: [
      { url: 'https://contracts.gov.mt/en/Pages/Tenders/Open-Calls.aspx', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:call|tender|contract)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://contracts.gov.mt',
  },
};

/**
 * Generic fetch function for any country using its config
 */
export async function fetchCountry(countryCode) {
  const config = COUNTRY_CONFIGS[countryCode];
  if (!config) return { tenders: [], errors: [`No config for ${countryCode}`] };

  const tenders = [];
  const errors = [];

  for (const endpoint of config.endpoints) {
    try {
      await delay(800);

      const headers = endpoint.type === 'json'
        ? { ...getJsonHeaders(), 'Accept': 'application/json' }
        : getBrowserHeaders();

      const resp = await fetchWithTimeout(endpoint.url, { headers }, 20000);

      if (!resp.ok) {
        errors.push(`${countryCode} ${endpoint.url}: HTTP ${resp.status}`);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';

      if (endpoint.type === 'json' || contentType.includes('json')) {
        const data = await resp.json();
        const parsed = parseJsonResponse(data, config);
        tenders.push(...parsed);
      } else if (endpoint.type === 'rss' || contentType.includes('xml')) {
        const xml = await resp.text();
        const parsed = parseRssFeed(xml, config);
        tenders.push(...parsed);
      } else {
        const html = await resp.text();
        const parsed = parseHtmlPage(html, config, endpoint.url);
        tenders.push(...parsed);
      }
    } catch (err) {
      errors.push(`${countryCode} ${endpoint.url}: ${err.message}`);
    }
  }

  const seen = new Set();
  return {
    tenders: tenders.filter(t => {
      if (seen.has(t.tenderReference)) return false;
      seen.add(t.tenderReference);
      return true;
    }),
    errors,
  };
}

function parseJsonResponse(data, config) {
  const tenders = [];
  const items = Array.isArray(data) ? data :
    (data?.items || data?.results || data?.data || data?.content || data?.notices || []);

  for (const item of items.slice(0, 60)) {
    const ref = item?.id || item?.referenceNumber || item?.noticeId || item?.contractId;
    if (!ref) continue;

    const title = cleanText(
      item?.title || item?.subject || item?.description?.substring(0, 200) || ''
    );
    if (!title || title.length < 5) continue;

    tenders.push({
      countryCode: config.countryCode,
      countryName: config.countryName,
      portalName: config.portalName,
      portalUrl: item?.url || item?.link || `${config.baseUrl}/notice/${ref}`,
      tenderReference: `${config.countryCode.toLowerCase()}-${ref}`,
      title,
      description: cleanText(item?.description || item?.summary || '').substring(0, 500),
      buyerName: cleanText(item?.buyer?.name || item?.authority || item?.contracting_authority || ''),
      cpvCodes: extractCpvFromItem(item),
      estimatedValueEur: item?.value || item?.estimated_value || item?.amount,
      currency: item?.currency || 'EUR',
      publicationDate: parseIsoDate(item?.publication_date || item?.published || item?.created_at),
      submissionDeadline: parseIsoDate(item?.deadline || item?.submission_deadline || item?.closing_date),
      originalLanguage: config.language,
    });
  }

  return tenders;
}

function parseRssFeed(xml, config) {
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

    const refM = (link || '').match(/[?&]id=([^&]+)|\/(\d{4,})/);
    const ref = refM ? (refM[1] || refM[2]) : `${config.countryCode.toLowerCase()}-rss-${tenders.length}`;

    tenders.push({
      countryCode: config.countryCode,
      countryName: config.countryName,
      portalName: config.portalName,
      portalUrl: link || config.baseUrl,
      tenderReference: `${config.countryCode.toLowerCase()}-${ref}`,
      title: cleanText(title),
      description: cleanText(desc).substring(0, 500),
      publicationDate: parseIsoDate(pubDate),
      originalLanguage: config.language,
    });
  }
  return tenders;
}

function parseHtmlPage(html, config, pageUrl) {
  const tenders = [];
  const seen = new Set();

  // Use country-specific pattern
  const rx = new RegExp(config.linkPattern.source, config.linkPattern.flags);
  let m;
  while ((m = rx.exec(html)) !== null && tenders.length < 40) {
    const rawUrl = m[1];
    const title = cleanText(m[2]);
    if (!title || title.length < 5) continue;

    const url = rawUrl.startsWith('http') ? rawUrl : `${config.baseUrl}${rawUrl}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const refM = url.match(/[?&]id=([^&]+)|\/(\d{4,})/);
    const ref = refM ? (refM[1] || refM[2]) : `${config.countryCode.toLowerCase()}-html-${tenders.length}`;

    tenders.push({
      countryCode: config.countryCode,
      countryName: config.countryName,
      portalName: config.portalName,
      portalUrl: url,
      tenderReference: `${config.countryCode.toLowerCase()}-${ref}`,
      title,
      originalLanguage: config.language,
    });
  }

  return tenders;
}

function extractCpvFromItem(item) {
  const codes = [];
  const text = JSON.stringify(item);
  const cpvRx = /\b(1[4-9]|3[3-5]|38|42|44|50)\d{6}\b/g;
  let m;
  while ((m = cpvRx.exec(text)) !== null) codes.push(m[0]);
  if (item?.cpv) codes.push(...(Array.isArray(item.cpv) ? item.cpv : [String(item.cpv)]));
  return [...new Set(codes)];
}

function extractXmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m ? (m[1] || m[2] || '').trim() : '';
}

function extractAtomLink(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"/) || block.match(/<link>([^<]+)<\/link>/);
  return m ? m[1] : '';
}

function getJsonHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  };
}

function getBrowserHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  };
}
