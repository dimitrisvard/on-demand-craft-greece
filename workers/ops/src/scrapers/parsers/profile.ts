// Company profile parsers, ported unchanged from api/scrape-company-profile.js:41-305 (cleanText,
// parseEuropagesProfile, parseWlwProfile) and the answer it builds at :363-381. api/* stays as it is (it moves only
// in Phase 6); a test runs the Vercel handler through the Phase 2 shim on the same synthetic HTML and requires
// byte-equal JSON.
//
// Rules
//   - Every function keeps the handler's logic and the key order of the objects it builds; JSON values from the page
//     are untyped, as in the handler.
//   - Pure: no fetch, no clock, no logging.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface ContactPerson {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface CompanyProfile {
  company_name: string;
  description: string;
  country: string;
  city: string;
  full_address: string;
  website_url: string;
  phone: string;
  email: string;
  fax: string;
  employee_count: string;
  year_established: string;
  vat_id: string;
  industry_tags: string[];
  products_services: string[];
  certifications: string[];
  contact_persons?: ContactPerson[];
}

/** The 200 answer of /api/scrape-company-profile: {url, source, ...details}. */
export type ProfileBody = { url: string; source: 'europages' | 'wlw' } & CompanyProfile;

export function cleanText(text: Json): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function parseEuropagesProfile(html: string, _profileUrl: string): CompanyProfile {
  const result: CompanyProfile = {
    company_name: '',
    description: '',
    country: '',
    city: '',
    full_address: '',
    website_url: '',
    phone: '',
    email: '',
    fax: '',
    employee_count: '',
    year_established: '',
    vat_id: '',
    industry_tags: [],
    products_services: [],
    certifications: [],
  };

  // JSON-LD first
  const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const data: Json = JSON.parse(jm[1]);
      const items: Json[] = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (['Organization', 'LocalBusiness', 'Corporation', 'Company'].includes(item['@type'])) {
          if (item.name) result.company_name = cleanText(item.name);
          if (item.description) result.description = cleanText(item.description);
          if (item.url && !item.url.includes('europages')) result.website_url = item.url;
          if (item.sameAs && !item.sameAs.includes('europages')) result.website_url = result.website_url || item.sameAs;
          if (item.telephone) result.phone = item.telephone;
          if (item.email) result.email = item.email;
          if (item.address) {
            result.country = item.address.addressCountry || '';
            result.city = item.address.addressLocality || '';
            const parts = [
              item.address.streetAddress,
              item.address.postalCode,
              item.address.addressLocality,
              item.address.addressCountry,
            ].filter(Boolean);
            if (parts.length) result.full_address = parts.join(', ');
          }
          if (item.numberOfEmployees) result.employee_count = String(item.numberOfEmployees);
          if (item.foundingDate) result.year_established = String(item.foundingDate).slice(0, 4);
        }
      }
    } catch (_) { /* skip */ }
  }

  // Website URL: external links with rel="nofollow" or target="_blank"
  if (!result.website_url) {
    const websitePatterns = [
      /href="(https?:\/\/(?!www\.europages\.[a-z.]+)[^"]+)"[^>]*(?:rel="nofollow|target="_blank)[^>]*>/gi,
      /<a[^>]+(?:rel="nofollow|target="_blank)[^>]+href="(https?:\/\/(?!www\.europages)[^"]{4,100})"/gi,
      /data-website="(https?:\/\/[^"]{4,100})"/gi,
      /class="[^"]*(?:website|web-link|external)[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi,
    ];
    for (const rx of websitePatterns) {
      const m = rx.exec(html);
      if (m && m[1] && !m[1].includes('europages') && !m[1].includes('facebook') && !m[1].includes('linkedin')) {
        result.website_url = m[1];
        break;
      }
    }
  }

  // Phone: tel: links
  if (!result.phone) {
    const phoneM = html.match(/href="tel:([^"]+)"/i);
    if (phoneM) result.phone = phoneM[1].trim();
  }

  // Email: mailto: links
  if (!result.email) {
    const emailM = html.match(/href="mailto:([^"?]+)"/i);
    if (emailM) result.email = emailM[1].trim();
  }

  // Meta description fallback
  if (!result.description) {
    const metaM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,}?)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']{10,}?)["'][^>]+name=["']description["']/i);
    if (metaM) result.description = cleanText(metaM[1]);
  }

  // Company name from the title, then og:title
  if (!result.company_name) {
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleM) result.company_name = cleanText(titleM[1]).replace(/\s*[-|].*$/, '').trim();
    if (!result.company_name) {
      const ogM = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      if (ogM) result.company_name = cleanText(ogM[1]);
    }
  }

  // Employee count: patterns like "11-50" or "51-200 employees"
  if (!result.employee_count) {
    const empM = html.match(/(\d{1,4}[\s–\-]+\d{1,4})\s*(?:employees|staff|Mitarbeiter|employés|collaborateurs)?/i)
      || html.match(/(?:employees|staff|Mitarbeiter):\s*(\d[\d ,–\-]+)/i);
    if (empM) result.employee_count = empM[1].trim();
  }

  // Year established
  if (!result.year_established) {
    const yearM = html.match(/(?:founded|established|seit|gegründet|fondée?|since)[^<\d]*(\d{4})/i);
    if (yearM) result.year_established = yearM[1];
  }

  // Industry tags from meta keywords
  if (!result.industry_tags.length) {
    const kwM = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    if (kwM) {
      result.industry_tags = kwM[1].split(/,\s*/).map((k) => cleanText(k)).filter((k) => k.length > 1 && k.length < 50).slice(0, 10);
    }
  }

  return result;
}

