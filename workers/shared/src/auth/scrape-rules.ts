// Data rules for the URLs a scrape or directory scan may fetch. The site gate applies the same rules to the public
// /api routes (rows SC-1 to SC-3 of workers/site/src/auth/gate.ts); microns-ops applies these validators before an
// in-process call that does not pass the site gate (remote MCP tools). A shared vector file
// (workers/shared/test/fixtures/scrape-rules.json) is run against both, so the two copies give the same answers.
//
// Rules
//   - A scrape target is an http(s) URL of a public web host: a dotted host name, never an IP literal (IPv4 in any
//     form the URL parser normalises, or a bracketed IPv6 address), never localhost, our own zone (the SITE_ORIGIN
//     host without "www.", plus micronshub.eu) or a platform host (workers.dev, vercel.app), at any subdomain.
//   - A directory target is an http(s) URL on a Europages or wlw host (any subdomain; .co.uk, .com or a two-letter
//     country suffix).
//   - A URL list for a website scrape has 1 to 25 entries, each a scrape target (strict form). The site gate passes
//     the shapes the handler refuses itself (not an array, empty, more than 25) to the handler unchanged; in-process
//     callers refuse them here.
//   - A tender scan country code is two ASCII letters; ops checks it against its connector list.
// The functions are pure: no fetch, no logging.

/** Most URLs one website scrape may name. */
export const SCRAPE_URLS_MAX = 25;

/** Zone of the site when SITE_ORIGIN is missing or unparsable. */
const DEFAULT_ZONE = 'micronshub.eu';
const PLATFORM_HOSTS = ['localhost', 'micronshub.eu', 'workers.dev', 'vercel.app'];
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const DIRECTORY_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:europages|wlw)\.(?:co\.uk|com|[a-z]{2})$/;
const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/;

export interface ScrapeRuleOptions {
  /** SITE_ORIGIN of the Worker, e.g. "https://www.micronshub.eu"; its host (without "www.") is refused. */
  siteOrigin?: string;
}

/** The URL when `value` is a string that parses as an http(s) URL, else null. */
export function parsedHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function zoneOf(siteOrigin: string | undefined): string {
  if (!siteOrigin) return DEFAULT_ZONE;
  try {
    return new URL(siteOrigin).hostname.toLowerCase().replace(/^www\./, '') || DEFAULT_ZONE;
  } catch {
    return DEFAULT_ZONE;
  }
}

/** Public web hosts only: no IP literals, no single-label or local names, none of our own or platform hosts. */
export function scrapeTargetAllowed(value: unknown, o: ScrapeRuleOptions = {}): boolean {
  const url = parsedHttpUrl(value);
  if (!url) return false;
  const host = hostOf(url);
  if (!host.includes('.') || host.startsWith('[') || IPV4_RE.test(host)) return false;
  const blocked = [zoneOf(o.siteOrigin), ...PLATFORM_HOSTS];
  return !blocked.some((b) => host === b || host.endsWith(`.${b}`));
}

/** Europages and wlw directory hosts. */
export function directoryTargetAllowed(value: unknown): boolean {
  const url = parsedHttpUrl(value);
  return !!url && DIRECTORY_HOST_RE.test(hostOf(url));
}

/** True when `urls` has the shape a website scrape accepts: an array of 1 to 25 entries. */
export function isScrapeUrlList(urls: unknown): urls is unknown[] {
  return Array.isArray(urls) && urls.length > 0 && urls.length <= SCRAPE_URLS_MAX;
}

/** Strict form for in-process callers: 1 to 25 entries, every one a scrape target. */
export function scrapeUrlsAllowed(urls: unknown, o: ScrapeRuleOptions = {}): boolean {
  return isScrapeUrlList(urls) && urls.every((u) => scrapeTargetAllowed(u, o));
}

/** The site gate's form (row SC-1): a list of 1 to 25 entries must be all scrape targets; other shapes pass to the
 *  handler, which refuses them itself. */
export function scrapeUrlsGateAllows(urls: unknown, o: ScrapeRuleOptions = {}): boolean {
  return isScrapeUrlList(urls) ? urls.every((u) => scrapeTargetAllowed(u, o)) : true;
}

/** Two ASCII letters (the caller checks the code against its connector list). */
export function countryCodeShapeAllowed(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_CODE_RE.test(value);
}
