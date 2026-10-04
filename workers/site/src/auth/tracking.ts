// E-mail tracking links (/api/marketing?action=track, /api/track): no credential by design, and every real link
// keeps the handler's exact answer. Two rules on top of the unchanged handler:
//   1. Side effects are throttled per sent event (key trk:<eid>, the id in canonical uuid form). Over the limit
//      the gate answers itself with the response the handler gives for a repeat hit (open: pixel; click: 302;
//      unsubscribe: page), byte for byte, and no database write happens. The redirect decision below still
//      applies to a throttled click.
//   2. A click redirects to its `url` only when the link belongs to the site:
//        - eid and cid must be UUIDs, else the target is SITE_ORIGIN/ (no lookup);
//        - a recorded 'sent' event (id = eid, campaign_id = cid) keeps an http(s) url;
//        - otherwise (no row, or any 4xx) the url is kept only when its host is the site's own host, the zone apex,
//          a one-label subdomain of the zone, or the host of a link in that campaign's body;
//        - when the database cannot be asked (network, 3 s timeout, 5xx) an http(s) url is kept (logged);
//        - a url that cannot be percent-decoded goes to SITE_ORIGIN/.
//      Mode 'redirect' of API_GATES_MODE: enforce rewrites the url the handler sees; report only logs.

import { filterValue, rowsOf } from '../../../shared/src/auth/postgrest';
import { rateKey } from '../../../shared/src/auth/rate-limit';
import { missingNames } from '../../../shared/src/http/env-check';
import type { ResolvedApi } from '../api/resolve';
import type { Env } from '../env';
import { replaceQueryParam } from './body';
import { SERVICE_NAMES, UUID_RE, canonicalUuid, serviceRest } from './db';
import type { GateModes } from './policy';
import { checkRate } from './rate-limit';

const LOG_PREFIX = '[microns-site]';
const LOOKUP_TIMEOUT_MS = 3_000;

// The handler's 1x1 PNG (api/marketing.js TRACKING_PIXEL), 70 bytes.
const PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// The handler's unsubscribe page (api/marketing.js, type=unsubscribe), 547 bytes including its indentation.
export const UNSUBSCRIBE_HTML = [
  '',
  '        <!DOCTYPE html>',
  '        <html>',
  '        <head><title>Unsubscribed</title>',
  '        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}',
  '        .box{text-align:center;padding:2rem;max-width:400px;}</style>',
  '        </head>',
  '        <body><div class="box">',
  "          <h1>You've been unsubscribed</h1>",
  '          <p>You will no longer receive emails from this sender. This may take up to 24 hours to take effect.</p>',
  '        </div></body>',
  '        </html>',
  '      ',
].join('\n');

