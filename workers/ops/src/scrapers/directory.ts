// Directory scans of the scraper module (Europages, wlw): one search page (scanDirectoryPage) or up to 10 pages
// (scanDirectory). Used by the flag-on branch of /api/scan-directory, the remote MCP tools and the queue kind
// 'directory-scan'.
//
// Rules for one page (in this order; nothing is fetched before every check passed)
//   1 url required ({"error":"url is required"}, 400); source = the given one unless 'auto', else detected from the
//     URL; an unknown source answers the handler's 400 message.
//   2 the URL is a directory target (Europages/wlw host, shared scrape rules), else 400 {"error":"url_not_allowed"}.
//   3 a paused host (403/429/challenge in the last 24 h) answers 429 {"error":"host_blocked","retryAfter":<s>}.
//   4 robots gate (robots.ts): disallowed -> 403 {"error":"robots_disallowed"} (a host named in
//     SCRAPER_PERMITTED_HOSTS passes with its permission reference, which is logged).
//   5 plain fetch with the crawler identity; 403, 429 or a challenge page pauses the host for 24 h and answers
//     {"error":"host_blocked","retryAfter":86400} with the directory's status (403 for a challenge); other failures
//     answer the handler's shapes (502 HTTP status, 502 non-HTML, 504 timeout, 502 fetch failure).
//   6 parse with the ported parsers; when no company was found on a 200 page of a permitted host that needs client
//     rendering and the invocation's browser budget is unused, the page is rendered once with Browser Run and
//     parsed again (a refusal there pauses the host as in 5).
//   7 the answer is the handler's 200 body (directoryPageBody), byte for byte.
// Rules for a multi-page scan
//   - pages 1..maxPages (at most 10) built with buildPageUrl; stop at the first page without companies, without a
//     next page, or with a robots, pause or refusal answer; other page errors are collected and the scan goes on.
//   - between two pages it waits at least 2.5 s (Europages) or 4 s (wlw), and at least the robots.txt Crawl-delay.

import { directoryTargetAllowed } from '../../../shared/src/auth/scrape-rules';
import { BrowserBudget } from './browser';
import { MAX_PAGES, PAGE_DELAY_MS, pauseRemaining, type ScraperDeps } from './context';
import { fetchPage, type PageResult } from './fetch-page';
import {
  buildPageUrl,
  detectSource,
  directoryPageBody,
  extractSearchMeta,
  type DirectoryPageBody,
  type DirectorySource,
} from './parsers/directory';
import { hostOf, robotsAllows, type RobotsDecision } from './robots';

export const UNKNOWN_SOURCE_MESSAGE = 'URL not recognized as Europages or wlw. Supported: europages.co.uk, europages.de, wlw.com, wlw.de, etc.';

export type ScanError = { error: string; retryAfter?: number };

export type PageScan =
  | { ok: true; status: 200; body: DirectoryPageBody; robots: RobotsDecision; rendered: boolean }
  | { ok: false; status: number; body: ScanError; robots?: RobotsDecision; paused?: string };

function fail(status: number, body: ScanError, extra: { robots?: RobotsDecision; paused?: string } = {}): PageScan {
  return { ok: false, status, body, ...extra };
}

