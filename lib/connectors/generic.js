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
    endpoints: [
      { url: 'https://dati.anticorruzione.it/opendata/api/3/action/datastore_search?resource_id=contratti&limit=50&q=CNC', type: 'json' },
      { url: 'https://dati.anticorruzione.it/superset/explore/json/?datasource_type=table&form_data=%7B%22limit%22%3A50%7D', type: 'json' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=IT', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:contratto|gara|appalto|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://dati.anticorruzione.it',
  },
  PL: {
    countryCode: 'PL', countryName: 'Poland', language: 'pl',
    portalName: 'BZP (Biuletyn Zamówień Publicznych)',
    endpoints: [
      { url: 'https://ezamowienia.gov.pl/mo-board/bzp/list?query=CNC&statusFilter=active', type: 'html' },
      { url: 'https://platformazakupowa.pl/transakcje?search=CNC+obrobka', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=PL', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:ZP400|ogloszenie|zamowienie|notice|transakcj)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://ezamowienia.gov.pl',
  },
  BE: {
    countryCode: 'BE', countryName: 'Belgium', language: 'fr',
    portalName: 'e-Notification / e-Procurement',
    endpoints: [
      { url: 'https://www.publicprocurement.be/en/search/tenders?cpv=42000000&status=open', type: 'html' },
      { url: 'https://enot.publicprocurement.be/enot-war/searchNotice.do?cpvCode=42000000&status=ACTIVE', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=BE', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|avis|aankondiging|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.publicprocurement.be',
  },
  SE: {
    countryCode: 'SE', countryName: 'Sweden', language: 'sv',
    portalName: 'TendSign / Mercell',
    endpoints: [
      { url: 'https://www.tendsign.com/Search?cpv=42&status=active', type: 'html' },
      { url: 'https://www.mercell.com/en/search/tenders?country=SE&cpv=42', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=SE', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:annons|notice|tender|opportunity)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.tendsign.com',
  },
  AT: {
    countryCode: 'AT', countryName: 'Austria', language: 'de',
    portalName: 'Auftrag.at',
    endpoints: [
      { url: 'https://www.auftrag.at/suche?cpv=42&status=offen', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=AT', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:ausschreibung|auftrag|vergabe|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.auftrag.at',
  },
  DK: {
    countryCode: 'DK', countryName: 'Denmark', language: 'da',
    portalName: 'Udbud.dk',
    endpoints: [
      { url: 'https://udbud.dk/Pages/Tenders/Search?cpv=42&status=Active', type: 'html' },
      { url: 'https://www.ethics.dk/ethics/eo#/bfe849ac-1d31-4ef1-9b1a-5a5b8bd95d42/homepage', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=DK', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|udbud|kontrakt|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://udbud.dk',
  },
  FI: {
    countryCode: 'FI', countryName: 'Finland', language: 'fi',
    portalName: 'Hilma',
    endpoints: [
      { url: 'https://www.hankintailmoitukset.fi/fi/search?cpv=42&status=published', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=FI', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|ilmoitus|hankinta|procurement)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.hankintailmoitukset.fi',
  },
  PT: {
    countryCode: 'PT', countryName: 'Portugal', language: 'pt',
    portalName: 'BASE',
    endpoints: [
      { url: 'https://www.base.gov.pt/Base4/en/ResultSearch/?type=search&tipo=2&cpv=42&estado=1&page=1&pageSize=50', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=PT', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:announcement|anuncio|contrato|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.base.gov.pt',
  },
  RO: {
    countryCode: 'RO', countryName: 'Romania', language: 'ro',
    portalName: 'SEAP/SICAP',
    endpoints: [
      { url: 'https://www.e-licitatie.ro/pub/notices/ca-notices/list/1?cpv=42&status=1', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=RO', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|anunt|licitatie)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.e-licitatie.ro',
  },
  EE: {
    countryCode: 'EE', countryName: 'Estonia', language: 'et',
    portalName: 'Riigihangete register',
    endpoints: [
      { url: 'https://riigihanked.riik.ee/rhr-web/api/v3/public/procurement-notices?status=ACTIVE&cpv=42&page=0&size=50', type: 'json' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=EE', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|hange|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://riigihanked.riik.ee',
  },
  NO: {
    countryCode: 'NO', countryName: 'Norway', language: 'no',
    portalName: 'Doffin',
    endpoints: [
      { url: 'https://doffin.no/notices?cpv=42&status=active', type: 'html' },
      { url: 'https://www.mercell.com/en/search/tenders?country=NO&cpv=42', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=NO', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|kunngjoring|oppdrag|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://doffin.no',
  },
  CZ: {
    countryCode: 'CZ', countryName: 'Czechia', language: 'cs',
    portalName: 'Věstník veřejných zakázek',
    endpoints: [
      { url: 'https://www.vestnikverejnychzakazek.cz/en/search/?type=Z&cpv=42', type: 'html' },
      { url: 'https://nen.nipez.cz/en/verejne-zakazky', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=CZ', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|contract|verejne)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.vestnikverejnychzakazek.cz',
  },
  HU: {
    countryCode: 'HU', countryName: 'Hungary', language: 'hu',
    portalName: 'Közbeszerzési Hatóság',
    endpoints: [
      { url: 'https://www.kozbeszerzes.hu/adatbazis/keres/?cpv=42&allapot=aktiv', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=HU', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|hirdetmeny|kozbeszerzés)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.kozbeszerzes.hu',
  },
  HR: {
    countryCode: 'HR', countryName: 'Croatia', language: 'hr',
    portalName: 'EOJN',
    endpoints: [
      { url: 'https://eojn.nn.hr/Oglasnik/notices?cpv=42&status=active', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=HR', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|oglas|nabava)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://eojn.nn.hr',
  },
  SK: {
    countryCode: 'SK', countryName: 'Slovakia', language: 'sk',
    portalName: 'ÚVO',
    endpoints: [
      { url: 'https://www.uvo.gov.sk/vyhladavanie/vyhladavanie-zakaziek?cpv=42&stav=zverejnena', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=SK', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|public|vyhladavanie)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.uvo.gov.sk',
  },
  SI: {
    countryCode: 'SI', countryName: 'Slovenia', language: 'sl',
    portalName: 'e-JN',
    endpoints: [
      { url: 'https://ejn.gov.si/en/procurement-notices?cpv=42', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=SI', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|razpis|narocilo|procurement)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://ejn.gov.si',
  },
  BG: {
    countryCode: 'BG', countryName: 'Bulgaria', language: 'bg',
    portalName: 'AOP / CRAS',
    endpoints: [
      { url: 'https://app.eop.bg/today/all?cpv=42', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=BG', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:tender|objava|publichna|notice|procedure)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://app.eop.bg',
  },
  LT: {
    countryCode: 'LT', countryName: 'Lithuania', language: 'lt',
    portalName: 'CVP IS',
    endpoints: [
      { url: 'https://cvpp.eviesiejipirkimai.lt/en/notice-search?cpv=42&status=active', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=LT', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|skelbimas|pirkimas)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://cvpp.eviesiejipirkimai.lt',
  },
  LV: {
    countryCode: 'LV', countryName: 'Latvia', language: 'lv',
    portalName: 'IUB / EIS',
    endpoints: [
      { url: 'https://www.eis.gov.lv/EKEIS/Supplier/Procurements?cpv=42&status=active', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=LV', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|iepirkums|paziņojums|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.eis.gov.lv',
  },
  CY: {
    countryCode: 'CY', countryName: 'Cyprus', language: 'en',
    portalName: 'eProcurement',
    endpoints: [
      { url: 'https://www.eprocurement.gov.cy/epps/cft/listContractNotices.do?resourceId=0&status=ACTIVE', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=CY', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|contract|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.eprocurement.gov.cy',
  },
  LU: {
    countryCode: 'LU', countryName: 'Luxembourg', language: 'fr',
    portalName: 'Marchés Publics Luxembourg',
    endpoints: [
      { url: 'https://marches.public.lu/fr/recherche.html?cpv=42&statut=publie', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=LU', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:marche|avis|contrat|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://marches.public.lu',
  },
  MT: {
    countryCode: 'MT', countryName: 'Malta', language: 'en',
    portalName: 'Department of Contracts',
    endpoints: [
      { url: 'https://www.gov.mt/en/Government/DOC/Pages/Calls-for-Tenders.aspx', type: 'html' },
      { url: 'https://ted.europa.eu/en/search/result?SF_S_CPV%5B%5D=42000000&SF_S_COUNTRY%5B%5D=MT', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:call|tender|contract|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.gov.mt',
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