export function trackingPixel(): Uint8Array {
  const binary = atob(PIXEL_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Repeat-hit answer of type=open: pixel with the four cache headers. */
export function openResponse(): Response {
  return new Response(trackingPixel(), {
    status: 200,
    headers: [
      ['Content-Type', 'image/png'],
      ['Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'],
      ['Pragma', 'no-cache'],
      ['Expires', '0'],
    ],
  });
}

/** Repeat-hit answer of type=click. */
export function clickResponse(location: string): Response {
  return new Response(null, { status: 302, headers: [['Cache-Control', 'no-store'], ['Location', location]] });
}

/** Answer of type=unsubscribe. */
export function unsubscribeResponse(): Response {
  return new Response(UNSUBSCRIBE_HTML, { status: 200, headers: [['Content-Type', 'text/html']] });
}

export type TrackingOutcome =
  | { kind: 'allow'; functionUrl?: string }
  | { kind: 'respond'; response: Response }
  | { kind: 'config'; missing: string[] };

export interface RedirectDecision {
  /** The url as the handler decodes it (twice); null when it cannot be decoded. */
  decoded: string | null;
  /** Where the click should go. */
  target: string;
}

function siteHost(env: Env): string {
  try {
    return new URL(env.SITE_ORIGIN).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function siteHome(env: Env): string {
  try {
    return `${new URL(env.SITE_ORIGIN).origin}/`;
  } catch {
    return '/';
  }
}

function httpHost(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The site's own hosts: SITE_ORIGIN's host, the zone apex and one-label subdomains of the zone. */
export function isOwnHost(host: string, env: Env): boolean {
  const own = siteHost(env);
  if (!own) return false;
  const zone = own.replace(/^www\./, '');
  if (host === own || host === zone) return true;
  if (!host.endsWith(`.${zone}`)) return false;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host.slice(0, -(zone.length + 1)));
}

/** Hosts of absolute http(s) links (href attributes) in an HTML body. */
export function linkHosts(body: string): Set<string> {
  const hosts = new Set<string>();
  const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const match of body.matchAll(re)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').replace(/&amp;/gi, '&').trim();
    const host = httpHost(raw);
    if (host) hosts.add(host);
  }
  return hosts;
}

function dbUnavailable(): void {
  console.log(`${LOG_PREFIX} gate db_unavailable MK-1`);
}

export async function redirectDecision(env: Env, rawUrl: string, eid: string, cid: string): Promise<RedirectDecision> {
  const home = siteHome(env);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    return { decoded: null, target: home };
  }
  if (!UUID_RE.test(eid) || !UUID_RE.test(cid)) return { decoded, target: home };
  const host = httpHost(decoded);

  const sent = await serviceRest(
    env,
    `marketing_events?select=id&id=eq.${eid}&campaign_id=eq.${cid}&event_type=eq.sent&limit=1`,
    undefined,
    LOOKUP_TIMEOUT_MS,
  );
  if (sent.kind === 'unavailable') {
    dbUnavailable();
    return { decoded, target: host ? decoded : home };
  }
  if (rowsOf(sent).length > 0) return { decoded, target: host ? decoded : home };

  if (!host) return { decoded, target: home };
  if (isOwnHost(host, env)) return { decoded, target: decoded };
  const campaign = await serviceRest(env, `marketing_campaigns?select=body&id=eq.${filterValue(cid)}&limit=1`, undefined, LOOKUP_TIMEOUT_MS);
  if (campaign.kind === 'unavailable') {
    dbUnavailable();
    return { decoded, target: decoded };
  }
  const body = (rowsOf(campaign)[0] as { body?: unknown } | undefined)?.body;
  if (typeof body === 'string' && linkHosts(body).has(host)) return { decoded, target: decoded };
  return { decoded, target: home };
}

/** Gate decision for MK-1; the caller wraps it into a GateOutcome with principal ANON. */
export async function trackingGate(r: ResolvedApi, env: Env, modes: GateModes): Promise<TrackingOutcome> {
  // Values as the handler reads them from req.query (a repeated key is an array).
  const { type, eid, cid, url } = r.query;
  // Requests the handler answers without any database access go through unchanged.
  if (!eid || !cid) return { kind: 'allow' };
  if (type !== 'open' && type !== 'click' && type !== 'unsubscribe') return { kind: 'allow' };
  if (type === 'click' && !url) return { kind: 'allow' };

  if (type === 'click') {
    const missing = missingNames(env, SERVICE_NAMES);
    if (missing.length) return { kind: 'config', missing };
  }

  // Values are coerced as the handler's template strings and query builders coerce them. The key is the event id
  // as the database reads it, so every spelling of one id counts against the same limit; a value that is not a
  // uuid matches no row and keeps its own key.
  const eventId = String(eid);
  const rate = await checkRate(env, rateKey('trk', canonicalUuid(eventId) ?? eventId));
  if (rate.kind === 'config') return rate;
  let throttled = rate.kind === 'limited';
  if (throttled && modes.rate === 'report') {
    console.log(`${LOG_PREFIX} gate would deny MK-1 rate_limited`);
    throttled = false;
  }

  if (type === 'open') return throttled ? { kind: 'respond', response: openResponse() } : { kind: 'allow' };
  if (type === 'unsubscribe') return throttled ? { kind: 'respond', response: unsubscribeResponse() } : { kind: 'allow' };

  const decision = await redirectDecision(env, String(url), String(eid), String(cid));
  const enforce = modes.redirect === 'enforce';
  const changed = decision.decoded === null || decision.target !== decision.decoded;
  let functionUrl: string | undefined;
  if (changed) {
    if (enforce) functionUrl = replaceQueryParam(r.functionUrl, 'url', encodeURIComponent(decision.target));
    else console.log(`${LOG_PREFIX} gate would deny MK-1 redirect_not_allowed`);
  }
  if (throttled) {
    const location = enforce ? decision.target : decision.decoded;
    // Report mode and an undecodable url: the handler fails before any database access, so it may run.
    if (location !== null) return { kind: 'respond', response: clickResponse(location) };
  }
  return functionUrl === undefined ? { kind: 'allow' } : { kind: 'allow', functionUrl };
}
