import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadSources } from '../lib/sources.mjs';
import { buildUrlSet, checkSlugMaps, sampleOrder, encPath } from '../lib/urls.mjs';
import { REPO_ROOT } from '../lib/cli.mjs';
import { checkEnd, checkStart, crossedBoundaries, insideStartWindow } from '../lib/window.mjs';
import { extractHtml, normaliseHtmlDocument, parseSitemap } from '../lib/extract.mjs';
import { sha256 } from '../lib/util.mjs';

const src = await loadSources(REPO_ROOT);

/** Fixture sitemap: the 210 G1 routes plus `n` articles per language. */
function fixtureSitemap(n = 60, extra = []) {
  const locs = src.buildPrerenderRoutes().map((p) => `https://www.micronshub.eu${encPath(p)}`);
  for (const lang of src.LANGUAGES) for (let i = 0; i < n; i++) locs.push(`https://www.micronshub.eu/${lang}/${src.SLUGS[lang].blog}/article-${lang}-${i}`);
  locs.push(...extra);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map((l) => `<url><loc>${l}</loc></url>`).join('\n')}\n</urlset>\n`;
}

const SHELL = '<!DOCTYPE html><html><head><script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script><link rel="modulepreload" href="/assets/vendor-react-BBBBBBBB.js"><link rel="stylesheet" href="/assets/index-CCCCCCCC.css"></head><body></body></html>';
const SERVICE_ROWS = src.LANGUAGES.flatMap((l) => ['index', ...src.SERVICE_IDS.filter((s) => s !== 'surface-finishes')].map((slug) => ({ language: l, slug })));
const CONTENT_ROWS = [
  { language: 'en', slug: 'home', localized_slug: 'home' },
  { language: 'cs', slug: 'education', localized_slug: 'vzdelavani' },
  { language: 'de', slug: 'about', localized_slug: null },
  { language: 'fi', slug: 'blog', localized_slug: null },
];

const build = (over = {}) => buildUrlSet({
  root: REPO_ROOT, src, base: 'https://www.micronshub.eu', profile: 'gate', seed: 'micronshub-parity-v1',
  sitemapText: fixtureSitemap(), sitemapSource: 'fixture', shellText: SHELL, shellSource: 'fixture',
  servicePages: SERVICE_ROWS, contentPages: CONTENT_ROWS, ...over,
});

test('G1: 210 unique paths and both SLUGS maps agree', () => {
  const routes = checkSlugMaps(src);
  assert.equal(routes.length, 210);
  assert.equal(new Set(routes).size, 210);
});

test('G1 assertion fails when the two SLUGS maps disagree', () => {
  const broken = { ...src, SLUGS: { ...src.SLUGS, de: { ...src.SLUGS.de, about: 'ueber' } } };
  assert.throws(() => checkSlugMaps(broken), /disagree/);
});

test('generator: group counts, G2 ⊆ G1, G3 new URLs, fixed groups', () => {
  const doc = build();
  const c = doc.counts.per_group;
  assert.deepEqual(c, { G1: 210, G2: 0, G3: 2, G4: 700, G5: 20, G6: 32, G7: 22, G8: 22, G9: 24, G10: 14 });
  assert.equal(doc.entries.length, 1046);
  // de/about without localized_slug: localizedContentSlug() gives /de/ueber-uns (G1), the sitemap rule
  // (localized_slug || slug) gives /de/about; both are kept.
  assert.deepEqual(doc.entries.filter((e) => e.group === 'G3').map((e) => e.url).sort(), ['/cs/vzdelavani', '/de/about']);
  const full = build({ profile: 'full' });
  assert.equal(full.counts.per_group.G4, 14 * 60);
  // The mojibake source RD-12 is sent as the percent-encoded bytes of the vercel.json string.
  const rd12 = doc.entries.find((e) => e.ref === 'RD-12');
  assert.equal(rd12.url, '/pl/wyko%C3%85%C2%84czenie-powierzchni');
  const vercel = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
  assert.equal(decodeURIComponent(rd12.url), vercel.redirects[11].source);
  // G8: shell assets and HEAD-only wasm; G10: OPTIONS only.
  assert.ok(doc.entries.some((e) => e.group === 'G8' && e.url === '/assets/index-AAAAAAAA.js'));
  assert.ok(doc.entries.some((e) => e.group === 'G8' && e.url === '/assets/index-CCCCCCCC.css'));
  assert.deepEqual(doc.entries.find((e) => e.url === '/occt-import-js.wasm').methods, ['HEAD']);
  assert.ok(doc.entries.filter((e) => e.group === 'G10').every((e) => e.methods.join() === 'OPTIONS'));
  assert.ok(doc.entries.some((e) => e.group === 'G10' && e.url === '/api/sitemap'));
  assert.equal(doc.entries.filter((e) => e.na_preview).length, 9);
  // fi probes use the non-ASCII slug, percent-encoded.
  assert.ok(doc.entries.some((e) => e.group === 'G7' && e.url === '/fi/palvelut/cnc-ty%C3%B6st%C3%B6/zz'));
  // No method other than GET/HEAD/OPTIONS anywhere.
  assert.ok(full.entries.every((e) => e.methods.every((m) => ['GET', 'HEAD', 'OPTIONS'].includes(m))));
});

test('generator fails when a service_pages URL is not in G1', () => {
  assert.throws(() => build({ servicePages: [...SERVICE_ROWS, { language: 'en', slug: 'laser-cutting' }] }), /not in G1/);
});

test('G4 sampling is deterministic for a seed and stable when articles are added', () => {
  const a = build().entries.filter((e) => e.group === 'G4').map((e) => e.url);
  const b = build().entries.filter((e) => e.group === 'G4').map((e) => e.url);
  assert.deepEqual(a, b);
  const other = build({ seed: 'another-seed' }).entries.filter((e) => e.group === 'G4').map((e) => e.url);
  assert.notDeepEqual(new Set(a), new Set(other));
  // Order is SHA-256 of seed + "\n" + loc.
  const locs = ['https://www.micronshub.eu/en/blog/x', 'https://www.micronshub.eu/en/blog/y', 'https://www.micronshub.eu/en/blog/z'];
  const expected = [...locs].sort((p, q) => (sha256(`s\n${p}`) < sha256(`s\n${q}`) ? -1 : 1));
  assert.deepEqual(sampleOrder(locs, 's'), expected);
  // Adding articles only changes the sample where a new article ranks into the first 50.
  const added = Array.from({ length: 5 }, (_, i) => `https://www.micronshub.eu/en/blog/added-${i}`);
  const c = build({ sitemapText: fixtureSitemap(60, added) }).entries.filter((e) => e.group === 'G4').map((e) => e.url);
  const enA = a.filter((u) => u.startsWith('/en/'));
  const enC = c.filter((u) => u.startsWith('/en/'));
  const kept = enC.filter((u) => !u.includes('added-'));
  assert.deepEqual(kept, enA.slice(0, kept.length));
  for (const lang of src.LANGUAGES.filter((l) => l !== 'en')) {
    assert.deepEqual(c.filter((u) => u.startsWith(`/${lang}/`)), a.filter((u) => u.startsWith(`/${lang}/`)));
  }
});

