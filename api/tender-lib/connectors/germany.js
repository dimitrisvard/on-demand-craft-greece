/**
 * Germany — e-Vergabe / service.bund.de connector
 * Access: Fetch + Regex scraping
 * Language: German
 * Germany is the #1 EU procurement market (~€500B/year)
 */

import { fetchWithTimeout, cleanText, parseIsoDate, getBrowserHeaders, delay } from '../utils.js';

const COUNTRY_CODE = 'DE';
const COUNTRY_NAME = 'Germany';
const PORTAL_NAME = 'e-Vergabe / service.bund.de';
const PORTAL_BASE_EVERGABE = 'https://www.evergabe-online.de';
const PORTAL_BASE_BUND = 'https://www.service.bund.de';
const LANGUAGE = 'de';

// Manufacturing CPV prefixes (DE portals support CPV filtering)
const MFG_CPV_PREFIXES = ['42', '44', '14', '38', '33', '34', '35', '50'];

/**
 * Fetch tenders from German portals
 */
export async function fetchGermany() {
  const tenders = [];
  const errors = [];

  // Strategy 1: service.bund.de - Federal procurement notice board
  try {
    // service.bund.de has a structured search with CPV filtering
    for (const cpv of MFG_CPV_PREFIXES.slice(0, 3)) {
      await delay(800);
      const searchUrl = `${PORTAL_BASE_BUND}/Content/DE/Ausschreibungen/Suche/Suche.html?nn=14066&cpv=${cpv}`;
      const resp = await fetchWithTimeout(searchUrl, {
        headers: getBrowserHeaders('de-DE,de;q=0.9,en;q=0.8'),
      }, 20000);

      if (resp.ok) {
        const html = await resp.text();
        const parsed = parseServiceBund(html, cpv);
        tenders.push(...parsed);
      }
    }
  } catch (err) {
    errors.push(`service.bund.de: ${err.message}`);
  }

  // Strategy 2: e-Vergabe search
  try {
    await delay(500);
    // Try e-Vergabe XML/API endpoint or search results
    const searchUrl = `${PORTAL_BASE_EVERGABE}/search/?cpvMain=42&status=ACTIVE&page=1`;
    const resp = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders('de-DE,de;q=0.9'),
    }, 20000);

    if (resp.ok) {
      const html = await resp.text();
      // Check if there's JSON embedded
      const jsonMatch = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
        || html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);

      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const items = data?.items || data?.results || data?.tenders || [];
          for (const item of items) {
            const t = normalizeEvergabe(item);
            if (t) tenders.push(t);
          }
        } catch {
          const parsed = parseEVergabeHtml(html);
          tenders.push(...parsed);
        }
      } else {
        const parsed = parseEVergabeHtml(html);
        tenders.push(...parsed);
      }
    }
  } catch (err) {
    errors.push(`e-Vergabe: ${err.message}`);
  }

  // Strategy 3: DTVP (private aggregator but free search)
  try {
    await delay(600);
    const dtvpUrl = 'https://www.dtvp.de/Center/company/tenders/public?cpv=42&page=1&pageSize=30';
    const resp = await fetchWithTimeout(dtvpUrl, {
      headers: getBrowserHeaders('de-DE,de;q=0.9'),
    }, 20000);

    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseDtvp(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`DTVP: ${err.message}`);
  }

  // Strategy 4: Vergabenetzwerk (VMP) - another major German portal
  try {
    await delay(600);
    const vmpUrl = 'https://www.vmp.de/VMPSatellite/satellite;jsessionid=none/PublicationController/pubList?cpv=42&status=ACTIVE&size=30';
    const resp = await fetchWithTimeout(vmpUrl, {
      headers: getBrowserHeaders('de-DE,de;q=0.9'),
    }, 20000);

    if (resp.ok) {
      const html = await resp.text();
      const parsed = parseVmp(html);
      tenders.push(...parsed);
    }
  } catch (err) {
    errors.push(`VMP: ${err.message}`);
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

function parseServiceBund(html, cpvPrefix) {
  const tenders = [];

  // service.bund.de list items
  const itemRx = /<(?:li|div|article)[^>]*class="[^"]*(?:result|item|ausschreibung|tender|list-item)[^"]*"[^>]*>([\s\S]*?)(?=<(?:li|div|article)[^>]*class="[^"]*(?:result|item|ausschreibung|tender|list-item)|<\/(?:ul|div|section)>)/gi;
  let m;
  while ((m = itemRx.exec(html)) !== null && tenders.length < 30) {
    const block = m[1];
    const titleM = block.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]{5,200})<\/a>/i);
    if (!titleM) continue;
    const url = titleM[1].startsWith('http') ? titleM[1] : `${PORTAL_BASE_BUND}${titleM[1]}`;
    const refM = url.match(/[?&](?:id|refId|docId)=([^&]+)|\/([A-Z0-9-]{6,})/i);
    const ref = refM ? (refM[1] || refM[2]) : `de-bund-${cpvPrefix}-${tenders.length}`;

    // Extract deadline if present
    const deadlineM = block.match(/(?:Schlusstermin|Einreichung|bis)[^:]*:\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i);
    let deadline;
    if (deadlineM) {
      const parts = deadlineM[1].split(/[./]/);
      if (parts.length === 3) {
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        deadline = `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }

    // Extract buyer
    const buyerM = block.match(/(?:Auftraggeber|Vergabestelle|Behörde)[^:]*:\s*<[^>]+>([^<]+)</i)
      || block.match(/class="[^"]*(?:buyer|authority|auftraggeber)[^"]*"[^>]*>([^<]+)</i);

    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: url,
      tenderReference: `de-bund-${ref}`,
      title: cleanText(titleM[2]),
      buyerName: buyerM ? cleanText(buyerM[1]) : undefined,
      submissionDeadline: deadline ? parseIsoDate(deadline) : undefined,
      originalLanguage: LANGUAGE,
    });
  }

  // Fallback: look for any procurement links
  if (tenders.length === 0) {
    const linkRx = /href="([^"]*(?:ausschreibung|vergabe|auftrag|tender)[^"]*)"[^>]*>([^<]{10,150})</gi;
    while ((m = linkRx.exec(html)) !== null && tenders.length < 20) {
      const url = m[1].startsWith('http') ? m[1] : `${PORTAL_BASE_BUND}${m[1]}`;
      tenders.push({
        countryCode: COUNTRY_CODE,
        countryName: COUNTRY_NAME,
        portalName: PORTAL_NAME,
        portalUrl: url,
        tenderReference: `de-bund-${cpvPrefix}-fb-${tenders.length}`,
        title: cleanText(m[2]),
        originalLanguage: LANGUAGE,
      });
    }
  }

  return tenders;
}

function parseEVergabeHtml(html) {
  const tenders = [];
  const seen = new Set();

  // e-Vergabe search results
  const rowRx = /<tr[^>]*class="[^"]*(?:search-result|result-row|tender-row)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRx.exec(html)) !== null && tenders.length < 30) {
    const row = m[1];
    const linkM = row.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]{5,200})<\/a>/i);
    if (!linkM) continue;
    const url = linkM[1].startsWith('http') ? linkM[1] : `${PORTAL_BASE_EVERGABE}${linkM[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const refM = url.match(/\/(\w{8,})/);
    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: PORTAL_NAME,
      portalUrl: url,
      tenderReference: refM ? `de-ev-${refM[1]}` : `de-ev-${tenders.length}`,
      title: cleanText(linkM[2]),
      originalLanguage: LANGUAGE,
    });
  }

  // Generic link fallback
  if (tenders.length === 0) {
    const linkRx = /href="([^"]*(?:\/tender\/|\/ausschreibung\/|\/vergabe\/)[^"]+)"[^>]*>([^<]{10,150})</gi;
    while ((m = linkRx.exec(html)) !== null && tenders.length < 20) {
      const url = m[1].startsWith('http') ? m[1] : `${PORTAL_BASE_EVERGABE}${m[1]}`;
      if (seen.has(url)) continue;
      seen.add(url);
      tenders.push({
        countryCode: COUNTRY_CODE,
        countryName: COUNTRY_NAME,
        portalName: PORTAL_NAME,
        portalUrl: url,
        tenderReference: `de-ev-${tenders.length}`,
        title: cleanText(m[2]),
        originalLanguage: LANGUAGE,
      });
    }
  }

  return tenders;
}

