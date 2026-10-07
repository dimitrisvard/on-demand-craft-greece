// robots.txt gate of the scraper module: every fetch the module makes (plain or browser) first asks robotsAllows()
// for the target URL, with the product token MicronsHubBot.
//
// Rules (RFC 9309, https://www.rfc-editor.org/rfc/rfc9309, fetched 2026-10-03)
//   - Group choice: the rules of every group whose user-agent line names our product token (case-insensitive,
//     the value up to the first character outside [A-Za-z_-]) are combined; with no such group, the rules of every
//     "*" group; with neither, everything is allowed.
//   - Rule choice: the matching rule with the longest pattern wins; on a tie Allow wins. Patterns support "*" (any
//     run of characters) and a final "$" (end of the path); an empty Disallow matches nothing. /robots.txt itself is
//     always allowed. The path compared is the URL's path plus its query string. Matching takes time linear in the
//     pattern's segments times the path length; a rule with more than 10 "*" counts as a Disallow that matches every
//     path (fail closed).
//   - Fetch: GET <origin>/robots.txt with our User-Agent, 5 s timeout, at most 512 KiB read (rules past that are
//     ignored), at most 5 redirects, each redirect target an http(s) public web host.
//   - Answers: 2xx -> the rules; 4xx other than 429 -> no robots.txt ("unavailable": everything allowed); 429, 5xx,
//     a network error, a timeout, too many redirects or a refused redirect -> "unreachable": everything disallowed
//     (the gate fails closed).
//   - Owner-recorded permissions: a host named in SCRAPER_PERMITTED_HOSTS (JSON object host -> permission
//     reference) is allowed without the robots.txt check; the reference travels in the answer so every run logs it.
//   - Cache per isolate: rules for 1 h, an unreachable answer for 5 min, keyed by origin.
//   - Crawl-delay of the chosen group, when present and a non-negative number, is returned in seconds.

import { scrapeTargetAllowed } from '../../../shared/src/auth/scrape-rules';

export const PRODUCT_TOKEN = 'MicronsHubBot';
export const ROBOTS_TIMEOUT_MS = 5_000;
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const ROBOTS_MAX_REDIRECTS = 5;
export const ROBOTS_TTL_MS = 3_600_000;
export const ROBOTS_FAILURE_TTL_MS = 300_000;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelayS?: number;
}

export interface RobotsFile {
  groups: RobotsGroup[];
}

export type RobotsState =
  | { kind: 'rules'; robots: RobotsFile }
  | { kind: 'unavailable'; status: number }
  | { kind: 'unreachable'; reason: string };

export interface RobotsDecision {
  allowed: boolean;
  /** e.g. 'robots_allow', 'robots_disallow', 'robots_unavailable', 'robots_unreachable:<why>', 'permitted'. */
  reason: string;
  crawlDelayS?: number;
  /** Owner-recorded permission reference when the host is permitted. */
  permission?: string;
}

export interface RobotsOptions {
  fetchImpl: typeof fetch;
  userAgent: string;
  /** Host (lower case) -> permission reference (SCRAPER_PERMITTED_HOSTS). */
  permitted?: ReadonlyMap<string, string>;
  now?: () => number;
  cache?: RobotsCache;
  productToken?: string;
}

/** Per-isolate cache of robots.txt answers, keyed by origin. */
export class RobotsCache {
  private readonly entries = new Map<string, { state: RobotsState; expires: number }>();

  get(origin: string, now: number): RobotsState | null {
    const entry = this.entries.get(origin);
    if (!entry) return null;
    if (entry.expires <= now) {
      this.entries.delete(origin);
      return null;
    }
    return entry.state;
  }

  set(origin: string, state: RobotsState, now: number): void {
    this.entries.set(origin, { state, expires: now + (state.kind === 'unreachable' ? ROBOTS_FAILURE_TTL_MS : ROBOTS_TTL_MS) });
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The default per-isolate cache. */
export const robotsCache = new RobotsCache();

// ----- parsing -----

function agentToken(value: string): string {
  const m = /^[A-Za-z_-]*/.exec(value.trim());
  return (m ? m[0] : '').toLowerCase();
}

/** Parses robots.txt text into groups (lines that are not user-agent, allow, disallow or crawl-delay are ignored). */
export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value === '*' ? '*' : agentToken(value));
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelayS = delay;
    }
  }
  return { groups };
}

/** Percent-encodes characters outside the URL-safe set, keeping existing %XX escapes and the pattern characters. */
function normalisePattern(pattern: string): string {
  return pattern.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/?%]/g, (c) => encodeURIComponent(c));
}

/** Most "*" a rule may hold; a rule with more is treated as a Disallow that matches every path (fail closed). */
export const MAX_RULE_WILDCARDS = 10;

/** Number of "*" in a pattern. */
export function wildcardCount(pattern: string): number {
  let n = 0;
  for (let i = 0; i < pattern.length; i++) if (pattern.charCodeAt(i) === 0x2a) n++;
  return n;
}

/**
 * True when `pattern` (with * and a final $) matches `path` from its start. Literal segments are matched left to
 * right: the first at the start, each later one at its leftmost position after the previous one, and with a final $
 * the last one at the end of the path. For patterns whose only wildcard is "*" the leftmost choice is never worse
 * than any other, so this is exact, and the work grows with segments x path length only.
 */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const segments = normalisePattern(anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = segments[0];
  if (segments.length === 1) return anchored ? path === first : path.startsWith(first);
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  for (let i = 1; i < segments.length - 1; i++) {
    const at = path.indexOf(segments[i], pos);
    if (at < 0) return false;
    pos = at + segments[i].length;
  }
  const last = segments[segments.length - 1];
  if (anchored) return path.length - last.length >= pos && path.endsWith(last);
  return path.indexOf(last, pos) >= 0;
}

