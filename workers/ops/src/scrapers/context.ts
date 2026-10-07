// Dependencies of the scraper module (fetch, identity, permissions, browser, clock, caches) and the per-host pause.
//
// Rules
//   - A host that answered 403, 429 or a challenge page is paused for 24 h: no plain fetch and no browser for it.
//     The pause is kept per isolate and, when a Db is given, in public.scan_logs (a row with
//     error_message 'blocked:<host>'), so other isolates see it too.
//   - The User-Agent is SCRAPER_USER_AGENT (default MicronsHubBot/1.0 with the contact URL of the site).
//   - SCRAPER_PERMITTED_HOSTS is parsed once per call of scraperDeps(); a malformed value permits no host.
//   - Log lines carry the event, host and reason only (never page content, e-mail addresses or query strings).

import { formatLogLine } from '../../../shared/src/http/log';
import type { Db } from '../db/postgrest';
import { LOG_PREFIX } from '../env';
import type { BrowserPort } from '../ports/index';
import { scraperBrowser } from './browser';
import { scraperFetch, type ScraperEnv } from './fetch-page';
import { parsePermittedHosts, robotsAllows, robotsCache, type RobotsCache, type RobotsDecision } from './robots';

export const DEFAULT_SCRAPER_USER_AGENT = 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)';
export const HOST_PAUSE_MS = 24 * 3_600_000;
/** Shortest wait between two pages of one directory (ms), before Crawl-delay. */
export const PAGE_DELAY_MS: Readonly<Record<'europages' | 'wlw', number>> = { europages: 2_500, wlw: 4_000 };
/** Most pages of one directory scan. */
export const MAX_PAGES = 10;

export interface ScraperDeps {
  fetch: typeof fetch;
  userAgent: string;
  /** Host (lower case) -> owner-recorded permission reference. */
  permitted: ReadonlyMap<string, string>;
  browser: BrowserPort | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  robotsCache: RobotsCache;
  pauses: HostPauses;
  /** Persists and reads host pauses through scan_logs when set. */
  db?: Db;
  log(event: string, fields: Record<string, string | number | boolean | undefined>): void;
}

/** Per-isolate pauses: host -> paused until (ms since epoch). */
export class HostPauses {
  private readonly until = new Map<string, number>();

  pause(host: string, now: number): void {
    this.until.set(host, now + HOST_PAUSE_MS);
  }

  /** Remaining pause in ms (0 when the host is not paused). */
  remaining(host: string, now: number): number {
    const end = this.until.get(host);
    if (end === undefined) return 0;
    if (end <= now) {
      this.until.delete(host);
      return 0;
    }
    return end - now;
  }

  clear(): void {
    this.until.clear();
  }
}

/** The default per-isolate pauses. */
export const hostPauses = new HostPauses();

/** error_message of the scan_logs row that records a pause. */
export function pauseMarker(host: string): string {
  return `blocked:${host}`;
}

/** Remaining pause of a host in ms: per isolate first, then the scan_logs rows of the last 24 h. */
export async function pauseRemaining(deps: Pick<ScraperDeps, 'pauses' | 'db' | 'now'>, host: string): Promise<number> {
  const now = deps.now();
  const local = deps.pauses.remaining(host, now);
  if (local > 0 || !deps.db) return local;
  try {
    const rows = await deps.db.select<{ started_at: string }>('scan_logs', {
      columns: 'started_at',
      filters: [
        ['error_message', 'eq', pauseMarker(host)],
        ['started_at', 'gte', new Date(now - HOST_PAUSE_MS).toISOString()],
      ],
      order: [{ column: 'started_at', ascending: false }],
      limit: 1,
    });
    if (rows.length === 0) return 0;
    const started = Date.parse(rows[0].started_at);
    if (!Number.isFinite(started)) return 0;
    const remaining = started + HOST_PAUSE_MS - now;
    if (remaining > 0) deps.pauses.pause(host, started);
    return Math.max(0, remaining);
  } catch {
    // A failed read does not pause the host; the robots gate and the fetch answer still apply.
    return 0;
  }
}

/** The robots gate with the module's identity, permissions, clock and cache. */
export function robotsDecision(deps: Pick<ScraperDeps, 'fetch' | 'userAgent' | 'permitted' | 'now' | 'robotsCache'>, url: string): Promise<RobotsDecision> {
  return robotsAllows(url, { fetchImpl: deps.fetch, userAgent: deps.userAgent, permitted: deps.permitted, now: deps.now, cache: deps.robotsCache });
}

/**
 * The robots check of redirect targets for fetchPage: the first URL already passed the gate; every other target is
 * asked again, and the refusal is kept for the answer.
 */
export function redirectGate(deps: ScraperDeps, first: string): { allow(target: string): Promise<boolean>; refused: RobotsDecision | null } {
  const gate = {
    refused: null as RobotsDecision | null,
    async allow(target: string): Promise<boolean> {
      if (target === first) return true;
      const hop = await robotsDecision(deps, target);
      if (!hop.allowed) gate.refused = hop;
      return hop.allowed;
    },
  };
  return gate;
}

function defaultLog(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, `scraper ${event}`, fields));
}

/** Dependencies for a Worker invocation; overrides for tests. */
export function scraperDeps(env: ScraperEnv, o: Partial<ScraperDeps> = {}): ScraperDeps {
  return {
    fetch: o.fetch ?? scraperFetch(env),
    userAgent: o.userAgent ?? (env.SCRAPER_USER_AGENT?.trim() || DEFAULT_SCRAPER_USER_AGENT),
    permitted: o.permitted ?? parsePermittedHosts(env.SCRAPER_PERMITTED_HOSTS),
    browser: o.browser !== undefined ? o.browser : scraperBrowser(env),
    now: o.now ?? (() => Date.now()),
    sleep: o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    robotsCache: o.robotsCache ?? robotsCache,
    pauses: o.pauses ?? hostPauses,
    db: o.db,
    log: o.log ?? defaultLog,
  };
}
