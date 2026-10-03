// URL set generator, groups G1–G10 (SEO_PARITY.md §3).
//
// The offline part (`buildUrlSet`) is pure: it takes the slug sources, the
// sitemap text, the shell HTML and the Supabase rows, and returns urls.json.
// The online part (`fetchInputs`) reads the base sitemap and shell (or local
// files given with --sitemap-file / --shell-file) and Supabase REST with the
// anon key from the environment (never printed).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import { ARTICLES_PER_LANGUAGE, PRODUCTION_ORIGIN, TOOL_VERSION } from './constants.mjs';
import { parseSitemap } from './extract.mjs';
import { encPath, sha256 } from './util.mjs';

export { encPath };

export class GeneratorError extends Error {
  constructor(msg) { super(msg); this.name = 'GeneratorError'; }
}

const assert = (cond, msg) => { if (!cond) throw new GeneratorError(`generator assertion failed: ${msg}`); };

/** Seeded order of article locs (§3.1 G4): SHA-256 of seed + "\n" + loc. */
export function sampleOrder(locs, seed) {
  return locs.map((loc) => ({ loc, k: sha256(`${seed}\n${loc}`) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.loc);
}

// Mapping between the vite.config.ts SLUGS keys and middleware/slugs.ts.
const VITE_KEY_TO_MW = { services: 'services', about: 'about', contact: 'contact', quote: 'quote', industries: 'industries', ourWork: 'ourWork', blog: 'blog' };
const VITE_SERVICE_KEYS = { cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping' };

/** G1 assertion: both SLUGS maps agree and produce the same 210 routes. */
export function checkSlugMaps(src) {
  assert(JSON.stringify([...src.VITE_LANGUAGES]) === JSON.stringify([...src.LANGUAGES]), 'LANGUAGES differ between vite.config.ts and middleware/types.ts');
  const mismatches = [];
  for (const lang of src.LANGUAGES) {
    const v = src.VITE_SLUGS[lang]; const m = src.SLUGS[lang];
    for (const [vk, mk] of Object.entries(VITE_KEY_TO_MW)) if (v[vk] !== m[mk]) mismatches.push(`${lang}.${vk}: vite=${v[vk]} middleware=${m[mk]}`);
    for (const [vk, id] of Object.entries(VITE_SERVICE_KEYS)) if (v[vk] !== m.serviceDetail[id]) mismatches.push(`${lang}.${vk}: vite=${v[vk]} middleware=${m.serviceDetail[id]}`);
  }
  assert(!mismatches.length, `SLUGS maps of vite.config.ts and middleware/slugs.ts disagree: ${mismatches.join('; ')}`);
  const routes = src.buildPrerenderRoutes();
  assert(routes.length === 210 && new Set(routes).size === 210, `G1 must be 210 unique paths (got ${routes.length}, ${new Set(routes).size} unique)`);
  // Same 15 shapes rebuilt with the handler's own localizedPath().
  const mw = new Set();
  for (const lang of src.LANGUAGES) {
    mw.add(src.localizedPath(lang, 'homepage'));
    mw.add(src.localizedPath(lang, 'services-index'));
    for (const id of src.SERVICE_IDS) mw.add(src.localizedPath(lang, 'service-detail', id));
    for (const t of ['industries', 'about', 'contact', 'our-work', 'blog-index', 'quote']) mw.add(src.localizedPath(lang, t));
    mw.add(`/${lang}/quote-request`);
  }
  const missing = routes.filter((r) => !mw.has(r));
  assert(mw.size === 210 && !missing.length, `G1 routes from vite.config.ts and middleware/slugs.ts differ: ${missing.slice(0, 5).join(', ')}`);
  return routes;
}

function shellAssets(shellText) {
  const doc = parse(shellText);
  let js = null; let css = null;
  const walk = (n) => {
    if (n.tagName === 'script' && !js) {
      const src = n.attrs.find((a) => a.name === 'src')?.value;
      const type = n.attrs.find((a) => a.name === 'type')?.value;
      if (src && src.startsWith('/assets/') && type === 'module') js = src;
    }
    if (n.tagName === 'link' && !css) {
      const rel = (n.attrs.find((a) => a.name === 'rel')?.value || '').toLowerCase().split(/\s+/);
      const href = n.attrs.find((a) => a.name === 'href')?.value;
      if (rel.includes('stylesheet') && href && href.startsWith('/assets/')) css = href;
    }
    for (const k of n.childNodes || []) walk(k);
  };
  walk(doc);
  return { js, css };
}

/**
 * Build urls.json.
 * @param o { root, src, base, profile, seed, sitemapText, sitemapSource, shellText, shellSource, servicePages, contentPages, now }
 */
export function buildUrlSet(o) {
  const { root, src, seed } = o;
  const LANGS = [...src.LANGUAGES];
  const entries = [];
  const byUrl = new Map();
  const counters = {};
  const warnings = [];
  const add = (group, url, extra = {}) => {
    const u = /^https?:\/\//.test(url) ? url : encPath(url);
    // One entry per URL and method set: OPTIONS on /api/sitemap (G10) is
    // separate from GET/HEAD on it (G5).
    const key = `${u} ${(extra.methods || ['GET', 'HEAD']).join(',')}`;
    if (byUrl.has(key)) { const e = byUrl.get(key); if (!e.also.includes(group) && e.group !== group) e.also.push(group); return null; }
    counters[group] = (counters[group] || 0) + 1;
    const width = group === 'G4' ? 4 : 3;
    const e = { id: `${group}-${String(counters[group]).padStart(width, '0')}`, group, url: u, methods: ['GET', 'HEAD'], expect: null, kind: 'page', profiles: ['gate', 'full'], also: [], ...extra };
    entries.push(e);
    byUrl.set(key, e);
    return e;
  };

  // G1 prerender routes.
  const routes = checkSlugMaps(src);
  for (const r of routes) {
    const lang = r.split('/')[1];
    const kind = r === `/${lang}/${src.SLUGS[lang].blog}` ? 'blog-index' : 'page';
    add('G1', r, { expect: { status: 200 }, kind });
  }
  const g1 = new Set(entries.map((e) => e.url));

  // G2 service_pages: every URL must already be in G1.
  for (const row of o.servicePages) {
    const lang = String(row.language || '').trim().toLowerCase();
    if (!LANGS.includes(lang)) { warnings.push(`service_pages row with unsupported language "${row.language}" skipped`); continue; }
    const p = encPath(row.slug === 'index' ? src.localizedPath(lang, 'services-index') : src.localizedPath(lang, 'service-detail', row.slug));
    assert(g1.has(p), `G2 URL ${p} (service_pages ${lang}/${row.slug}) is not in G1`);
    add('G2', p);
  }

  // G3 content_pages.
  const g3NotInSitemap = [];
  const sitemap = parseSitemap(o.sitemapText);
  assert(!sitemap.error, `sitemap does not parse: ${sitemap.error}`);
  assert(sitemap.root === 'urlset', `sitemap root is ${sitemap.root}, expected urlset`);
  const sitemapPaths = new Set();
  for (const loc of sitemap.entries.keys()) {
    const u = new URL(loc);
    assert(u.origin === PRODUCTION_ORIGIN, `sitemap <loc> outside ${PRODUCTION_ORIGIN}: ${loc}`);
    sitemapPaths.add(`${u.pathname}${u.search}`);
  }
  // Stable order whatever the input order (ids G3-nnn must not depend on it).
  const rowKey = (r) => [r.language, r.slug, r.localized_slug].map((x) => String(x ?? '')).join('\u0000');
  const contentRows = [...o.contentPages].sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
  for (const row of contentRows) {
    const lang = String(row.language || '').trim().toLowerCase();
    if (!LANGS.includes(lang)) { warnings.push(`content_pages row with unsupported language "${row.language}" skipped`); continue; }
    const paths = new Set();
    if (row.slug === 'home') paths.add(src.localizedPath(lang, 'homepage'));
    else if (row.slug === 'blog') paths.add(src.localizedPath(lang, 'blog-index'));
    else {
      paths.add(`/${lang}/${src.localizedContentSlug(lang, row.slug, row.localized_slug || null)}`);
      paths.add(`/${lang}/${row.localized_slug || row.slug}`); // api/sitemap.js:126
    }
    for (const p of paths) {
      const e = add('G3', p, { expect: { status: 200 }, kind: row.slug === 'blog' ? 'blog-index' : 'page' });
      if (e && !sitemapPaths.has(e.url)) g3NotInSitemap.push(e.url);
    }
  }

  // G4 articles from the sitemap: per language, seeded order, first 50 = gate.
  const articles = Object.fromEntries(LANGS.map((l) => [l, []]));
  const otherLocs = [];
  for (const loc of sitemap.entries.keys()) {
    const u = new URL(loc);
    const segs = u.pathname.split('/');
    const lang = segs[1];
    if (LANGS.includes(lang) && segs.length >= 4 && segs[2] === src.SLUGS[lang].blog && segs.slice(3).join('/')) articles[lang].push(loc);
    else if (!byUrl.has(`${u.pathname}${u.search} GET,HEAD`)) otherLocs.push(loc);
  }
  const firstSampled = {};
  const articleCounts = {};
  for (const lang of LANGS) {
    const ordered = sampleOrder(articles[lang], seed);
    articleCounts[lang] = ordered.length;
    if (ordered.length < ARTICLES_PER_LANGUAGE) warnings.push(`G4: ${lang} has only ${ordered.length} articles (< ${ARTICLES_PER_LANGUAGE})`);
    ordered.forEach((loc, i) => {
      const u = new URL(loc);
      if (i === 0) firstSampled[lang] = `${u.pathname}${u.search}`;
      add('G4', `${u.pathname}${u.search}`, { expect: { status: 200 }, kind: 'blog-article', profiles: i < ARTICLES_PER_LANGUAGE ? ['gate', 'full'] : ['full'], sample_rank: i + 1 });
    });
  }
  for (const loc of otherLocs) {
    const u = new URL(loc);
    add('G4', `${u.pathname}${u.search}`, { expect: { status: 200 }, kind: 'page', note: 'sitemap URL outside G1-G3 that is not an article' });
  }
  const g1NotInSitemap = [...g1].filter((p) => !sitemapPaths.has(p));
  if (g1NotInSitemap.length) warnings.push(`G1: ${g1NotInSitemap.length} prerender routes are not in the sitemap: ${g1NotInSitemap.slice(0, 5).join(', ')}`);

  // G5 sitemaps (vercel.json:130-145, api/sitemap.js:401-410).
  const sitemaps = ['/sitemap.xml', '/sitemap-complete.xml', '/sitemap-index.xml', ...LANGS.map((l) => `/sitemap-${l}.xml`), '/api/sitemap'];
  for (const s of sitemaps) add('G5', s, { expect: { status: 200 }, kind: 'sitemap' });
  add('G5', '/sitemap-xx.xml', { expect: { status: 404 }, kind: 'sitemap', note: 'unsupported language (api/sitemap.js:337-339)' });
  add('G5', '/sitemap-enx.xml', { expect: { status: 200 }, kind: 'sitemap', note: 'lang read with /lang=([a-z]{2})/i (api/sitemap.js:334): serves the en blob' });

  // G6 redirects: 25 vercel.json sources (RD-01…RD-25, file order), 3
  // client-only entries (RD-26…RD-28) and 4 client-pattern samples.
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert(vercel.redirects.length === 25, `vercel.json has ${vercel.redirects.length} redirects, expected 25`);
  vercel.redirects.forEach((r, i) => {
    add('G6', r.source, { expect: { status: r.permanent ? 308 : 307, location: r.destination }, kind: 'redirect', ref: `RD-${String(i + 1).padStart(2, '0')}`, ...(/[^\x20-\x7e]/.test(r.source) ? { note: 'non-ASCII source sent as the percent-encoded UTF-8 bytes of the vercel.json string; its baseline status decides the expectation' } : {}) });
  });
  const seoRedirects = readFileSync(path.join(root, 'src/components/SEORedirects.tsx'), 'utf8');
  const clientOnly = [['/csoffert', '/cs/nabidka', 'RD-26'], ['/enoffert', '/en/quote', 'RD-27'], ['/pl/wyko%C5%84czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni', 'RD-28']];
  for (const [s, d, ref] of clientOnly) {
    assert(seoRedirects.includes(`'${s}': '${d}'`), `client redirect ${s} -> ${d} not found in src/components/SEORedirects.tsx`);
    assert(!vercel.redirects.some((r) => r.source === s), `${s} is unexpectedly a vercel.json redirect`);
    add('G6', s, { expect: { status: 200, client_redirect: d }, kind: 'redirect', ref });
  }
  for (const [s, ref] of [['/frdevis', 'RD-P1'], ['/ESorcamento', 'RD-P1'], ['/en/frdevis', 'RD-P2'], ['/de/PLwycena', 'RD-P2']]) {
    add('G6', s, { expect: { status: 200 }, kind: 'redirect', ref, note: 'client regex pattern sample' });
  }

  // G7 soft-404 probes (§7.1), en and fi.
  const en = src.SLUGS.en; const fi = src.SLUGS.fi;
  assert(firstSampled.en && firstSampled.fi, 'G7 S-05 needs at least one sampled en and fi article');
  const probes = [
    ['S-01', '/en/zz-parity-404', '/fi/zz-parity-404'],
    ['S-02', '/en/zz-parity-404/zz', '/fi/zz-parity-404/zz'],
    ['S-03', `/en/${en.services}/zz-parity-404`, `/fi/${fi.services}/zz-parity-404`],
    ['S-04', `/en/${en.blog}/zz-parity-404`, `/fi/${fi.blog}/zz-parity-404`],
    ['S-05', `${firstSampled.en}/zz`, `${firstSampled.fi}/zz`],
    ['S-06', `/en/${en.about}/zz-parity-404`, `/fi/${fi.about}/zz-parity-404`],
    ['S-07', `/en/${en.services}/${en.serviceDetail['cnc-machining']}/zz`, `/fi/${fi.services}/${fi.serviceDetail['cnc-machining']}/zz`],
    ['S-08', '/en/zz/zz/zz', '/fi/zz/zz/zz'],
    ['S-09', `/en/${en.about}.html`, `/fi/${fi.about}.html`],
    ['S-10', `/EN/${en.about}`, `/FI/${fi.about}`],
    ['S-11', '/el/login', '/xx/about'],
  ];
  for (const [ref, a, b] of probes) for (const p of [a, b]) add('G7', p, { expect: { status: 200 }, kind: 'probe', ref });

  // G8 special files (§3.4).
  const { js, css } = shellAssets(o.shellText);
  assert(js && css, 'the shell names no /assets/*.js module script or /assets/*.css stylesheet');
  const special = [
    ['/robots.txt'], ['/robots-ai.txt'], ['/indexnow_key.txt', { secret_body: true, note: 'body is the IndexNow key: never stored or printed, compared by SHA-256 only' }],
    ['/zohoverify/'], ['/zohoverify/index.html'], ['/zohoverify/verifyforzoho.html'], ['/zohoverify/verifyforzoho.txt'],
    ['/laserkritis/'], ['/laserkritis/index.html'],
    ['/occt-import-js.wasm', { methods: ['HEAD'] }], ['/occt-import-js.js'], ['/index.html'], ['/cookie-consent.html'], ['/_redirects'],
    ['/logo.png'], ['/logo2.png'], ['/favicon.ico'], ['/favicon2.ico'], ['/placeholder.svg'],
    [new URL(src.DEFAULT_IMAGE).pathname, { note: 'default og:image (middleware/types.ts:65)' }],
    [js, { note: 'entry module named in the shell' }], [css, { note: 'stylesheet named in the shell' }],
  ];
  for (const [p, extra = {}] of special) add('G8', p, { kind: 'special', ...extra });

  // G9 host and path variants (§3.5).
  const variants = [
    ['/'], ['/EN'], ['/en/'], [`/en/${en.services}/`], [`/en//${en.services}`], [`/en/${en.services}?utm_source=parity`],
    [`/de/${en.services}`], ['/en/index.html'], [`/fi/${fi.services}/index.html`], ['/zohoverify'], ['/laserkritis'],
    ['/zz-parity-404'], ['/services'], ['/reset-password'], ['/deorcamento?utm_source=parity'],
    ['https://micronshub.eu/', { na_preview: 'S13' }], [`https://micronshub.eu/en/${en.services}`, { na_preview: 'S13' }], ['https://micronshub.eu/logo.png', { na_preview: 'S13' }],
    ['https://micronshub.eu/api/marketing?action=track&parity=1', { na_preview: 'S13', methods: ['GET'], note: 'only the apex hop is requested; the hop into /api/* is recorded, never requested' }],
    ['http://www.micronshub.eu/en', { na_preview: 'S13' }], ['http://micronshub.eu/en', { na_preview: 'S13' }],
    ['https://laserkritis.micronshub.eu/en', { na_preview: 'S14' }], ['https://laserkritis.micronshub.eu/', { na_preview: 'S14' }],
    ['https://zz-parity-probe.micronshub.eu/en', { na_preview: 'S14' }],
  ];
  for (const [p, extra = {}] of variants) add('G9', p, { kind: 'variant', ...extra });

  // G10 OPTIONS on /api/*: the endpoints in api/ plus two aliases.
  const apiFiles = readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
  assert(apiFiles.length === 12, `api/ has ${apiFiles.length} endpoint files, expected 12`);
  for (const name of [...apiFiles, 'track', 'connector-status']) add('G10', `/api/${name}`, { methods: ['OPTIONS'], kind: 'api' });

  // Group count assertions (§3.1).
  const count = (g) => entries.filter((e) => e.group === g).length;
  assert(count('G1') === 210, `G1 has ${count('G1')} entries`);
  assert(count('G2') === 0, 'G2 added entries outside G1');
  for (const [g, n] of [['G5', 20], ['G6', 32], ['G7', 22], ['G8', 22], ['G9', 24], ['G10', 14]]) assert(count(g) === n, `${g} has ${count(g)} entries, expected ${n}`);

  const profile = o.profile;
  const selected = entries.filter((e) => entryInProfile(e, profile));
  const perGroup = (list) => Object.fromEntries(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'].map((g) => [g, list.filter((e) => e.group === g).length]));
  const doc = {
    version: 1,
    tool_version: TOOL_VERSION,
    generated_at: (o.now || new Date()).toISOString(),
    seed,
    profile,
    base: o.base || null,
    sources: {
      sitemap_sha256: sha256(o.sitemapText),
      sitemap_source: o.sitemapSource,
      sitemap_locs: sitemap.entries.size,
      sitemap_articles: articleCounts,
      service_pages: o.servicePages.length,
      content_pages: o.contentPages.length,
      shell_sha256: sha256(o.shellText),
      shell_source: o.shellSource,
    },
    counts: { selected: selected.length, per_group: perGroup(selected), all: entries.length, all_per_group: perGroup(entries) },
    checks: {
      g1_unique_paths: 210,
      slug_maps_agree: true,
      g2_in_g1: o.servicePages.length,
      g3_new_not_in_sitemap: g3NotInSitemap,
      g1_not_in_sitemap: g1NotInSitemap,
      sitemap_other_locs: otherLocs.length,
    },
    warnings,
    entries: selected,
  };
  return doc;
}

export function entryInProfile(e, profile) {
  if (!profile || profile === 'full') return true;
  if (profile === 'gate') return !e.profiles || e.profiles.includes('gate');
  const g = { sitemaps: 'G5', redirects: 'G6', variants: 'G9', api: 'G10' }[profile];
  return e.group === g;
}

async function getJson(url, key) {
  const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  if (!r.ok) throw new GeneratorError(`Supabase REST ${new URL(url).pathname} answered ${r.status}`);
  return r.json();
}

/**
 * Read the generator inputs.
 * @param o { base, sitemapFile, shellFile, client (HttpClient for the base), env }
 */
export async function fetchInputs(o) {
  const supabaseUrl = o.env.SUPABASE_URL;
  const key = o.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) throw new GeneratorError('SUPABASE_URL and SUPABASE_ANON_KEY must be set in the environment');
  const rest = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
  const [servicePages, contentPages] = await Promise.all([
    // Ordered, so that G3 entry ids are stable across generations.
    getJson(`${rest}/service_pages?select=language,slug&status=eq.published&order=language.asc,slug.asc`, key),
    getJson(`${rest}/content_pages?select=language,slug,localized_slug&status=eq.published&order=language.asc,slug.asc,localized_slug.asc`, key),
  ]);
  const read = async (file, pathname, label) => {
    if (file) return { text: readFileSync(file, 'utf8'), source: `file:${path.basename(file)}` };
    if (!o.base) throw new GeneratorError(`--base or --${label} is required`);
    const url = `${o.base}${pathname}`;
    const r = await o.client.send(url, 'GET');
    if (r.error) throw new GeneratorError(`${url}: ${r.error}`);
    const res = r.response;
    o.onResponse?.(res);
    if (res.status !== 200) throw new GeneratorError(`${url} answered ${res.status}`);
    return { text: res.body.toString('utf8'), source: `base:${pathname}` };
  };
  const sitemap = await read(o.sitemapFile, '/sitemap-complete.xml', 'sitemap-file');
  const shell = await read(o.shellFile, '/index.html', 'shell-file');
  return { servicePages, contentPages, sitemapText: sitemap.text, sitemapSource: sitemap.source, shellText: shell.text, shellSource: shell.source };
}