export function parseWlwProfile(html: string, _profileUrl: string): CompanyProfile {
  const result: CompanyProfile = {
    company_name: '',
    description: '',
    country: '',
    city: '',
    full_address: '',
    website_url: '',
    phone: '',
    email: '',
    fax: '',
    employee_count: '',
    year_established: '',
    vat_id: '',
    industry_tags: [],
    products_services: [],
    certifications: [],
    contact_persons: [],
  };

  // Strategy 1: __NEXT_DATA__ (Next.js)
  const nextDataRx = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const ndMatch = nextDataRx.exec(html);
  if (ndMatch) {
    try {
      const data: Json = JSON.parse(ndMatch[1]);
      const pageProps = data?.props?.pageProps;
      const company: Json = pageProps?.company || pageProps?.companyProfile || pageProps?.companyData || {};

      if (company.name) result.company_name = cleanText(company.name);
      if (company.description) result.description = cleanText(company.description);
      if (company.shortDescription) result.description = result.description || cleanText(company.shortDescription);
      if (company.website) result.website_url = company.website;
      if (company.phone || company.telephone) result.phone = company.phone || company.telephone;
      if (company.email) result.email = company.email;
      if (company.fax) result.fax = company.fax;

      // Address
      const addr: Json = company.address || company.location || {};
      if (addr.country) result.country = addr.country;
      if (addr.city) result.city = addr.city;
      const addrParts = [addr.street, addr.postalCode, addr.city, addr.country].filter(Boolean);
      if (addrParts.length) result.full_address = addrParts.join(', ');

      if (company.employeeCount) result.employee_count = String(company.employeeCount);
      if (company.foundingYear) result.year_established = String(company.foundingYear);
      if (company.vatId) result.vat_id = company.vatId;

      // Tags
      if (Array.isArray(company.tags)) {
        result.industry_tags = company.tags.map((t: Json) => typeof t === 'string' ? t : (t.name || '')).filter(Boolean);
      }
      if (Array.isArray(company.products)) {
        result.products_services = company.products.map((p: Json) => typeof p === 'string' ? p : (p.name || '')).filter(Boolean);
      }
      if (Array.isArray(company.certifications)) {
        result.certifications = company.certifications.map((c: Json) => typeof c === 'string' ? c : (c.name || '')).filter(Boolean);
      }

      // Contact persons
      if (Array.isArray(company.contacts)) {
        result.contact_persons = company.contacts.map((cp: Json) => ({
          name: cp.name || cp.fullName || '',
          title: cp.title || cp.position || cp.jobTitle || '',
          email: cp.email || '',
          phone: cp.phone || cp.telephone || '',
        })).filter((cp: ContactPerson) => cp.name);
      }
    } catch (_) { /* fall through to regex */ }
  }

  // Regex fallbacks

  // Website URL
  if (!result.website_url) {
    const websitePatterns = [
      /href="(https?:\/\/(?!www\.wlw\.)[^"]{4,100})"[^>]*(?:rel="nofollow|target="_blank|class="[^"]*(?:website|external))[^>]*>/gi,
      /<a[^>]+class="[^"]*(?:website|web-link)[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi,
      /data-href="(https?:\/\/(?!www\.wlw\.)[^"]{4,100})"/gi,
    ];
    for (const rx of websitePatterns) {
      const m = rx.exec(html);
      if (m && m[1] && !m[1].includes('wlw.') && !m[1].includes('facebook') && !m[1].includes('linkedin')) {
        result.website_url = m[1];
        break;
      }
    }
  }

  // Phone
  if (!result.phone) {
    const phoneM = html.match(/href="tel:([^"]+)"/i);
    if (phoneM) result.phone = phoneM[1].trim();
  }

  // Email
  if (!result.email) {
    const emailM = html.match(/href="mailto:([^"?]+)"/i);
    if (emailM) result.email = emailM[1].trim();
  }

  // Company name fallback
  if (!result.company_name) {
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleM) result.company_name = cleanText(titleM[1]).replace(/\s*[-|].*$/, '').trim();
  }

  // JSON-LD fallback
  if (!result.company_name || !result.website_url) {
    const jsonLdRx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jm: RegExpExecArray | null;
    while ((jm = jsonLdRx.exec(html)) !== null) {
      try {
        const data: Json = JSON.parse(jm[1]);
        const items: Json[] = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (['Organization', 'LocalBusiness', 'Corporation'].includes(item['@type'])) {
            if (!result.company_name && item.name) result.company_name = cleanText(item.name);
            if (!result.website_url && item.url && !item.url.includes('wlw.')) result.website_url = item.url;
            if (!result.phone && item.telephone) result.phone = item.telephone;
            if (!result.email && item.email) result.email = item.email;
          }
        }
      } catch (_) { /* skip */ }
    }
  }

  return result;
}

/** The handler's 200 body for a fetched profile page (:363-381). */
export function profileBody(html: string, url: string, source: 'europages' | 'wlw'): ProfileBody {
  const details = source === 'europages' ? parseEuropagesProfile(html, url) : parseWlwProfile(html, url);
  return { url, source, ...details };
}