test('window: refuse inside 06:55–10:05 UTC, invalid when crossing 06:55, 09:00 or 00:00', () => {
  assert.equal(insideStartWindow(new Date('2026-10-02T06:54:59Z')), false);
  assert.equal(insideStartWindow(new Date('2026-10-02T06:55:00Z')), true);
  assert.equal(insideStartWindow(new Date('2026-10-02T10:04:59Z')), true);
  assert.equal(insideStartWindow(new Date('2026-10-02T10:05:00Z')), false);
  assert.match(checkStart(new Date('2026-10-02T08:00:00Z'), {}).refuse, /refusing/);
  assert.equal(checkStart(new Date('2026-10-02T08:00:00Z'), { PARITY_IGNORE_WINDOW: '1' }).refuse, null);
  assert.deepEqual(crossedBoundaries(new Date('2026-10-02T23:30:00Z'), new Date('2026-10-03T00:30:00Z')), ['2026-10-03T00:00:00.000Z']);
  assert.deepEqual(crossedBoundaries(new Date('2026-10-02T06:00:00Z'), new Date('2026-10-02T09:01:00Z')), ['2026-10-02T06:55:00.000Z', '2026-10-02T09:00:00.000Z']);
  // A run that enters the content-pipeline window is invalid even if it ends before 09:00.
  assert.deepEqual(crossedBoundaries(new Date('2026-10-02T06:54:00Z'), new Date('2026-10-02T08:59:00Z')), ['2026-10-02T06:55:00.000Z']);
  assert.equal(checkEnd(new Date('2026-10-02T06:54:00Z'), new Date('2026-10-02T08:59:00Z'), {}).invalid, true);
  assert.equal(checkEnd(new Date('2026-10-02T05:00:00Z'), new Date('2026-10-02T06:54:59Z'), {}).invalid, false);
  assert.deepEqual(crossedBoundaries(new Date('2026-10-02T10:10:00Z'), new Date('2026-10-02T11:30:00Z')), []);
  assert.equal(checkEnd(new Date('2026-10-02T23:30:00Z'), new Date('2026-10-03T00:30:00Z'), {}).invalid, true);
  assert.equal(checkEnd(new Date('2026-10-02T23:30:00Z'), new Date('2026-10-03T00:30:00Z'), { PARITY_IGNORE_WINDOW: '1' }).invalid, false);
});

