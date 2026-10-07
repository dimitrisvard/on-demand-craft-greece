// Company profile scans of the scraper module (Europages, wlw). Used by the flag-on branch of
// /api/scrape-company-profile and by profile enrichment of directory scans.
//
// Rules (in this order; nothing is fetched before every check passed)
//   1 url required ({"error":"url is required"}, 400); source must be 'europages' or 'wlw' (the handler's 400
//     message otherwise).
//   2 the URL is a directory target (shared scrape rules), else 400 {"error":"url_not_allowed"}.
//   3 a paused host answers 429 {"error":"host_blocked","retryAfter":<s>}.
//   4 robots gate: disallowed -> 403 {"error":"robots_disallowed"}.
//   5 plain fetch with the crawler identity and the directory's referer; 403, 429 or a challenge page pauses the
//     host for 24 h ({"error":"host_blocked","retryAfter":86400}); other failures answer the handler's shapes.
//   6 the answer is the handler's 200 body (profileBody), byte for byte. Profiles are server-rendered pages; the
//     browser is not used here.

import { directoryTargetAllowed } from '../../../shared/src/auth/scrape-rules';
import { pauseRemaining, type ScraperDeps } from './context';
import { fetchPage } from './fetch-page';
import { profileBody, type ProfileBody } from './parsers/profile';
import { hostOf, robotsAllows, type RobotsDecision } from './robots';

export type ProfileScan =
  | { ok: true; status: 200; body: ProfileBody; robots: RobotsDecision }
  | { ok: false; status: number; body: { error: string; retryAfter?: number }; robots?: RobotsDecision; paused?: string };

const REFERERS: Readonly<Record<'europages' | 'wlw', string>> = {
  europages: 'https://www.europages.co.uk/',
  wlw: 'https://www.wlw.com/en/search',
};

/** One profile page (see the rules above). */
export async function scrapeProfile(deps: ScraperDeps, input: { url: unknown; source: unknown }): Promise<ProfileScan> {
  const { url, source } = input;
  if (!url) return { ok: false, status: 400, body: { error: 'url is required' } };
  if (source !== 'europages' && source !== 'wlw') return { ok: false, status: 400, body: { error: 'source must be "europages" or "wlw"' } };
  if (typeof url !== 'string' || !directoryTargetAllowed(url)) return { ok: false, status: 400, body: { error: 'url_not_allowed' } };
  const host = hostOf(url) as string;

  const paused = await pauseRemaining(deps, host);
  if (paused > 0) return { ok: false, status: 429, body: { error: 'host_blocked', retryAfter: Math.ceil(paused / 1000) }, paused: host };

  const robots = await robotsAllows(url, { fetchImpl: deps.fetch, userAgent: deps.userAgent, permitted: deps.permitted, now: deps.now, cache: deps.robotsCache });
  deps.log('robots', { host, allowed: robots.allowed, reason: robots.reason, permission: robots.permission });
  if (!robots.allowed) return { ok: false, status: 403, body: { error: 'robots_disallowed' }, robots };

  const page = await fetchPage(url, { userAgent: deps.userAgent, fetchImpl: deps.fetch, referer: REFERERS[source] });
  if (page.error === 'timeout') return { ok: false, status: 504, body: { error: 'Timeout fetching company profile' }, robots };
  if (page.error) return { ok: false, status: 502, body: { error: page.error === 'redirect_off_host' ? 'redirect_off_host' : 'Failed to fetch profile' }, robots };
  if (page.blocked) {
    deps.pauses.pause(host, deps.now());
    deps.log('host paused', { host, reason: page.blocked === 'challenge' ? 'challenge' : `status_${page.status}` });
    return { ok: false, status: page.status === 429 ? 429 : 403, body: { error: 'host_blocked', retryAfter: 86_400 }, robots, paused: host };
  }
  if (page.status < 200 || page.status >= 300) return { ok: false, status: 502, body: { error: `HTTP ${page.status} from directory` }, robots };
  return { ok: true, status: 200, body: profileBody(page.html, url, source), robots };
}
