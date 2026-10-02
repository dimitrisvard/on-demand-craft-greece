// HTTP client for the parity tool (SEO_PARITY.md §2.3).
//
// - Only GET, HEAD and OPTIONS exist here; any other method throws.
// - Requests are built with node:http(s) (GET, OPTIONS) and a raw socket
//   (HEAD), not with fetch(): fetch adds `Sec-Fetch-Mode: cors` and
//   `Accept-Language: *`, which no crawler sends and which can change what a
//   Cloudflare asset binding answers. The raw HEAD client also sees body
//   bytes a server sends after a HEAD response (F4 "HEAD body must be empty");
//   an HTTP parser would silently drop them.
// - Redirects are never followed by the transport; chains are walked by
//   `getChain` with explicit on-site rules.
// - Cloudflare Access headers live only inside a client constructed with an
//   `access` object, and are added only when the request origin equals that
//   object's origin. The base client never holds them. They are never
//   returned, logged or stored.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { MAX_ATTEMPTS, USER_AGENT } from './constants.mjs';
import { sha256, sleep } from './util.mjs';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ACCEPT_ENCODING = 'gzip, deflate, br';
const HEAD_GRACE_MS = 1000;

export class NetworkError extends Error {
  constructor(msg, code) { super(msg); this.name = 'NetworkError'; this.code = code || 'ENET'; }
}

/** Lower-cased header map (duplicates joined with ", ", as fetch does) + Set-Cookie list. */
export function headersFromRaw(rawHeaders) {
  const headers = {};
  const setCookies = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = String(rawHeaders[i]).toLowerCase();
    const value = String(rawHeaders[i + 1]);
    if (name === 'set-cookie') { setCookies.push(value); continue; }
    headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  }
  return { headers, setCookies };
}

/** Set-Cookie values are not stored; name + SHA-256 of the value only. */
export function cookieSummary(setCookies) {
  return setCookies.map((c) => {
    const eq = c.indexOf('=');
    const name = (eq === -1 ? c : c.slice(0, eq)).trim();
    return { name, value_sha256: sha256(c) };
  });
}

export function decodeBody(wire, contentEncoding) {
  if (!contentEncoding) return { body: wire, decodeError: null };
  const codings = contentEncoding.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).reverse();
  let body = wire;
  try {
    for (const c of codings) {
      if (c === 'identity') continue;
      if (c === 'gzip' || c === 'x-gzip') body = zlib.gunzipSync(body);
      else if (c === 'br') body = zlib.brotliDecompressSync(body);
      else if (c === 'deflate') {
        try { body = zlib.inflateSync(body); } catch { body = zlib.inflateRawSync(body); }
      } else return { body: wire, decodeError: `unsupported content-encoding ${c}` };
    }
  } catch (e) {
    return { body: wire, decodeError: `decode failed: ${e.message}` };
  }
  return { body, decodeError: null };
}

export function contentFamily(contentType, url = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return 'html';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('json')) return 'json';
  if (ct.startsWith('text/plain')) return 'txt';
  if (ct.includes('javascript') || ct.startsWith('text/css')) return 'code';
  if (!ct && /\.xml(\?|$)/.test(url)) return 'xml';
  return 'binary';
}

function requestHeaders(userAgent, extra) {
  return {
    'User-Agent': userAgent,
    Accept: '*/*',
    'Accept-Encoding': ACCEPT_ENCODING,
    Connection: 'close',
    ...extra,
  };
}

function hostOf(u) {
  return u.hostname.replace(/^\[|\]$/g, '');
}

/** One GET/OPTIONS request; resolves with the undecoded body. */
function requestOnce(urlStr, method, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) { reject(new NetworkError(`unsupported protocol ${u.protocol}`, 'EPROTO')); return; }
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = mod.request({
      protocol: u.protocol,
      hostname: hostOf(u),
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method,
      headers,
      agent: false,
      servername: net.isIP(hostOf(u)) ? undefined : hostOf(u),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(resolve, { status: res.statusCode, rawHeaders: res.rawHeaders, wire: Buffer.concat(chunks) }));
      res.on('error', (e) => finish(reject, new NetworkError(e.message, e.code)));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new NetworkError(`timeout after ${timeoutMs} ms`, 'ETIMEDOUT')); }, timeoutMs);
    req.on('error', (e) => finish(reject, new NetworkError(e.message, e.code)));
    req.end();
  });
}