test('extraction: titles, hreflang multiset, JSON-LD canonical form, #seo-content, sitemap parse', () => {
  const html = '<html lang="fi"><head><title> A &amp;  B </title><link rel="alternate" hreflang="DE" href="/de"><script type="application/ld+json">{"b":1,"a":[2,1]}</script><script type="application/ld+json">{oops</script><svg><title>icon</title></svg></head><body><article id="seo-content" lang="fi"><p>Hi <b>there</b></p><style>.x{}</style><a href="/x">x</a><img src="/i.png"></article></body></html>';
  const x = extractHtml(html);
  assert.equal(x.F13, 'fi');
  assert.deepEqual(x.F14, ['A & B']);
  assert.deepEqual(x.F17, [['de', '/de']]);
  assert.deepEqual(x.F20, ['jsonld_invalid:{oops', '{"a":[2,1],"b":1}']);
  assert.equal(x.F20_invalid, 1);
  assert.equal(x.F21.lang, 'fi');
  assert.equal(x.F21.length, 'Hi therex'.length);
  assert.deepEqual(x.F22, ['a /x', 'img /i.png']);
  // F23 moves hreflang and JSON-LD to a sorted list after the document (with
  // their container and exact source, JSON-LD keys sorted), keeps the title in place.
  const n = normaliseHtmlDocument(html);
  const [doc, list] = n.split('<!-- seo-parity F23: order-insensitive elements, sorted -->');
  assert.ok(!doc.includes('hreflang') && !doc.includes('ld+json') && doc.includes('<title>'));
  assert.ok(list.includes('head <link rel="alternate" hreflang="DE" href="/de">'), list);
  assert.ok(list.includes('head <script type="application/ld+json">{"a":[2,1],"b":1}</script>'), list);
  assert.ok(list.includes('head <script type="application/ld+json">{oops</script>'), list);
  const sm = parseSitemap('<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://a/x?a=1&amp;b=2</loc><lastmod>2026-01-01</lastmod><xhtml:link rel="alternate" hreflang="EN" href="https://a/x"/></url></urlset>');
  assert.equal(sm.root, 'urlset');
  assert.deepEqual([...sm.entries.keys()], ['https://a/x?a=1&b=2']);
  assert.deepEqual(sm.entries.get('https://a/x?a=1&b=2').alternates, [['en', 'https://a/x']]);
});