const SPA_ROOT_RE = /<div[^>]+id=["'](?:__next|root|app|__nuxt)["']/i;
const NOSCRIPT_JS_RE = /<noscript[^>]*>[\s\S]{0,400}?javascript/i;

/** True when the page is a client-rendered shell (an SPA root or a "needs JavaScript" notice and little text). */
export function needsClientRendering(html: string): boolean {
  if (!SPA_ROOT_RE.test(html) && !NOSCRIPT_JS_RE.test(html)) return false;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 1_000;
}

/** Pauses the host (per isolate) and logs it; the caller records the pause in its scan_logs row. */
function pauseHost(deps: ScraperDeps, host: string, reason: string): void {
  deps.pauses.pause(host, deps.now());
  deps.log('host paused', { host, reason });
}

function blockedAnswer(deps: ScraperDeps, host: string, page: PageResult, robots: RobotsDecision): PageScan {
  pauseHost(deps, host, page.blocked === 'challenge' ? 'challenge' : `status_${page.status}`);
  const status = page.status === 429 ? 429 : 403;
  return fail(status, { error: 'host_blocked', retryAfter: 86_400 }, { robots, paused: host });
}

/** One search page (see the rules above). */
export async function scanDirectoryPage(
  deps: ScraperDeps,
  input: { url: unknown; source?: unknown },
  budget: BrowserBudget = new BrowserBudget(),
): Promise<PageScan> {
  const url = input.url;
  if (!url) return fail(400, { error: 'url is required' });
  if (typeof url !== 'string') return fail(400, { error: 'url_not_allowed' });
  const provided = input.source;
  const source = provided && provided !== 'auto' ? provided : detectSource(url);
  if (source === 'unknown') return fail(400, { error: UNKNOWN_SOURCE_MESSAGE });
  if (source !== 'europages' && source !== 'wlw') return fail(400, { error: UNKNOWN_SOURCE_MESSAGE });
  if (!directoryTargetAllowed(url)) return fail(400, { error: 'url_not_allowed' });
  const host = hostOf(url) as string;

  const paused = await pauseRemaining(deps, host);
  if (paused > 0) return fail(429, { error: 'host_blocked', retryAfter: Math.ceil(paused / 1000) }, { paused: host });

  const robots = await robotsAllows(url, { fetchImpl: deps.fetch, userAgent: deps.userAgent, permitted: deps.permitted, now: deps.now, cache: deps.robotsCache });
  deps.log('robots', { host, allowed: robots.allowed, reason: robots.reason, permission: robots.permission });
  if (!robots.allowed) return fail(403, { error: 'robots_disallowed' }, { robots });

  const meta = extractSearchMeta(url, source);
  const page = await fetchPage(url, { userAgent: deps.userAgent, fetchImpl: deps.fetch });
  if (page.error === 'timeout') return fail(504, { error: 'Request timed out fetching directory page' }, { robots });
  if (page.error === 'redirect_off_host') return fail(502, { error: 'redirect_off_host' }, { robots });
  if (page.error) return fail(502, { error: 'Failed to fetch directory' }, { robots });
  if (page.blocked) return blockedAnswer(deps, host, page, robots);
  if (page.status < 200 || page.status >= 300) return fail(502, { error: `Directory returned HTTP ${page.status}` }, { robots });
  if (!page.contentType.includes('text/html') && !page.contentType.includes('text/plain')) {
    return fail(502, { error: 'Directory returned non-HTML response' }, { robots });
  }

  let body = directoryPageBody(page.html, url, source, meta);
  let rendered = false;
  if (body.companies.length === 0 && robots.permission !== undefined && deps.browser && needsClientRendering(page.html) && budget.take()) {
    const view = await deps.browser.render(url, { timeoutMs: 20_000, userAgent: deps.userAgent });
    rendered = true;
    deps.log('rendered', { host, status: view.status });
    if (view.status === 403 || view.status === 429 || (view.status === 200 && /captcha|challenge-platform|cf-challenge/i.test(view.html))) {
      return blockedAnswer(deps, host, { status: view.status, contentType: 'text/html', html: view.html, finalUrl: url, blocked: view.status === 200 ? 'challenge' : 'status' }, robots);
    }
    if (view.status === 200) body = directoryPageBody(view.html, url, source, meta);
  }
  return { ok: true, status: 200, body, robots, rendered };
}

export interface DirectoryScanResult {
  source: DirectorySource;
  keyword: string;
  country: string;
  pages: number;
  companies: DirectoryPageBody['companies'];
  errors: string[];
  /** Host paused during or before this scan. */
  paused: string | null;
  robots: RobotsDecision | null;
  stopped: 'end' | 'limit' | 'empty' | 'robots' | 'paused' | 'refused';
}

/** Up to maxPages pages (at most 10) of one search (see the rules above). */
export async function scanDirectory(
  deps: ScraperDeps,
  input: { url: string; source: DirectorySource; maxPages: number },
  budget: BrowserBudget = new BrowserBudget(),
): Promise<DirectoryScanResult> {
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Math.floor(input.maxPages) || 1));
  const meta = extractSearchMeta(input.url, input.source);
  const result: DirectoryScanResult = {
    source: input.source,
    keyword: meta.keyword,
    country: meta.country,
    pages: 0,
    companies: [],
    errors: [],
    paused: null,
    robots: null,
    stopped: 'limit',
  };
  for (let pg = 1; pg <= maxPages; pg++) {
    const pageUrl = buildPageUrl(input.url, pg, input.source);
    const scan = await scanDirectoryPage(deps, { url: pageUrl, source: input.source }, budget);
    if (scan.robots && !result.robots) result.robots = scan.robots;
    if (!scan.ok) {
      result.errors.push(`Page ${pg}: ${scan.body.error}`);
      if (scan.paused) {
        result.paused = scan.paused;
        result.stopped = 'paused';
        break;
      }
      if (scan.body.error === 'robots_disallowed') {
        result.stopped = 'robots';
        break;
      }
      if (scan.status === 400 || scan.status === 401 || scan.status === 403 || scan.status === 429) {
        result.stopped = 'refused';
        break;
      }
      continue;
    }
    result.pages = pg;
    const companies = scan.body.companies;
    if (companies.length === 0) {
      result.stopped = 'empty';
      break;
    }
    result.companies.push(...companies);
    if (!scan.body.hasNextPage) {
      result.stopped = 'end';
      break;
    }
    if (pg < maxPages) {
      const crawlDelayMs = (scan.robots.crawlDelayS ?? 0) * 1000;
      await deps.sleep(Math.max(PAGE_DELAY_MS[input.source], crawlDelayMs));
    }
  }
  return result;
}