/** HEAD over a raw socket so that body bytes after the header block are seen. */
function headOnce(urlStr, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isTls = u.protocol === 'https:';
    if (!isTls && u.protocol !== 'http:') { reject(new NetworkError(`unsupported protocol ${u.protocol}`, 'EPROTO')); return; }
    const host = hostOf(u);
    const port = Number(u.port || (isTls ? 443 : 80));
    const sock = isTls
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ['http/1.1'] })
      : net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let parsed = null;
    let done = false;
    let grace = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      sock.destroy();
      if (err) reject(err);
      else if (!parsed) reject(new NetworkError('connection closed before a response header', 'ECONNRESET'));
      else resolve({ status: parsed.status, rawHeaders: parsed.rawHeaders, headBodyLength: buf.length - parsed.end });
    };
    const timer = setTimeout(() => finish(parsed ? null : new NetworkError(`timeout after ${timeoutMs} ms`, 'ETIMEDOUT')), timeoutMs);
    const lines = [`HEAD ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    sock.once(isTls ? 'secureConnect' : 'connect', () => sock.write(`${lines.join('\r\n')}\r\n\r\n`));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (!parsed) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = buf.subarray(0, end).toString('latin1').split('\r\n');
        const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head[0] || '');
        if (!m) { finish(new NetworkError('malformed status line', 'EPROTO')); return; }
        const status = Number(m[1]);
        if (status >= 100 && status < 200) { buf = buf.subarray(end + 4); continue; }
        const rawHeaders = [];
        for (const line of head.slice(1)) {
          const i = line.indexOf(':');
          if (i > 0) rawHeaders.push(line.slice(0, i).trim(), line.slice(i + 1).trim());
        }
        parsed = { status, rawHeaders, end: end + 4 };
        grace = setTimeout(() => finish(null), HEAD_GRACE_MS);
      }
    });
    sock.on('end', () => finish(null));
    sock.on('close', () => finish(null));
    sock.on('error', (e) => finish(parsed ? null : new NetworkError(e.message, e.code)));
  });
}

/** 127.0.0.0/8, ::1 and localhost. */
export function isLoopbackHost(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  return net.isIPv4(h) && h.startsWith('127.');
}

/** Access service-token headers travel only over https, or http to loopback (tests). */
export function accessTransportOk(u) {
  const url = typeof u === 'string' ? new URL(u) : u;
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
}

export function isChallenge(status, headers) {
  if (status === 429) return 'status 429';
  const v = String(headers['x-vercel-mitigated'] || '');
  if (/challenge/i.test(v)) return `x-vercel-mitigated: ${v}`;
  const c = String(headers['cf-mitigated'] || '');
  if (/challenge/i.test(c)) return `cf-mitigated: ${c}`;
  return null;
}

export function isAccessLogin(status, location) {
  if (status < 300 || status >= 400 || !location) return false;
  return /\.cloudflareaccess\.com(\/|$)/i.test(location) || /\/cdn-cgi\/access\/login/i.test(location);
}

export class HttpClient {
  /**
   * @param {object} o
   * @param {'base'|'candidate'} o.side
   * @param {{origin:string,id:string,secret:string}|null} [o.access]
   */
  constructor({ side, userAgent = USER_AGENT, timeoutMs, retryBaseMs = 1000, access = null }) {
    this.side = side;
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.retryBaseMs = retryBaseMs;
    // Kept in a closure-like private field; never serialised.
    this.#access = access && access.id && access.secret ? { origin: new URL(access.origin).origin, id: access.id, secret: access.secret } : null;
    this.requestsPerHost = new Map();
  }

  #access;

  get hasAccess() { return Boolean(this.#access); }

  #extraHeaders(urlStr) {
    if (!this.#access) return {};
    const u = new URL(urlStr);
    if (u.origin !== this.#access.origin) return {};
    // Never in clear text over the network: https, or http to a loopback host only.
    if (!accessTransportOk(u)) return {};
    return { 'CF-Access-Client-Id': this.#access.id, 'CF-Access-Client-Secret': this.#access.secret };
  }

  /**
   * Send one request with up to 3 attempts (network errors, timeouts, 5xx).
   * Returns { response, attempts } or { error, attempts }; a 5xx after the
   * last attempt is returned as a response.
   */
  async send(urlStr, method) {
    if (!ALLOWED_METHODS.has(method)) throw new Error(`method ${method} is never sent by the parity tool`);
    const headers = requestHeaders(this.userAgent, this.#extraHeaders(urlStr));
    const host = new URL(urlStr).host;
    let lastError = null;
    let lastResponse = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.requestsPerHost.set(host, (this.requestsPerHost.get(host) || 0) + 1);
      try {
        let response;
        if (method === 'HEAD') {
          const r = await headOnce(urlStr, headers, this.timeoutMs);
          const { headers: h, setCookies } = headersFromRaw(r.rawHeaders);
          response = { status: r.status, headers: h, setCookies, body: Buffer.alloc(0), wireLength: 0, headBodyLength: r.headBodyLength, decodeError: null };
        } else {
          const r = await requestOnce(urlStr, method, headers, this.timeoutMs);
          const { headers: h, setCookies } = headersFromRaw(r.rawHeaders);
          const { body, decodeError } = decodeBody(r.wire, h['content-encoding']);
          response = { status: r.status, headers: h, setCookies, body, wireLength: r.wire.length, decodeError };
        }
        lastResponse = response;
        lastError = null;
        // A challenge is never retried: it invalidates the run.
        if (isChallenge(response.status, response.headers)) return { response, attempts: attempt };
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) { await sleep(this.retryBaseMs * 3 ** (attempt - 1)); continue; }
        return { response, attempts: attempt };
      } catch (e) {
        lastError = e;
        if (attempt < MAX_ATTEMPTS) await sleep(this.retryBaseMs * 3 ** (attempt - 1));
      }
    }
    if (lastResponse) return { response: lastResponse, attempts: MAX_ATTEMPTS };
    return { error: `${lastError?.code || 'ERROR'}: ${lastError?.message || 'unknown error'}`, attempts: MAX_ATTEMPTS };
  }
}

/**
 * Walk a GET redirect chain (F1–F3).
 * @param {HttpClient} client
 * @param {string} startUrl absolute
 * @param {object} o
 * @param {number} o.maxHops
 * @param {(target: URL) => {follow: boolean, requestUrl?: string, reason?: string}} o.decide
 * @param {(hop: object, response: object) => void} [o.onResponse] sees the decoded body before it is dropped
 */
export async function getChain(client, startUrl, { maxHops, decide, onResponse }) {
  const hops = [];
  let url = startUrl;
  let attempts = 0;
  let stop = null;
  for (;;) {
    const r = await client.send(url, 'GET');
    attempts = Math.max(attempts, r.attempts);
    if (r.error) return { hops, attempts, error: `${url}: ${r.error}`, stop: 'error' };
    const res = r.response;
    const loc = res.headers.location;
    let location = null;
    if (res.status >= 300 && res.status < 400 && loc) {
      try { location = new URL(loc, url).href; } catch { location = loc; }
    }
    const hop = {
      url,
      status: res.status,
      location,
      headers: res.headers,
      set_cookies: cookieSummary(res.setCookies),
      body_sha256: sha256(res.body),
      body_length: res.body.length,
      wire_length: res.wireLength,
      decode_error: res.decodeError,
      family: contentFamily(res.headers['content-type'], url),
    };
    hops.push(hop);
    if (onResponse) await onResponse(hop, res);
    if (isChallenge(res.status, res.headers)) { stop = 'challenge'; break; }
    if (!location) break;
    if (hops.length > maxHops) { stop = 'max-hops'; break; }
    let target;
    try { target = new URL(location); } catch { stop = 'bad-location'; break; }
    const d = decide(target);
    if (!d.follow) { stop = d.reason || 'not-followed'; break; }
    url = d.requestUrl || target.href;
  }
  return { hops, attempts, error: null, stop };
}
