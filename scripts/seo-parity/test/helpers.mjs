// Test helpers: crafted local sites on 127.0.0.1 and an in-process runner.
import http from 'node:http';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { main } from '../lib/cli.mjs';

export const ACCESS_ID = 'test-access-id.access';
export const ACCESS_SECRET = 'test-access-secret-0123456789abcdef';

export function tmpDir(prefix = 'parity-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

const HREFLANG = ['en', 'de', 'fr'].map((l) => `<link rel="alternate" hreflang="${l}" href="https://www.micronshub.eu/${l}"/>`);

/** The default fixture site. `opts` mutate it per test. */
export function siteDocument(opts = {}) {
  const title = opts.title ?? 'Microns Hub — On-demand manufacturing';
  const canonical = opts.canonical ?? 'https://www.micronshub.eu/en';
  const hreflang = opts.hreflangReversed ? [...HREFLANG].reverse() : HREFLANG;
  const jsonld = opts.jsonldReordered
    ? '{"name":"Microns Hub","@type":"Organization","@context":"https://schema.org","url":"https://www.micronshub.eu"}'
    : '{"@context":"https://schema.org","@type":"Organization","name":"Microns Hub","url":"https://www.micronshub.eu"}';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="CNC machining &amp; sheet metal">
<link rel="canonical" href="${canonical}"/>
${hreflang.join('\n')}
<meta property="og:title" content="${title}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<script type="application/ld+json">${jsonld}</script>
<script type="module" src="/assets/index-${opts.assetHash ?? 'AbCdEf12'}.js"></script>
</head>
<body><div id="root"></div>
<article id="seo-content" lang="en"><h1>${title}</h1><p>Parts in days.</p><a href="/en/services">Services</a><img src="/logo.png" alt=""></article>
</body></html>`;
}

export const REDIRECTS_FILE = '/*    /index.html   200\n';
export const SHELL = (hash = 'AbCdEf12') => `<!DOCTYPE html><html lang="en"><head><title>Shell</title><script type="module" src="/assets/index-${hash}.js"></script></head><body><div id="root"></div></body></html>`;

const SITEMAP = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>https://www.micronshub.eu/en</loc><lastmod>2026-10-01</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
${extra}</urlset>
`;

/**
 * Start a fixture site.
 * @param opts { title, canonical, hreflangReversed, jsonldReordered, dropHeader, extraHeader, enStatus,
 *   redirectTo, headBody, robotsTag, cfBm, challenge, sitemapExtra, offsiteRedirect, x-frame-options, titleSequence, seoSource,
 *   bodyTransform(html) → html for /en, headRedirectTo (Location of HEAD /old), clientOnlyRedirectMethods, routes }
 */
export function startSite(opts = {}) {
  const requests = [];
  let enHits = 0;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    const common = {
      'x-content-type-options': 'nosniff',
      'strict-transport-security': 'max-age=63072000',
      ...(opts.robotsTag ? { 'x-robots-tag': opts.robotsTag } : {}),
    };
    if (opts.dropHeader) delete common[opts.dropHeader];
    if (opts.extraHeader) common[opts.extraHeader[0]] = opts.extraHeader[1];
    if (opts.challenge) {
      res.writeHead(429, { 'x-vercel-mitigated': 'challenge', 'content-type': 'text/html' });
      res.end('challenge');
      return;
    }
    const send = (status, headers, body) => {
      const h = { ...common, ...headers };
      if (opts.cfBm) h['set-cookie'] = ['__cf_bm=abc; Path=/; HttpOnly'];
      if (req.method === 'HEAD' && opts.headBody) {
        // Illegal on purpose: body bytes after a HEAD response.
        const lines = [`HTTP/1.1 ${status} X`, ...Object.entries(h).map(([k, v]) => `${k}: ${v}`), 'Connection: close', '', 'oops-body'];
        req.socket.end(lines.join('\r\n'));
        return;
      }
      res.writeHead(status, h);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const u = new URL(req.url, 'http://x');
    // opts.routes: { '/path': { status, headers, body } | () => same } (HTML by default).
    const route = opts.routes?.[u.pathname];
    if (route) {
      const r = typeof route === 'function' ? route() : route;
      send(r.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...(r.headers || {}) }, r.body);
      return;
    }
    if (u.pathname.startsWith('/api/')) {
      if (req.method !== 'OPTIONS') { res.writeHead(405); res.end(); return; }
      send(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT' }, '');
      return;
    }
    switch (u.pathname) {
      case '/en': {
        enHits += 1;
        const seq = opts.titleSequence;
        const title = seq ? seq[Math.min(enHits - 1, seq.length - 1)] : opts.title;
        const doc = siteDocument({ ...opts, title });
        const body = opts.bodyTransform ? opts.bodyTransform(doc) : doc;
        const gz = zlib.gzipSync(body);
        send(opts.enStatus ?? 200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate',
          'x-seo-source': opts.seoSource ?? 'db', vary: 'Accept-Encoding', 'content-encoding': 'gzip',
          ...(opts.xFrameOptions ? { 'x-frame-options': opts.xFrameOptions } : {}),
        }, gz);
        return;
      }
      case '/old':
        send(308, { location: (req.method === 'HEAD' && opts.headRedirectTo) || (opts.redirectTo ?? '/en') }, 'Redirecting');
        return;
      case '/offsite':
        send(302, { location: opts.offsiteRedirect ?? 'https://example.invalid/x' }, '');
        return;
      case '/client-only':
        if (opts.clientOnlyRedirect && (!opts.clientOnlyRedirectMethods || opts.clientOnlyRedirectMethods.includes(req.method))) { send(308, { location: opts.clientOnlyRedirect }, ''); return; }
        send(200, { 'content-type': 'text/html; charset=utf-8' }, '<!DOCTYPE html><html lang="en"><head><title>Shell</title></head><body></body></html>');
        return;
      case '/sitemap.xml':
        send(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=3600', vary: 'Accept-Encoding' }, SITEMAP(opts.sitemapExtra));
        return;
      case '/index.html':
        send(200, { 'content-type': 'text/html; charset=utf-8' }, SHELL(opts.assetHash));
        return;
      case '/_redirects':
        // Base: the committed text file; candidate (opts.redirectsShell): the SPA shell.
        if (opts.redirectsShell) send(200, { 'content-type': 'text/html; charset=utf-8' }, SHELL(opts.assetHash));
        else send(200, { 'content-type': 'text/plain; charset=utf-8' }, REDIRECTS_FILE);
        return;
      case '/robots.txt':
        send(200, { 'content-type': 'text/plain; charset=utf-8' }, 'User-agent: *\nAllow: /\n');
        return;
      default:
        send(404, { 'content-type': 'text/plain' }, 'not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
    });
  });
}

export const FIXTURE_ENTRIES = [
  { id: 'G1-001', group: 'G1', url: '/en', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'page', profiles: ['gate', 'full'] },
  { id: 'G5-001', group: 'G5', url: '/sitemap.xml', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'sitemap', profiles: ['gate', 'full'] },
  { id: 'G6-001', group: 'G6', url: '/old', methods: ['GET', 'HEAD'], expect: { status: 308, location: '/en' }, kind: 'redirect', profiles: ['gate', 'full'] },
  { id: 'G6-002', group: 'G6', url: '/client-only', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'redirect', profiles: ['gate', 'full'] },
  { id: 'G8-001', group: 'G8', url: '/robots.txt', methods: ['GET', 'HEAD'], expect: null, kind: 'special', profiles: ['gate', 'full'] },
  { id: 'G10-001', group: 'G10', url: '/api/marketing', methods: ['OPTIONS'], expect: null, kind: 'api', profiles: ['gate', 'full'] },
];

export function writeUrls(dir, entries = FIXTURE_ENTRIES) {
  const f = path.join(dir, 'urls.json');
  writeFileSync(f, JSON.stringify({ version: 1, seed: 'test', profile: 'gate', entries }));
  return f;
}

export function writeAllow(dir, entries = []) {
  const f = path.join(dir, `allow-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ version: 1, entries }));
  return f;
}

export const baseEnv = () => ({ PARITY_IGNORE_WINDOW: '1', PARITY_RETRY_BASE_MS: '5', PATH: process.env.PATH });

/** Run the CLI in-process; returns { code, out, err, report }. */
export async function run(args, env = baseEnv()) {
  const out = []; const err = [];
  const code = await main(args, env, { log: (...a) => out.push(a.join(' ')), err: (...a) => err.push(a.join(' ')) });
  let report = null;
  const i = args.indexOf('--out');
  if (i !== -1) {
    try { report = JSON.parse(readFileSync(path.join(args[i + 1], 'report.json'), 'utf8')); } catch { /* no report */ }
  }
  return { code, out: out.join('\n'), err: err.join('\n'), report };
}

export function diffsOf(report, id) {
  return report.results.find((r) => r.id === id)?.diffs || [];
}

/** Every file under dir, recursively, gunzipped when .gz. */
export function allFileContents(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        let b = readFileSync(p);
        if (p.endsWith('.gz')) b = zlib.gunzipSync(b);
        out.push({ path: p, text: b.toString('utf8') });
      }
    }
  };
  walk(dir);
  return out;
}
