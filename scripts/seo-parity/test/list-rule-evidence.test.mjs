// The blog index article list rule keeps the list's place in the document and
// accepts only articles published since the capture; a live candidate that
// answers from Vercel is never gate evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startSite, tmpDir, writeUrls, writeAllow, run, FIXTURE_ENTRIES, blogArticle as art, blogIndexDoc, blogSitemap, sitemapEntry } from './helpers.mjs';
import { ARTICLE_LIST_MARKER, blogIndexArticleList } from '../lib/extract.mjs';
import { publishedAtCapture } from '../lib/compare.mjs';
import { evidenceCheck } from '../lib/evidence.mjs';
import { BodyStore } from '../lib/snapshot.mjs';
import { publishedKey } from '../lib/volatile.mjs';

const resultOf = (report, id) => report.results.find((x) => x.id === id);
const compareArgs = (dir, name) => ['--out', path.join(dir, name), '--allow', writeAllow(dir), '--recheck-after', '0'];
const page = (body) => ({ headers: { 'x-seo-source': 'db', 'cache-control': 'public, max-age=0, must-revalidate' }, body });

const EN = { id: 'G1-024', group: 'G1', url: '/en/blog', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'blog-index', profiles: ['gate', 'full'] };
const FI = { id: 'G1-178', group: 'G1', url: '/fi/blogi', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'blog-index', profiles: ['gate', 'full'] };
const SM_EN = sitemapEntry('G5-004', '/sitemap-en.xml');
const SM_COMPLETE = sitemapEntry('G5-002', '/sitemap-complete.xml');
const enBase = Array.from({ length: 10 }, (_, i) => art('en', 'blog', `article-${9 - i}`));
const OLDER = Array.from({ length: 5 }, (_, i) => art('en', 'blog', `older-${4 - i}`));
const NEW = art('en', 'blog', 'article-10');

/**
 * Capture `base` routes (the blog index plus the `captured` entries), then
 * compare the blog index alone with a candidate serving `cand` at /en/blog.
 * Returns the run and the entry's result, also in live mode for contrast.
 */
async function snap({ cand, baseRoutes = {}, captured = [SM_EN], entry = EN, baseDoc = { articles: enBase }, live = false }) {
  const base = await startSite({ routes: { [entry.url]: page(blogIndexDoc(baseDoc)), '/sitemap-en.xml': blogSitemap([...enBase, ...OLDER]), ...baseRoutes } });
  const candidate = await startSite({ routes: { [entry.url]: page(blogIndexDoc(cand)) } });
  const dir = tmpDir();
  try {
    let r;
    if (live) r = await run(['--base', base.origin, '--candidate', candidate.origin, '--urls', writeUrls(dir, [entry]), ...compareArgs(dir, 'o')]);
    else {
      const A = path.join(dir, 'A');
      const c = await run(['--capture', '--base', base.origin, '--urls', writeUrls(dir, [entry, ...captured]), '--snapshot', A]);
      assert.equal(c.code, 0, c.err);
      r = await run(['--snapshot', A, '--candidate', candidate.origin, '--urls', writeUrls(dir, [entry]), ...compareArgs(dir, 'o')]);
    }
    return { ...r, res: resultOf(r.report, entry.id) };
  } finally { await base.close(); await candidate.close(); }
}

const expectNotApplied = (r, name, reason) => {
  assert.equal(r.code, 1, `${name}: ${JSON.stringify(r.res)}`);
  assert.equal(r.res.outcome, 'fail', name);
  assert.equal(r.res.volatile?.length, 1, name);
  assert.equal(r.res.volatile[0].applied, false, name);
  if (reason) assert.match(r.res.volatile[0].reason, reason, name);
  assert.deepEqual(r.report.new_urls, [], name);
};

// ======================================================= the list keeps its place

