// Plain page fetch of the scraper module.
//
// Rules
//   - Requests identify the crawler: User-Agent = SCRAPER_USER_AGENT (MicronsHubBot/1.0 with a contact URL); no
//     rotated browser identities, no header or address variation after a refusal.
//   - Redirects are followed only on the same host (at most 5); a redirect to another host ends the fetch with
//     error 'redirect_off_host' and the target is not fetched.
//   - 15 s timeout for the whole fetch; the page body is read up to 5 MiB.
//   - A 403, a 429, or a page that is a bot challenge or CAPTCHA is reported as `blocked`, so the caller stops
//     using that host (no browser retry).
//   - scraperFetch(env): the fetch the module uses. In generated test configs only (AGENT_STUBS set),
//     SCRAPER_API_BASE re-addresses every request to <base>/<host><path><query> on the local fixture server; the
//     production config never sets it (the bundle check refuses every *_API_BASE var) and a Worker without
//     AGENT_STUBS refuses it.

import type { OpsEnv } from '../env';

export const PAGE_TIMEOUT_MS = 15_000;
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAGE_MAX_REDIRECTS = 5;

export type ScraperEnv = OpsEnv & { SCRAPER_API_BASE?: string };

export interface PageResult {
  /** HTTP status of the final answer; 0 when no answer arrived. */
  status: number;
  contentType: string;
  html: string;
  finalUrl: string;
  /** Set when the answer is a refusal or a bot challenge. */
  blocked?: 'status' | 'challenge';
  /** Set when no usable answer arrived. */
  error?: 'timeout' | 'network' | 'redirect_off_host' | 'too_many_redirects' | 'bad_redirect';
}

const CHALLENGE_MARKERS = [
  /cf-challenge|challenge-platform|cf_chl_|cf-turnstile/i,
  /g-recaptcha|hcaptcha|captcha-delivery|px-captcha|datadome/i,
  /<title>\s*(?:just a moment|attention required|access denied|are you a robot)/i,
];

/** True when the answer is a bot challenge or CAPTCHA page. */
export function isChallengePage(status: number, headers: Headers | null, html: string): boolean {
  if (headers?.get('cf-mitigated') === 'challenge') return true;
  if (status !== 200 && status !== 403 && status !== 429 && status !== 503) return false;
  return CHALLENGE_MARKERS.some((re) => re.test(html.slice(0, 200_000)));
}

async function readText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - total;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export interface FetchPageOptions {
  userAgent: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  referer?: string;
}

/** GET one page (see the rules above). */
export async function fetchPage(url: string, o: FetchPageOptions): Promise<PageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? PAGE_TIMEOUT_MS);
  let target = url;
  const host = new URL(url).hostname.toLowerCase();
  try {
    for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop++) {
      let response: Response;
      try {
        const headers: Record<string, string> = {
          'User-Agent': o.userAgent,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        };
        if (o.referer) headers.Referer = o.referer;
        response = await o.fetchImpl(target, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
      } catch {
        return { status: 0, contentType: '', html: '', finalUrl: target, error: controller.signal.aborted ? 'timeout' : 'network' };
      }
      if (response.status >= 300 && response.status < 400) {
        response.body?.cancel().catch(() => {});
        const location = response.headers.get('location');
        let next: URL;
        try {
          next = new URL(location ?? '', target);
        } catch {
          return { status: response.status, contentType: '', html: '', finalUrl: target, error: 'bad_redirect' };
        }
        if (!location || (next.protocol !== 'http:' && next.protocol !== 'https:')) {
          return { status: response.status, contentType: '', html: '', finalUrl: target, error: 'bad_redirect' };
        }
        if (next.hostname.toLowerCase() !== host) {
          return { status: response.status, contentType: '', html: '', finalUrl: target, error: 'redirect_off_host' };
        }
        target = next.toString();
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      let html: string;
      try {
        html = await readText(response, o.maxBytes ?? PAGE_MAX_BYTES);
      } catch {
        return { status: 0, contentType, html: '', finalUrl: target, error: controller.signal.aborted ? 'timeout' : 'network' };
      }
      const result: PageResult = { status: response.status, contentType, html, finalUrl: target };
      if (isChallengePage(response.status, response.headers, html)) result.blocked = 'challenge';
      else if (response.status === 403 || response.status === 429) result.blocked = 'status';
      return result;
    }
    return { status: 0, contentType: '', html: '', finalUrl: target, error: 'too_many_redirects' };
  } finally {
    clearTimeout(timer);
  }
}

/** The fetch of the scraper module (see the rules above). */
export function scraperFetch(env: ScraperEnv, base: typeof fetch = fetch): typeof fetch {
  const override = env.SCRAPER_API_BASE;
  if (!override) return base;
  if (!env.AGENT_STUBS) throw new Error('SCRAPER_API_BASE is for generated test configs only (AGENT_STUBS unset)');
  const origin = override.replace(/\/+$/, '');
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    return base(`${origin}/${url.host}${url.pathname}${url.search}`, init);
  }) as typeof fetch;
}