function parseDtvp(html) {
  const tenders = [];
  const seen = new Set();

  const linkRx = /href="(\/Center\/[^"]+)"[^>]*>\s*([^<]{10,200})\s*<\/a>/gi;
  let m;
  while ((m = linkRx.exec(html)) !== null && tenders.length < 20) {
    const url = `https://www.dtvp.de${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: 'DTVP',
      portalUrl: url,
      tenderReference: `de-dtvp-${tenders.length}`,
      title: cleanText(m[2]),
      originalLanguage: LANGUAGE,
    });
  }

  return tenders;
}

function parseVmp(html) {
  const tenders = [];
  const seen = new Set();

  const linkRx = /href="([^"]*\/pub\/[^"]+)"[^>]*>([^<]{10,200})<\/a>/gi;
  let m;
  while ((m = linkRx.exec(html)) !== null && tenders.length < 20) {
    const url = m[1].startsWith('http') ? m[1] : `https://www.vmp.de${m[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    tenders.push({
      countryCode: COUNTRY_CODE,
      countryName: COUNTRY_NAME,
      portalName: 'VMP Vergabenetzwerk',
      portalUrl: url,
      tenderReference: `de-vmp-${tenders.length}`,
      title: cleanText(m[2]),
      originalLanguage: LANGUAGE,
    });
  }

  return tenders;
}

function normalizeEvergabe(item) {
  const ref = item?.id || item?.referenceNumber || item?.vergabenummer;
  if (!ref) return null;
  return {
    countryCode: COUNTRY_CODE,
    countryName: COUNTRY_NAME,
    portalName: PORTAL_NAME,
    portalUrl: item?.url || `${PORTAL_BASE_EVERGABE}/tender/${ref}`,
    tenderReference: `de-ev-${ref}`,
    title: cleanText(item?.title || item?.bezeichnung || ''),
    description: cleanText(item?.description || item?.leistungsbeschreibung || ''),
    buyerName: cleanText(item?.buyerName || item?.auftraggeber || ''),
    cpvCodes: Array.isArray(item?.cpvCodes) ? item.cpvCodes : [],
    estimatedValueEur: item?.estimatedValue,
    currency: 'EUR',
    publicationDate: parseIsoDate(item?.publicationDate || item?.bekanntmachungsdatum),
    submissionDeadline: parseIsoDate(item?.deadline || item?.abgabefrist),
    originalLanguage: LANGUAGE,
  };
}