test('snapshot mode, blog index: the list moved inside #seo-content fails, with or without a new article', async () => {
  const withNew = [NEW, ...enBase.slice(0, 9)];
  const cases = {
    'moved after the site nav, no new article': [{ articles: enBase, layout: 'after-nav' }, /^the article list is unchanged; the differences are outside it$/],
    'moved before the h1, no new article': [{ articles: enBase, layout: 'before-h1' }, /^the article list is unchanged; the differences are outside it$/],
    'moved after the site nav, one new article': [{ articles: withNew, layout: 'after-nav' }, /^the document outside the article list differs \(F23\)$/],
    'moved before the h1, one new article': [{ articles: withNew, layout: 'before-h1' }, /^the document outside the article list differs \(F23\)$/],
  };
  for (const [name, [cand, reason]] of Object.entries(cases)) {
    const r = await snap({ cand });
    expectNotApplied(r, name, reason);
    const fields = [...new Set(r.res.diffs.map((d) => d.field))];
    assert.ok(fields.includes('F23'), `${name}: ${fields.join()}`);
  }
  // Live mode fails the same moves (as before).
  const live = await snap({ cand: { articles: enBase, layout: 'after-nav' }, live: true });
  assert.equal(live.code, 1);
  assert.equal(live.res.volatile, undefined);
});

test('snapshot mode, blog index: list items must be adjacent siblings (only whitespace between them)', async () => {
  const withNew = [NEW, ...enBase.slice(0, 9)];
  const cases = {
    'a rule between two items': ['\n    <hr>\n', /candidate: list items 1 and 2 are not adjacent/],
    'text between two items': ['\n    | \n', /candidate: list items 1 and 2 are not adjacent/],
    'a comment between two items': ['\n    <!-- x -->\n', /candidate: list items 1 and 2 are not adjacent/],
    'the list split over two sections': ['\n  </section>\n  <section>\n', /candidate: list item 2 has another parent than list item 1/],
  };
  for (const [name, [separator, reason]] of Object.entries(cases)) {
    const r = await snap({ cand: { articles: withNew, separator } });
    expectNotApplied(r, name, reason);
  }
  // Whitespace between items, however much, is still one list.
  const ok = await snap({ cand: { articles: withNew, separator: '\n\n\t \n' } });
  assert.equal(ok.code, 0, JSON.stringify(ok.res));
  assert.deepEqual(ok.res.volatile[0].added, ['https://www.micronshub.eu/en/blog/article-10']);
});

test('article list span (unit): one marker where the list was, list errors', () => {
  const at = (layout) => blogIndexArticleList(blogIndexDoc({ articles: enBase, layout }));
  const reduced = at('section').reduced;
  assert.equal(reduced.split(ARTICLE_LIST_MARKER).length, 2, 'exactly one marker');
  assert.ok(reduced.includes(`  <section>\n    ${ARTICLE_LIST_MARKER}\n  </section>`), 'the marker stands where the list was');
  assert.notEqual(at('after-nav').reduced, reduced);
  assert.notEqual(at('before-h1').reduced, reduced);
  assert.equal(blogIndexArticleList(blogIndexDoc({ articles: [] })).error, 'no article list items');
  assert.equal(blogIndexArticleList(blogIndexDoc({ articles: enBase, h1: ARTICLE_LIST_MARKER })).error, 'the document already contains the article list marker');
});

// ======================================================= only articles published since the capture

test('snapshot mode, blog index: articles the base sitemap already lists are not "published since the capture"', async () => {
  const cases = {
    'the five older articles first': [{ articles: [...OLDER, ...enBase.slice(0, 5)] }, /^article list: item 1 \(https:\/\/www\.micronshub\.eu\/en\/blog\/older-4\) was already published when the base was captured \(listed in \/sitemap-en\.xml\)$/],
    'one older article first, base list continues': [{ articles: [OLDER[2], ...enBase.slice(0, 9)] }, /^article list: item 1 \(.*\/en\/blog\/older-2\) was already published/],
    'a new article, then an older one': [{ articles: [NEW, OLDER[0], ...enBase.slice(0, 8)] }, /^article list: item 2 \(.*\/en\/blog\/older-4\) was already published/],
  };
  for (const [name, [cand, reason]] of Object.entries(cases)) expectNotApplied(await snap({ cand }), name, reason);
  // The same with a new article only passes, and the new URL is listed.
  const ok = await snap({ cand: { articles: [NEW, ...enBase.slice(0, 9)] } });
  assert.equal(ok.code, 0, JSON.stringify(ok.res));
  assert.deepEqual(ok.report.new_urls, ['https://www.micronshub.eu/en/blog/article-10']);
});

