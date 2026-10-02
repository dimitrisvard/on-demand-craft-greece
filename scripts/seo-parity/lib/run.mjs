// Capture and compare engine shared by every mode (SEO_PARITY.md §5.1).

import { extractForHop } from './extract.mjs';
import { getChain, isAccessLogin, isChallenge, cookieSummary, contentFamily } from './fetch.mjs';

/** Where a request for `entry` goes on a side whose origin is `origin`. */
export function requestUrl(entry, origin) {
  return /^https?:\/\//.test(entry.url) ? entry.url : `${origin}${entry.url}`;
}

/**
 * Capture one entry on one side (GET chain, HEAD, OPTIONS as listed).
 * Records hold response data only; request headers are never recorded.
 * @param o { client, origin, baseOrigin, side, maxHops, store }
 */
export async function captureSide(entry, o) {
  const start = requestUrl(entry, o.origin);
  const entryOrigin = new URL(start).origin;
  const methods = {};
  const issues = [];
  const store = o.store;
  const noteResponse = (status, headers, location, url) => {
    const ch = isChallenge(status, headers);
    if (ch) issues.push({ kind: 'challenge', side: o.side, url, detail: ch });
    if (o.side === 'candidate' && isAccessLogin(status, location)) issues.push({ kind: 'access-login', side: o.side, url, detail: `${status} → ${location}` });
  };
  for (const method of entry.methods) {
    if (method === 'GET') {
      const decide = (target) => {
        if (target.pathname.startsWith('/api/')) return { follow: false, reason: 'api' };
        if (o.side === 'candidate' && target.origin === o.baseOrigin && o.baseOrigin !== o.origin) {
          // Absolute link back to the base origin: walk it on the candidate.
          return { follow: true, requestUrl: `${o.origin}${target.pathname}${target.search}` };
        }
        if (target.origin === o.origin || target.origin === entryOrigin) return { follow: true };
        return { follow: false, reason: 'off-site' };
      };
      const chain = await getChain(o.client, start, {
        maxHops: o.maxHops,
        decide,
        onResponse: (hop, res) => {
          noteResponse(hop.status, hop.headers, hop.location, hop.url);
          if (!entry.secret_body) store.put(res.body, hop.family);
          if (!(hop.status >= 300 && hop.status < 400 && hop.location)) hop.extracted = extractForHop(hop, res.body);
        },
      });
      methods.GET = { hops: chain.hops, attempts: chain.attempts, error: chain.error, stop: chain.stop };
    } else {
      const r = await o.client.send(start, method);
      if (r.error) { methods[method] = { hops: [], attempts: r.attempts, error: r.error }; continue; }
      const res = r.response;
      let location = null;
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        try { location = new URL(res.headers.location, start).href; } catch { location = res.headers.location; }
      }
      noteResponse(res.status, res.headers, location, start);
      const hop = {
        url: start, status: res.status, location, headers: res.headers, set_cookies: cookieSummary(res.setCookies),
        family: contentFamily(res.headers['content-type'], start),
      };
      if (method === 'HEAD') hop.head_body_length = res.headBodyLength;
      else hop.body_length = res.body.length;
      methods[method] = { hops: [hop], attempts: r.attempts, error: null };
    }
  }
  return { methods, issues };
}

export function recordError(rec) {
  for (const [m, r] of Object.entries(rec.methods)) if (r.error) return `${m}: ${r.error}`;
  return null;
}

export function maxAttempts(rec) {
  return Math.max(0, ...Object.values(rec.methods).map((r) => r.attempts || 0));
}
