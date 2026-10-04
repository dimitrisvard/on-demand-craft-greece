// CORS for /api/* answers.
//   - parity: the four vercel.json "headers" values for /api/(.*), set on every /api/* answer. microns-site applies
//     them through its own finalise() (its src/preview.ts); this copy must stay byte-equal to it.
//   - allow-list: reflect an allowed Origin only (exact host comparison, never substring matching), Vary: Origin,
//     never Access-Control-Allow-Credentials. Built and tested here; not wired into any Worker yet.
//
// Allow-list rules (an Origin must be in canonical form, as browsers send it: scheme, lower-case host, no default
// port, no path):
//   production      SITE_ORIGIN and the zone apex (https://micronshub.eu for https://www.micronshub.eu)
//   tenants         https://<one label>.<zone>; the label 'api' is never allowed
//   preview         https://[<prefix>-]microns-site.<workers subdomain>.workers.dev, only when the request host is a
//                   preview host
//   local dev       http://localhost:8080, only when the request host is a preview host
//   everything else never (*.vercel.app, api.<zone>, other hosts)

export const VERCEL_API_CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Credentials', 'true'],
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT'],
  ['Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'],
];

export interface AllowlistConfig {
  /** SITE_ORIGIN, e.g. https://www.micronshub.eu. */
  siteOrigin: string;
  /** Host of the request being answered (no port). On a workers.dev preview host it also gives the workers subdomain. */
  requestHost: string;
  /** True when the request host is a preview host; preview and local-dev origins are allowed only then. */
  requestIsPreview: boolean;
  /** The account's workers.dev subdomain, for preview origins; when absent it is read from a workers.dev requestHost. */
  workersSubdomain?: string;
}

/** Methods granted in allow-list mode: the same list as parity mode. */
export const ALLOWLIST_METHODS = 'GET,OPTIONS,PATCH,DELETE,POST,PUT';
/** Request headers granted in allow-list mode: the parity list plus the API credential and the Turnstile token. */
export const ALLOWLIST_HEADERS = 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Turnstile-Token';
/** Preflight cache lifetime in allow-list mode, seconds. */
export const ALLOWLIST_MAX_AGE = '600';

const LOCAL_DEV_ORIGIN = 'http://localhost:8080';
// One DNS label: letters, digits and inner hyphens, at most 63 characters.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Sub-domain labels of the zone that are never a browser origin of the site.
const NEVER_TENANT_LABELS: ReadonlySet<string> = new Set(['api']);
// A microns-site preview host on workers.dev: [<prefix>-]microns-site.<subdomain>.workers.dev
const PREVIEW_HOST = /^(?:[a-z0-9-]+-)?microns-site\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\.workers\.dev$/;

/** The URL of an Origin header value in canonical form, or null (malformed, opaque "null", path, port 443 …). */
function canonicalOrigin(origin: string): URL | null {
  if (!origin || origin === 'null') return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  return url.origin === origin ? url : null;
}

function siteUrl(siteOrigin: string): URL | null {
  try {
    const url = new URL(siteOrigin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function workersSubdomainOf(cfg: AllowlistConfig): string | null {
  const configured = cfg.workersSubdomain?.trim().toLowerCase();
  if (configured) return LABEL.test(configured) ? configured : null;
  const fromHost = PREVIEW_HOST.exec(cfg.requestHost.trim().toLowerCase());
  return fromHost ? fromHost[1] : null;
}

/** Allow-list check of §2.11 (exact host match, never substring matching). */
export function isAllowedOrigin(origin: string, cfg: AllowlistConfig): boolean {
  const url = canonicalOrigin(origin);
  if (!url) return false;

  const site = siteUrl(cfg.siteOrigin);
  if (site) {
    if (url.origin === site.origin) return true;
    const zone = site.hostname.replace(/^www\./, '');
    if (url.protocol === 'https:' && url.port === '') {
      if (url.hostname === zone) return true;
      if (url.hostname.endsWith(`.${zone}`)) {
        const label = url.hostname.slice(0, -(zone.length + 1));
        if (LABEL.test(label) && !NEVER_TENANT_LABELS.has(label)) return true;
      }
    }
  }

  if (!cfg.requestIsPreview) return false;
  if (url.origin === LOCAL_DEV_ORIGIN) return true;
  const subdomain = workersSubdomainOf(cfg);
  if (!subdomain || url.protocol !== 'https:' || url.port !== '') return false;
  const preview = PREVIEW_HOST.exec(url.hostname);
  return preview !== null && preview[1] === subdomain;
}

function addVaryOrigin(headers: Headers): void {
  const vary = headers.get('Vary');
  if (!vary) {
    headers.set('Vary', 'Origin');
    return;
  }
  const names = vary.split(',').map((name) => name.trim().toLowerCase());
  if (names.includes('*') || names.includes('origin')) return;
  headers.set('Vary', `${vary}, Origin`);
}

/**
 * Allow-list mode: an allowed Origin is reflected with the methods, headers and max-age above; any other answer
 * carries no CORS grant. Always sets Vary: Origin and never Access-Control-Allow-Credentials.
 */
export function applyAllowlistCors(headers: Headers, origin: string | null, cfg: AllowlistConfig): void {
  headers.delete('Access-Control-Allow-Credentials');
  addVaryOrigin(headers);
  if (origin !== null && isAllowedOrigin(origin, cfg)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', ALLOWLIST_METHODS);
    headers.set('Access-Control-Allow-Headers', ALLOWLIST_HEADERS);
    headers.set('Access-Control-Max-Age', ALLOWLIST_MAX_AGE);
    return;
  }
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Methods');
  headers.delete('Access-Control-Allow-Headers');
  headers.delete('Access-Control-Max-Age');
}