test('snapshot mode, blog index: without a usable base sitemap, or with one that misses a base article, the rule does not apply', async () => {
  const cand = { articles: [NEW, ...enBase.slice(0, 9)] };
  const none = /^article list: the base snapshot holds no usable sitemap record \(\/sitemap-en\.xml, \/sitemap-complete\.xml, \/api\/sitemap: final response 200 with a urlset\)/;
  expectNotApplied(await snap({ cand, captured: [] }), 'no sitemap captured', none);
  expectNotApplied(await snap({ cand, baseRoutes: { '/sitemap-en.xml': { status: 404, headers: { 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>' } } }), 'sitemap 404', none);
  expectNotApplied(await snap({ cand, baseRoutes: { '/sitemap-en.xml': { headers: { 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>' } } }), 'sitemap index, not a urlset', none);
  expectNotApplied(await snap({ cand, baseRoutes: { '/sitemap-en.xml': blogSitemap(enBase.slice(1)) } }), 'stale sitemap',
    /^article list: the base snapshot's sitemaps \(\/sitemap-en\.xml\) do not list base article https:\/\/www\.micronshub\.eu\/en\/blog\/article-9, so they cannot tell/);
});

test('snapshot mode, blog index: /sitemap-complete.xml is enough; non-ASCII slugs match however the <loc> escapes them; the base URL set counts too', async () => {
  const fiBase = Array.from({ length: 10 }, (_, i) => art('fi', 'blogi', `artikkeli-${9 - i}`));
  const older = art('fi', 'blogi', 'työstö-vanha');
  const fresh = art('fi', 'blogi', 'cnc-työstö-uutuus');
  const lower = (s) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
  const go = (articles, extra = {}) => snap({
    entry: FI, baseDoc: { lang: 'fi', blog: 'blogi', articles: fiBase }, cand: { lang: 'fi', blog: 'blogi', articles },
    captured: [SM_COMPLETE], baseRoutes: { '/sitemap-complete.xml': blogSitemap([...fiBase, older], lower) }, ...extra,
  });
  expectNotApplied(await go([older, ...fiBase.slice(0, 9)]), 'older article, <loc> in lowercase escapes',
    /^article list: item 1 \(https:\/\/www\.micronshub\.eu\/fi\/blogi\/ty%C3%B6st%C3%B6-vanha\) was already published when the base was captured \(listed in \/sitemap-complete\.xml\)$/);
  const ok = await go([fresh, ...fiBase.slice(0, 9)]);
  assert.equal(ok.code, 0, JSON.stringify(ok.res));
  assert.deepEqual(ok.report.new_urls, [`https://www.micronshub.eu${new URL('/fi/blogi/cnc-työstö-uutuus', 'https://x').pathname}`]);
  // An article in the base URL set (a G4 entry) but not in the sitemap was published too.
  const g4 = { id: 'G4-001', group: 'G4', url: '/fi/blogi/kuukausi-sitten', methods: ['GET'], expect: { status: 200 }, kind: 'article', profiles: ['gate', 'full'] };
  const known = art('fi', 'blogi', 'kuukausi-sitten');
  expectNotApplied(await go([known, ...fiBase.slice(0, 9)], { captured: [SM_COMPLETE, g4] }), 'article in the base URL set',
    /item 1 \(.*\/fi\/blogi\/kuukausi-sitten\) was already published when the base was captured \(listed in the base URL set\)$/);
});

test('published at capture (unit): sitemap records of the whole snapshot, 200 urlsets only, cached per language', () => {
  const store = new BodyStore(null);
  const xml = (locs) => Buffer.from(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`);
  const rec = (url, body, status = 200, family = 'xml') => [url, { url, methods: { GET: { hops: [{ status, extracted: { family }, body_sha256: store.put(body, 'xml') }] } } }];
  const w = 'https://www.micronshub.eu';
  const records = new Map([
    rec('/sitemap-en.xml', xml([`${w}/en/blog/a`])),
    rec('/sitemap-complete.xml', xml([`${w}/en/blog/b`, `${w}/fi/blogi/c`])),
    rec('/sitemap-fi.xml', xml([`${w}/fi/blogi/d`]), 404),
    rec('/sitemap-de.xml', Buffer.from('not xml')),
  ].map(([u, r], i) => [`G5-${i}`, r]));
  const ctx = { bodies: { base: store }, baseCapture: { records, urls: { entries: [{ url: '/en/blog/e' }] } } };
  const en = publishedAtCapture(ctx, 'en');
  assert.equal(en.source, '/sitemap-en.xml, /sitemap-complete.xml');
  assert.equal(en.where(publishedKey(`${w}/en/blog/a`)), '/sitemap-en.xml');
  assert.equal(en.where(publishedKey(`${w}/en/blog/b`)), '/sitemap-complete.xml');
  assert.equal(en.where(publishedKey(`${w}/en/blog/e`)), 'the base URL set');
  assert.equal(en.sitemapHas(publishedKey(`${w}/en/blog/e`)), false);
  assert.equal(en.where(publishedKey(`${w}/en/blog/new`)), null);
  assert.equal(publishedAtCapture(ctx, 'en'), en, 'cached');
  const fi = publishedAtCapture(ctx, 'fi');
  assert.equal(fi.source, '/sitemap-complete.xml', 'the 404 record is not used');
  assert.equal(fi.where(publishedKey(`${w}/fi/blogi/d`)), null);
  assert.match(publishedAtCapture({ bodies: { base: store }, baseCapture: { records: new Map([rec('/sitemap-de.xml', Buffer.from('<x'))].map(([, r]) => ['G5-9', r])), urls: { entries: [] } } }, 'de').error, /holds no usable sitemap record/);
  assert.match(publishedAtCapture({ bodies: { base: store }, baseCapture: null }, 'en').error, /holds no usable sitemap record/);
  // One key however a link or <loc> escapes the path.
  assert.equal(publishedKey(`${w}/fi/blogi/työ`), `${w}/fi/blogi/ty%C3%B6`);
  assert.equal(publishedKey(`${w}/fi/blogi/ty%c3%b6`), `${w}/fi/blogi/ty%C3%B6`);
  assert.equal(publishedKey('/fi/blogi/ty%C3%B6'), `${w}/fi/blogi/ty%C3%B6`);
  assert.equal(publishedKey('http://['), null);
});

// ======================================================= Vercel candidates are not gate evidence

test('live candidate that answers from Vercel: not gate evidence (one server under two host names, or two Vercel origins)', async () => {
  const site = await startSite({ extraHeader: ['x-vercel-id', 'fra1::abc'] });
  const other = await startSite({ extraHeader: ['x-vercel-id', 'fra1::def'] });
  const dir = tmpDir();
  try {
    for (const [name, candidate] of [['127.0.0.1 and localhost', site.origin.replace('127.0.0.1', 'localhost')], ['two Vercel origins', other.origin]]) {
      const r = await run(['--base', site.origin, '--candidate', candidate, '--urls', writeUrls(dir), ...compareArgs(dir, name.replace(/\W+/g, '-'))]);
      assert.equal(r.code, 0, `${name}: ${r.err}`);
      assert.equal(r.report.signable, false, name);
      assert.equal(r.report.self_diff, null, name);
      assert.deepEqual(r.report.platforms, { base: ['vercel'], candidate: ['vercel'] }, name);
      assert.ok(r.report.unsignable_reasons.includes('the candidate answers from Vercel (vercel): every SEO_PARITY.md §1 candidate is a Cloudflare deployment; not gate evidence'), `${name}: ${r.report.unsignable_reasons.join(' | ')}`);
      assert.match(r.report.evidence_banners[0], /^VERCEL CANDIDATE: .* The base answers from Vercel too, so this may be one deployment under two host names .*NOT gate evidence, NOT SIGNABLE\.$/, name);
      assert.match(r.err, /!!! VERCEL CANDIDATE/, name);
    }
  } finally { await site.close(); await other.close(); }
});

test('Vercel base with a Cloudflare candidate (the §1 shape) stays signable apart from the window override; a snapshot vs a Vercel candidate is flagged', async () => {
  const vercel = await startSite({ extraHeader: ['x-vercel-id', 'fra1::abc'] });
  const cf = await startSite({ extraHeader: ['cf-ray', '8c0ffee-FRA'] });
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const ok = await run(['--base', vercel.origin, '--candidate', cf.origin, '--urls', writeUrls(dir), ...compareArgs(dir, 'ok')]);
    assert.deepEqual(ok.report.unsignable_reasons, ['PARITY_IGNORE_WINDOW=1']);
    assert.deepEqual(ok.report.evidence_banners, []);
    // A Cloudflare capture (S17 reference) against a live origin that answers from Vercel.
    const A = path.join(dir, 'A');
    assert.equal((await run(['--capture', '--base', cf.origin, '--urls', writeUrls(dir, entries), '--snapshot', A])).code, 0);
    const r = await run(['--snapshot', A, '--candidate', vercel.origin, ...compareArgs(dir, 'snap')]);
    assert.equal(r.report.signable, false);
    assert.deepEqual(r.report.platforms, { base: ['cloudflare'], candidate: ['vercel'] });
    assert.ok(r.report.unsignable_reasons.some((x) => /^the candidate answers from Vercel/.test(x)), r.report.unsignable_reasons.join(' | '));
    assert.ok(!/two host names/.test(r.report.evidence_banners.join(' ')), 'the base is not Vercel');
  } finally { await vercel.close(); await cf.close(); }
});

test('evidence (unit): a Vercel-only live candidate is flagged in live modes; a partly Cloudflare one, or a stored candidate, is not', () => {
  const check = (mode, base, candidate) => evidenceCheck({ mode, baseOrigin: 'https://a.example', candOrigin: 'https://b.example', baseDir: '/nonexistent/a', candDir: '/nonexistent/b', platforms: { base, candidate } });
  const flagged = (e) => e.reasons.some((x) => /^the candidate answers from Vercel/.test(x));
  for (const mode of ['live-vs-live', 'snapshot-vs-live']) {
    assert.equal(flagged(check(mode, ['vercel'], ['vercel'])), true, mode);
    assert.equal(flagged(check(mode, ['cloudflare'], ['vercel'])), true, mode);
    assert.equal(flagged(check(mode, ['unknown'], ['unknown', 'vercel'])), true, mode);
    assert.equal(flagged(check(mode, ['vercel'], ['cloudflare', 'vercel'])), false, mode);
    assert.equal(flagged(check(mode, ['vercel'], ['cloudflare'])), false, mode);
    assert.equal(flagged(check(mode, ['vercel'], ['unknown'])), false, mode);
  }
  assert.equal(flagged(check('snapshot-vs-snapshot', ['vercel'], ['vercel'])), false, 'already never signable');
  // The same-origin Vercel self-diff keeps its own reason only.
  const self = evidenceCheck({ mode: 'snapshot-vs-live', baseOrigin: 'https://www.micronshub.eu', candOrigin: 'https://www.micronshub.eu', platforms: { base: ['vercel'], candidate: ['vercel'] } });
  assert.equal(self.selfDiff.kind, 'same-origin-same-platform');
  assert.equal(self.reasons.length, 1);
});