/** Groups that apply to the product token: its own (combined), else the '*' groups (combined), else none. */
export function groupsFor(robots: RobotsFile, productToken: string): RobotsGroup[] {
  const token = productToken.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.includes(token));
  if (own.length > 0) return own;
  return robots.groups.filter((g) => g.agents.includes('*'));
}

/** RFC 9309 decision for a path (path + query) under parsed rules. */
export function decide(robots: RobotsFile, productToken: string, path: string): { allowed: boolean; rule: RobotsRule | null; crawlDelayS?: number } {
  const groups = groupsFor(robots, productToken);
  const delays = groups.map((g) => g.crawlDelayS).filter((d): d is number => d !== undefined);
  const crawlDelayS = delays.length > 0 ? Math.max(...delays) : undefined;
  if (path === '/robots.txt') return { allowed: true, rule: null, crawlDelayS };
  let best: RobotsRule | null = null;
  for (const group of groups) {
    for (const candidate of group.rules) {
      if (candidate.pattern === '') continue;
      const tooWide = wildcardCount(candidate.pattern) > MAX_RULE_WILDCARDS;
      if (!tooWide && !patternMatches(candidate.pattern, path)) continue;
      const rule = tooWide ? { allow: false, pattern: candidate.pattern } : candidate;
      const length = normalisePattern(rule.pattern).length;
      const bestLength = best ? normalisePattern(best.pattern).length : -1;
      if (length > bestLength || (length === bestLength && rule.allow && !best?.allow)) best = rule;
    }
  }
  return { allowed: best ? best.allow : true, rule: best, crawlDelayS };
}

// ----- fetching -----

async function readCapped(response: Response, maxBytes: number): Promise<string> {
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

/** Fetches and classifies <origin>/robots.txt (see the rules above). */
export async function fetchRobots(origin: string, o: Pick<RobotsOptions, 'fetchImpl' | 'userAgent'>): Promise<RobotsState> {
  let target = `${origin}/robots.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= ROBOTS_MAX_REDIRECTS; hop++) {
      let response: Response;
      try {
        response = await o.fetchImpl(target, {
          method: 'GET',
          headers: { 'User-Agent': o.userAgent, Accept: 'text/plain, */*;q=0.5' },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        return { kind: 'unreachable', reason: controller.signal.aborted ? 'timeout' : 'network' };
      }
      if (response.status >= 300 && response.status < 400) {
        response.body?.cancel().catch(() => {});
        const location = response.headers.get('location');
        if (!location) return { kind: 'unreachable', reason: 'redirect_without_location' };
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          return { kind: 'unreachable', reason: 'bad_redirect' };
        }
        if (!scrapeTargetAllowed(next)) return { kind: 'unreachable', reason: 'redirect_refused' };
        target = next;
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        const text = await readCapped(response, ROBOTS_MAX_BYTES);
        return { kind: 'rules', robots: parseRobots(text) };
      }
      response.body?.cancel().catch(() => {});
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return { kind: 'unavailable', status: response.status };
      return { kind: 'unreachable', reason: `status_${response.status}` };
    }
    return { kind: 'unreachable', reason: 'too_many_redirects' };
  } catch {
    return { kind: 'unreachable', reason: controller.signal.aborted ? 'timeout' : 'read_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON object host -> permission reference; anything malformed reads as no permitted host. */
export function parsePermittedHosts(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return map;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map;
  for (const [host, reference] of Object.entries(parsed as Record<string, unknown>)) {
    const name = host.trim().toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) continue;
    if (typeof reference !== 'string' || reference.trim() === '') continue;
    map.set(name, reference.trim().slice(0, 200));
  }
  return map;
}

/** Host of a URL as SCRAPER_PERMITTED_HOSTS names it (lower case, no trailing dot), or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** The gate: may the module fetch `url`? (See the rules above.) */
export async function robotsAllows(url: string, o: RobotsOptions): Promise<RobotsDecision> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'bad_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { allowed: false, reason: 'bad_url' };
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const permission = o.permitted?.get(host);
  if (permission !== undefined) return { allowed: true, reason: 'permitted', permission };

  const now = (o.now ?? Date.now)();
  const cache = o.cache ?? robotsCache;
  let state = cache.get(parsed.origin, now);
  if (!state) {
    state = await fetchRobots(parsed.origin, o);
    cache.set(parsed.origin, state, now);
  }
  if (state.kind === 'unreachable') return { allowed: false, reason: `robots_unreachable:${state.reason}` };
  if (state.kind === 'unavailable') return { allowed: true, reason: 'robots_unavailable' };
  const verdict = decide(state.robots, o.productToken ?? PRODUCT_TOKEN, `${parsed.pathname}${parsed.search}`);
  const decision: RobotsDecision = { allowed: verdict.allowed, reason: verdict.allowed ? 'robots_allow' : 'robots_disallow' };
  if (verdict.crawlDelayS !== undefined) decision.crawlDelayS = verdict.crawlDelayS;
  return decision;
}
