/**
 * Generic connector template for smaller markets
 * Used for: IT, PL, BE, SE, AT, DK, FI, PT, RO, EE, NO, CZ, HU, HR, SK, SI, BG, LT, LV, CY, LU, MT, GR, CH
 *
 * Each country gets a config object — the generic fetch logic scrapes their portal
 * and returns normalized tenders.
 *
 * IMPORTANT: Do NOT include ted.europa.eu/en/search/result as an endpoint here.
 * TED HTML pages render client-side (SPA) so scraping them produces navigation links,
 * not real tenders. The proper TED fallback is in tender-scan.js via fetchTed().
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getBrowserHeaders, getJsonHeaders, delay } from '../utils.js';

// Country-specific configurations
export const COUNTRY_CONFIGS = {
  IT: {
    countryCode: 'IT', countryName: 'Italy', language: 'it',
    portalName: 'Acquisti in Rete PA',
    endpoints: [
      // ANAC open data API — different resource ID for active contracts
      { url: 'https://dati.anticorruzione.it/opendata/api/3/action/datastore_search?resource_id=bandi_cig&limit=50&q=CNC', type: 'json' },
      // Simtel / MePA search
      { url: 'https://www.acquistinretepa.it/opencms/opencms/main/home/ricerca/gare-in-corso.html?tipologiaContratto=Fornitura&cpv=42000000', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:contratto|gara|appalto|notice|cig)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://dati.anticorruzione.it',
  },
  PL: {
    countryCode: 'PL', countryName: 'Poland', language: 'pl',
    portalName: 'Platforma e-Zamówienia',
    endpoints: [
      // New e-Zamówienia API (replaced BZP in 2022)
      { url: 'https://ezamowienia.gov.pl/mo-board/api/v3/search?phrase=CNC+obrobka&status=PUBLISHED&sortOrder=DESC&pageSize=50', type: 'json' },
      { url: 'https://ezamowienia.gov.pl/mo-board/notices?query=CNC&sortBy=publicationDate&status=published', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:ZP400|ogloszenie|zamowienie|notice|order)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://ezamowienia.gov.pl',
  },
  BE: {
    countryCode: 'BE', countryName: 'Belgium', language: 'fr',
    portalName: 'e-Notification',
    endpoints: [
      { url: 'https://enot.publicprocurement.be/enot-war/searchNotice.do?cpvCode=42000000&status=OPEN', type: 'html' },
      { url: 'https://www.publicprocurement.be/en/search/tenders?cpv=42000000', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|avis|aankondiging|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://enot.publicprocurement.be',
  },
  SE: {
    countryCode: 'SE', countryName: 'Sweden', language: 'sv',
    portalName: 'Mercell',
    endpoints: [
      // Mercell is main SE procurement aggregator
      { url: 'https://www.mercell.com/en/search/tenders?country=SE&cpv=42&status=active', type: 'html' },
      { url: 'https://www.kommersannons.se/notice/search?cpv=42000000&status=open', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:annons|notice|tender|opportunity|upphandling)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.mercell.com',
  },
  AT: {
    countryCode: 'AT', countryName: 'Austria', language: 'de',
    portalName: 'Auftrag.at',
    endpoints: [
      // auftrag.at search
      { url: 'https://www.auftrag.at/ausschreibungen?cpv=42000000&status=open', type: 'html' },
      { url: 'https://www.vergabe.at/ausschreibungen?cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:ausschreibung|auftrag|vergabe|notice|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.auftrag.at',
  },
  DK: {
    countryCode: 'DK', countryName: 'Denmark', language: 'da',
    portalName: 'Udbud.dk',
    endpoints: [
      // udbud.dk has a working search
      { url: 'https://udbud.dk/Pages/Tenders/Search?SearchPhrase=CNC&status=Active', type: 'html' },
      { url: 'https://www.mercell.com/en/search/tenders?country=DK&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|udbud|kontrakt|tender|procurement)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://udbud.dk',
  },
  FI: {
    countryCode: 'FI', countryName: 'Finland', language: 'fi',
    portalName: 'Hilma',
    endpoints: [
      // Hilma is Finland's official portal — new URL
      { url: 'https://hankintailmoitukset.fi/en/public/procurement/notices?status=published&cpv=42&orderBy=publicationDate&orderDirection=desc', type: 'html' },
      { url: 'https://www.hankintailmoitukset.fi/en/public/notices?cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|ilmoitus|hankinta|procurement)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://hankintailmoitukset.fi',
  },
  PT: {
    countryCode: 'PT', countryName: 'Portugal', language: 'pt',
    portalName: 'BASE',
    endpoints: [
      // BASE contracts portal — updated path
      { url: 'https://www.base.gov.pt/base4/pt/resultado/?tipo=contracts&tipo_entidade=&estado=1&cpv=42000000', type: 'html' },
      { url: 'https://www.base.gov.pt/base4/en/ResultSearch/?type=search&tipo=2&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:announcement|anuncio|contrato|notice|contract)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.base.gov.pt',
  },
  RO: {
    countryCode: 'RO', countryName: 'Romania', language: 'ro',
    portalName: 'SEAP/SICAP',
    endpoints: [
      { url: 'https://www.e-licitatie.ro/pub/notices/ca-notices/list/1?cpv=42&status=1&sortBy=publishDate&sortDirection=desc', type: 'html' },
      { url: 'https://e-licitatie.ro/api/v1/ca-notices?cpv=42&status=1&pageSize=50', type: 'json' },
    ],
    linkPattern: /href="([^"]*(?:notice|anunt|licitatie|achizitie)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.e-licitatie.ro',
  },
  EE: {
    countryCode: 'EE', countryName: 'Estonia', language: 'et',
    portalName: 'Riigihangete register',
    endpoints: [
      // RHR API v3 — endpoint path changed, try alternatives
      { url: 'https://riigihanked.riik.ee/rhr-web/api/v3/public/procurement-notices/paginate?status=ACTIVE&cpv=42&page=0&size=50', type: 'json' },
      { url: 'https://riigihanked.riik.ee/rhr-web/#/procurement?status=ACTIVE&cpv=42000000', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|hange|notice|riigihanke)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://riigihanked.riik.ee',
  },
  NO: {
    countryCode: 'NO', countryName: 'Norway', language: 'no',
    portalName: 'Doffin',
    endpoints: [
      // Doffin Norway — main procurement portal
      { url: 'https://doffin.no/notices?cpv=42000000&status=active&sort=-published', type: 'html' },
      { url: 'https://www.mercell.com/en/search/tenders?country=NO&cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|kunngjoring|oppdrag|tender|procurement)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://doffin.no',
  },
  CZ: {
    countryCode: 'CZ', countryName: 'Czechia', language: 'cs',
    portalName: 'NEN / e-TENDER',
    endpoints: [
      // NEN replaced Vestnik as main Czech portal in 2023
      { url: 'https://nen.nipez.cz/en/public-tenders?cpv=42000000&status=PUBLISHED', type: 'html' },
      { url: 'https://www.vestnikverejnychzakazek.cz/en/SearchForm/Search?type=Z&cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|contract|verejne|public-tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://nen.nipez.cz',
  },
  HU: {
    countryCode: 'HU', countryName: 'Hungary', language: 'hu',
    portalName: 'Közbeszerzési Hatóság',
    endpoints: [
      // Hungarian procurement portal — updated URL
      { url: 'https://www.kozbeszerzesek.hu/search?cpv=42000000&status=active', type: 'html' },
      { url: 'https://www.kozbeszerzes.hu/adatbazis/keres/?q=CNC+megmunkalo', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|hirdetmeny|kozbeszerzesi|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.kozbeszerzesek.hu',
  },
  HR: {
    countryCode: 'HR', countryName: 'Croatia', language: 'hr',
    portalName: 'EOJN',
    endpoints: [
      // EOJN moved to new domain in 2023
      { url: 'https://eojn.hr/Oglasnik/notices?cpv=42000000&status=PUBLISHED', type: 'html' },
      { url: 'https://eojn.hr/en/search?cpv=42&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|oglas|nabava|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://eojn.hr',
  },
  SK: {
    countryCode: 'SK', countryName: 'Slovakia', language: 'sk',
    portalName: 'ÚVO',
    endpoints: [
      { url: 'https://www.uvo.gov.sk/vyhladavanie/vyhladavanie-zakaziek/zoznam?cpv=42000000&stav=Z', type: 'html' },
      { url: 'https://www.uvo.gov.sk/en/search?cpv=42&status=published', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:zakazka|notice|public|vyhladavanie|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.uvo.gov.sk',
  },
  SI: {
    countryCode: 'SI', countryName: 'Slovenia', language: 'sl',
    portalName: 'e-JN',
    endpoints: [
      { url: 'https://www.enarocanje.si/Obrazci/?Cpv=42000000&Status=Active', type: 'html' },
      { url: 'https://ejn.gov.si/en/procurement-notices?cpv=42000000', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|razpis|narocilo|procurement|javno)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.enarocanje.si',
  },
  BG: {
    countryCode: 'BG', countryName: 'Bulgaria', language: 'bg',
    portalName: 'AOP / CRAS',
    endpoints: [
      { url: 'https://app.eop.bg/today/all?cpv=42000000', type: 'html' },
      { url: 'https://www.aop.bg/e_zop/child.php?ln=en&l=1&n=24&p=1&cpv=42000000', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:tender|objava|publichna|notice|procedure|eop)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://app.eop.bg',
  },
  LT: {
    countryCode: 'LT', countryName: 'Lithuania', language: 'lt',
    portalName: 'CVP IS',
    endpoints: [
      // CVP IS portal — updated URL
      { url: 'https://cvpp.eviesiejipirkimai.lt/Notice/SearchNotices?cpvCode=42000000&noticeStatus=ACTIVE', type: 'html' },
      { url: 'https://cvpp.eviesiejipirkimai.lt/en/Notices?cpv=42000000&status=active', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|skelbimas|pirkimas|Notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://cvpp.eviesiejipirkimai.lt',
  },
  LV: {
    countryCode: 'LV', countryName: 'Latvia', language: 'lv',
    portalName: 'IUB / EIS',
    endpoints: [
      { url: 'https://www.eis.gov.lv/EKEIS/Supplier/Procurements?cpvCode=42000000&status=active', type: 'html' },
      { url: 'https://iub.gov.lv/en/procurement-notices?cpv=42000000&status=published', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:procurement|iepirkums|pazinojums|notice|tender)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.eis.gov.lv',
  },
  CY: {
    countryCode: 'CY', countryName: 'Cyprus', language: 'en',
    portalName: 'eProcurement Cyprus',
    endpoints: [
      { url: 'https://www.eprocurement.gov.cy/epps/cft/listContractNotices.do?resourceId=0&status=ACTIVE&cpv=42', type: 'html' },
      { url: 'https://www.eprocurement.gov.cy/epps/cft/listContractNotices.do', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:notice|contract|tender|cft)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.eprocurement.gov.cy',
  },
  LU: {
    countryCode: 'LU', countryName: 'Luxembourg', language: 'fr',
    portalName: 'Marchés Publics Luxembourg',
    endpoints: [
      { url: 'https://marches.public.lu/fr/appels-offres/resultats.html?cpv=42&statut=publie', type: 'html' },
      { url: 'https://marches.public.lu/fr/recherche.html?cpv=42', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:marche|avis|contrat|notice|appel)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://marches.public.lu',
  },
  MT: {
    countryCode: 'MT', countryName: 'Malta', language: 'en',
    portalName: 'Department of Contracts',
    endpoints: [
      { url: 'https://www.gov.mt/en/Government/DOC/Pages/Calls-for-Tenders.aspx', type: 'html' },
      { url: 'https://ec.europa.eu/info/tenders/malta_en', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:call|tender|contract|notice|invitation)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.gov.mt',
  },
  GR: {
    countryCode: 'GR', countryName: 'Greece', language: 'el',
    portalName: 'ΕΣΗΔΗΣ (eSourcing)',
    endpoints: [
      { url: 'https://www.promitheus.gov.gr/eesp/tenders?cpv=42000000&status=active', type: 'html' },
      { url: 'https://www.eprocurement.gov.gr/kimid/faces/search-publication.xhtml', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:tender|notice|contract|diag|symbasi)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.promitheus.gov.gr',
  },
  CH: {
    countryCode: 'CH', countryName: 'Switzerland', language: 'de',
    portalName: 'SIMAP',
    endpoints: [
      { url: 'https://www.simap.ch/shabforms/COMMON/search/search.jsf?cpv=42000000&cpvCategory=exact', type: 'html' },
      { url: 'https://www.simap.ch/shabforms/COMMON/search/search.jsf?cpv=44000000&cpvCategory=exact', type: 'html' },
    ],
    linkPattern: /href="([^"]*(?:tender|invitation|Ausschreibung|Einladung|notice)[^"]*)"[^>]*>([^<]{10,200})</gi,
    baseUrl: 'https://www.simap.ch',
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

