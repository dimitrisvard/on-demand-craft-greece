// Gate evidence (self-diffs), the snapshot-mode blog index article list, the
// prerender tag-script rule and the package test script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startSite, tmpDir, writeUrls, writeAllow, run, diffsOf, FIXTURE_ENTRIES, blogArticle, blogIndexDoc, blogSitemap, sitemapEntry } from './helpers.mjs';
import { TOOL_VERSION } from '../lib/constants.mjs';
import { evidenceCheck, hopPlatform } from '../lib/evidence.mjs';
import * as volatileLib from '../lib/volatile.mjs';
import { blogIndexArticleList, extractForHop, normaliseHtmlDocument } from '../lib/extract.mjs';
import { loadSources } from '../lib/sources.mjs';
import { buildUrlSet, encPath } from '../lib/urls.mjs';
import { REPO_ROOT } from '../lib/cli.mjs';
import { sha256 } from '../lib/util.mjs';

const fields = (report, id) => diffsOf(report, id).map((d) => d.field + (d.sub ? `:${d.sub}` : ''));
const fieldIds = (report, id) => [...new Set(diffsOf(report, id).map((d) => d.field))];
const resultOf = (report, id) => report.results.find((x) => x.id === id);
const md = (dir) => readFileSync(path.join(dir, 'report.md'), 'utf8');

async function capture(site, dir, name, entries) {
  const snap = path.join(dir, name);
  const r = await run(['--capture', '--base', site.origin, '--urls', writeUrls(dir, entries), '--snapshot', snap]);
  assert.equal(r.code, 0, r.err);
  return snap;
}

const compareArgs = (dir, name) => ['--out', path.join(dir, name), '--allow', writeAllow(dir), '--recheck-after', '0'];

// ======================================================= 1. gate evidence

test('live vs live with the same origin: the run executes but is a self-diff, never signable', async () => {
  const site = await startSite();
  const dir = tmpDir();
  try {
    const r = await run(['--base', site.origin, '--candidate', site.origin, '--urls', writeUrls(dir), ...compareArgs(dir, 'o')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.report.summary.pass, FIXTURE_ENTRIES.length);
    assert.equal(r.report.signable, false);
    assert.equal(r.report.self_diff.kind, 'same-origin');
    assert.match(r.report.unsignable_reasons[0], /^self-diff \(same-origin\): base and candidate are the same origin http:\/\/127\.0\.0\.1:\d+; not gate evidence$/);
    assert.match(md(path.join(dir, 'o')), /> \*\*SELF-DIFF \(same-origin\): .*NOT gate evidence, NOT SIGNABLE/);
    assert.match(r.err, /!!! SELF-DIFF \(same-origin\)/);
  } finally { await site.close(); }
});

test('live vs live with two origins: no self-diff, no evidence reason', async () => {
  const a = await startSite();
  const b = await startSite();
  const dir = tmpDir();
  try {
    const r = await run(['--base', a.origin, '--candidate', b.origin, '--urls', writeUrls(dir), ...compareArgs(dir, 'o')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.report.self_diff, null);
    assert.deepEqual(r.report.unsignable_reasons, ['PARITY_IGNORE_WINDOW=1']);
    assert.deepEqual(r.report.evidence_banners, []);
  } finally { await a.close(); await b.close(); }
});

test('snapshot vs snapshot: same directory or a copy is a self-diff; two captures are a noise-floor run; none is signable', async () => {
  const site = await startSite();
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const A = await capture(site, dir, 'A', entries);
    const B = await capture(site, dir, 'B', entries);
    const copy = path.join(dir, 'A-copy');
    cpSync(A, copy, { recursive: true });

    const same = await run(['--snapshot', A, '--candidate', `snapshot:${A}`, ...compareArgs(dir, 'same')]);
    assert.equal(same.code, 0, same.err);
    assert.equal(same.report.signable, false);
    assert.equal(same.report.self_diff.kind, 'same-snapshot');
    assert.match(md(path.join(dir, 'same')), /SELF-DIFF \(same-snapshot\)/);
    // The same directory written another way is still the same directory.
    const sameOther = await run(['--snapshot', A, '--candidate', `snapshot:${path.join(A, '..', 'A')}/`, ...compareArgs(dir, 'same2')]);
    assert.equal(sameOther.report.self_diff.kind, 'same-snapshot');

    const copied = await run(['--snapshot', A, '--candidate', `snapshot:${copy}`, ...compareArgs(dir, 'copy')]);
    assert.equal(copied.report.self_diff.kind, 'same-capture');
    assert.equal(copied.report.signable, false);

    const noise = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, ...compareArgs(dir, 'noise')]);
    assert.equal(noise.code, 0, noise.err);
    assert.equal(noise.report.self_diff, null);
    assert.equal(noise.report.signable, false);
    assert.ok(noise.report.unsignable_reasons.some((x) => /^snapshot vs snapshot: no deployment under test \(noise-floor run, SEO_PARITY\.md §4 B6; not gate evidence\)$/.test(x)), noise.report.unsignable_reasons.join(' | '));
    assert.match(md(path.join(dir, 'noise')), /> \*\*Snapshot vs snapshot: two stored captures, no deployment under test .*NOT SIGNABLE\.\*\*/);
  } finally { await site.close(); }
});

test('snapshot vs live, same origin: same platform is a self-diff; another platform (the Phase 3 flip) is not', async () => {
  // One server whose platform header is switched after the capture, so that
  // the snapshot origin and the live candidate origin are the same.
  const opts = { extraHeader: ['x-vercel-id', 'fra1::abc'] };
  const site = await startSite(opts);
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const A = await capture(site, dir, 'A', entries);
    const before = await run(['--snapshot', A, '--candidate', site.origin, ...compareArgs(dir, 'before')]);
    assert.equal(before.code, 0, before.err);
    assert.equal(before.report.self_diff.kind, 'same-origin-same-platform');
    assert.deepEqual(before.report.platforms, { base: ['vercel'], candidate: ['vercel'] });
    assert.equal(before.report.signable, false);

    // A Vercel capture against Vercel stays a self-diff even with --changed-since-capture:
    // no §1 stage compares Vercel with its own capture (the flag is for one platform after S17).
    const claimed = await run(['--snapshot', A, '--candidate', site.origin, '--changed-since-capture', 'redeployed', ...compareArgs(dir, 'claimed')]);
    assert.equal(claimed.report.self_diff.kind, 'same-origin-same-platform');
    assert.equal(claimed.report.signable, false);
    assert.match(claimed.report.evidence_banners[0], /^SELF-DIFF \(same-origin-same-platform\)/);
    assert.ok(claimed.report.evidence_banners.some((b) => /^--changed-since-capture does not apply/.test(b)), claimed.report.evidence_banners.join(' | '));

    opts.extraHeader = ['cf-ray', '8c0ffee-FRA'];
    const after = await run(['--snapshot', A, '--candidate', site.origin, ...compareArgs(dir, 'after')]);
    assert.equal(after.code, 0, after.err);
    assert.equal(after.report.self_diff, null);
    assert.deepEqual(after.report.platforms, { base: ['vercel'], candidate: ['cloudflare'] });
    assert.ok(!after.report.unsignable_reasons.some((x) => /self-diff|snapshot vs snapshot|same origin/.test(x)), after.report.unsignable_reasons.join(' | '));
  } finally { await site.close(); }
});

test('snapshot vs live, same origin, Cloudflare on both sides (S17 reference, PLAN.md P7-8): not called a self-diff; signable only with --changed-since-capture', async () => {
  const opts = { extraHeader: ['cf-ray', '8c0ffee-FRA'], title: 'Before the backend switch' };
  const site = await startSite(opts);
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const A = await capture(site, dir, 'A', entries);
    opts.title = 'After the backend switch';
    const r = await run(['--snapshot', A, '--candidate', site.origin, ...compareArgs(dir, 'o')]);
    assert.equal(r.code, 1, 'the changed title is still reported');
    assert.equal(r.report.self_diff, null);
    assert.deepEqual(r.report.platforms, { base: ['cloudflare'], candidate: ['cloudflare'] });
    assert.equal(r.report.signable, false);
    assert.equal(r.report.changed_since_capture, null);
    const reason = r.report.unsignable_reasons.find((x) => /same origin/.test(x));
    assert.match(reason ?? '', /^same origin and platform as the capture \(cloudflare\): the tool cannot tell another deployment from the captured one; not gate evidence unless --changed-since-capture states what changed$/);
    assert.ok(!r.report.evidence_banners.some((b) => /SELF-DIFF|compares a site with itself/.test(b)), r.report.evidence_banners.join(' | '));
    assert.match(md(path.join(dir, 'o')), /> \*\*SAME ORIGIN AND PLATFORM AS THE CAPTURE \(cloudflare\): .*NOT SIGNABLE/);

    const note = 'SEO handler data backend switched to D1 (P7-8)';
    const ack = await run(['--snapshot', A, '--candidate', site.origin, '--changed-since-capture', note, ...compareArgs(dir, 'ack')]);
    assert.equal(ack.code, 1);
    assert.equal(ack.report.self_diff, null);
    assert.equal(ack.report.changed_since_capture, note);
    assert.ok(!ack.report.unsignable_reasons.some((x) => /same origin|self-diff/.test(x)), ack.report.unsignable_reasons.join(' | '));
    assert.match(md(path.join(dir, 'ack')), /Changed since the capture \(--changed-since-capture\): SEO handler data backend switched to D1 \(P7-8\)/);
  } finally { await site.close(); }
});

test('--changed-since-capture: snapshot vs live only, and not empty', async () => {
  const a = await startSite();
  const b = await startSite();
  const dir = tmpDir();
  try {
    const live = await run(['--base', a.origin, '--candidate', b.origin, '--urls', writeUrls(dir), '--changed-since-capture', 'x', ...compareArgs(dir, 'o')]);
    assert.equal(live.code, 2);
    assert.match(live.err, /--changed-since-capture applies only to snapshot vs live/);
    const A = await capture(a, dir, 'A', FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001'));
    const empty = await run(['--snapshot', A, '--candidate', b.origin, '--changed-since-capture', '  ', ...compareArgs(dir, 'e')]);
    assert.equal(empty.code, 2);
    assert.match(empty.err, /--changed-since-capture needs a description/);
  } finally { await a.close(); await b.close(); }
});

test('snapshot vs snapshot of two different origins: not gate evidence, and not described as the B6 noise-floor run', async () => {
  const a = await startSite({ extraHeader: ['x-vercel-id', 'fra1::a'] });
  const b = await startSite({ extraHeader: ['cf-ray', '8c0ffee-FRA'] });
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const A = await capture(a, dir, 'A', entries);
    const B = await capture(b, dir, 'B', entries);
    const r = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, ...compareArgs(dir, 'o')]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.report.self_diff, null);
    assert.equal(r.report.signable, false);
    const all = [...r.report.unsignable_reasons, ...r.report.evidence_banners].join(' | ');
    assert.ok(!/B6|noise-floor/.test(all), all);
    assert.ok(r.report.unsignable_reasons.includes(`snapshot vs snapshot of two origins (${a.origin} and ${b.origin}): two stored captures, no deployment under test; not gate evidence`), all);
    assert.match(md(path.join(dir, 'o')), /> \*\*Snapshot vs snapshot of two origins \(.*\): two stored captures, no deployment under test\. NOT gate evidence, NOT SIGNABLE\.\*\*/);
  } finally { await a.close(); await b.close(); }
});

test('platform of a response: cf-ray wins, then x-vercel-id or server: Vercel', () => {
  assert.equal(hopPlatform({ headers: { 'cf-ray': '1-FRA', 'x-vercel-id': 'x' } }), 'cloudflare');
  assert.equal(hopPlatform({ headers: { server: 'Vercel' } }), 'vercel');
  assert.equal(hopPlatform({ headers: { 'x-vercel-id': 'fra1::x' } }), 'vercel');
  assert.equal(hopPlatform({ headers: {} }), 'unknown');
  const www = 'https://www.micronshub.eu';
  const same = (base, candidate, extra = {}) => evidenceCheck({ mode: 'snapshot-vs-live', baseOrigin: www, candOrigin: www, platforms: { base, candidate }, ...extra });
  assert.equal(same(['vercel'], ['cloudflare', 'vercel']).selfDiff, null, 'a candidate that is partly Cloudflare is not a self-diff');
  assert.deepEqual(same(['vercel'], ['cloudflare', 'vercel']).reasons, []);
  assert.equal(evidenceCheck({ mode: 'snapshot-vs-live', baseOrigin: 'https://a.example', candOrigin: 'https://b.example', platforms: { base: ['vercel'], candidate: ['vercel'] } }).selfDiff, null);
  assert.equal(same(['vercel'], ['vercel']).selfDiff.kind, 'same-origin-same-platform');
  assert.equal(same(['vercel'], ['vercel'], { changedSinceCapture: 'x' }).selfDiff.kind, 'same-origin-same-platform');
  for (const p of [['cloudflare'], ['unknown'], []]) {
    const e = same(p, p);
    assert.equal(e.selfDiff, null, p.join());
    assert.equal(e.reasons.length, 1, p.join());
    assert.deepEqual(same(p, p, { changedSinceCapture: 'D1 switch' }).reasons, [], p.join());
  }
  const snap = (b, c, bo = www, co = www) => evidenceCheck({ mode: 'snapshot-vs-snapshot', baseOrigin: bo, candOrigin: co, baseDir: b, candDir: c, platforms: { base: [], candidate: [] } });
  assert.match(snap('/nonexistent/a', '/nonexistent/b').reasons[0], /noise-floor run, SEO_PARITY\.md §4 B6/);
  assert.match(snap('/nonexistent/a', '/nonexistent/b', www, 'https://x.example').reasons[0], /^snapshot vs snapshot of two origins/);
});

// ======================================================= 2. blog index article list (snapshot mode)

const art = blogArticle;
const BASE_ARTICLES = (lang, blog) => Array.from({ length: 10 }, (_, i) => art(lang, blog, `article-${9 - i}`));

const page = (body) => ({ headers: { 'x-seo-source': 'none', 'cache-control': 'public, max-age=0, must-revalidate' }, body });
const BLOG_ENTRIES = [
  { id: 'G1-024', group: 'G1', url: '/en/blog', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'blog-index', profiles: ['gate', 'full'] },
  { id: 'G1-178', group: 'G1', url: '/fi/blogi', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'blog-index', profiles: ['gate', 'full'] },
];
// The base capture also holds the per-language sitemaps (G5): they show which
// articles were already published at capture time.
const SITEMAP_ENTRIES = [sitemapEntry('G5-004', '/sitemap-en.xml'), sitemapEntry('G5-014', '/sitemap-fi.xml')];
const enBase = BASE_ARTICLES('en', 'blog');
const fiBase = BASE_ARTICLES('fi', 'blogi');
const OLDER_EN = Array.from({ length: 5 }, (_, i) => art('en', 'blog', `older-${i}`));
const OLDER_FI = [art('fi', 'blogi', 'työstö-vanha')];
const NEW_EN = art('en', 'blog', 'article-10');
const NEW_FI = art('fi', 'blogi', 'cnc-työstö-uutuus', 'CNC-työstö: uutuus');
const blogRoutes = (en, fi = { articles: fiBase }) => ({
  '/en/blog': page(blogIndexDoc({ articles: enBase, ...en })),
  '/fi/blogi': page(blogIndexDoc({ lang: 'fi', blog: 'blogi', ...fi })),
  '/sitemap-en.xml': blogSitemap([...enBase, ...OLDER_EN]),
  '/sitemap-fi.xml': blogSitemap([...fiBase, ...OLDER_FI]),
});

/** Live: compare `entries`. Snapshot: capture `entries` and `sitemaps`, then compare `entries` only. */
async function blogRun(candEn, candFi, { live = false, entries = BLOG_ENTRIES, baseRoutes = blogRoutes({}), sitemaps = SITEMAP_ENTRIES } = {}) {
  const base = await startSite({ routes: baseRoutes });
  const cand = await startSite({ routes: blogRoutes(candEn, candFi) });
  const dir = tmpDir();
  try {
    if (live) return { ...await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), ...compareArgs(dir, 'o')]), out: path.join(dir, 'o') };
    const A = await capture(base, dir, 'A', [...entries, ...sitemaps]);
    return { ...await run(['--snapshot', A, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), ...compareArgs(dir, 'o')]), out: path.join(dir, 'o') };
  } finally { await base.close(); await cand.close(); }
}

test('snapshot mode, blog index: new articles first and the oldest dropped off the end → pass, new URLs listed', async () => {
  const r = await blogRun({ articles: [NEW_EN, ...enBase.slice(0, 9)] }, { articles: [NEW_FI, ...fiBase.slice(0, 9)] });
  assert.equal(r.code, 0, JSON.stringify(r.report?.results, null, 1));
  for (const id of ['G1-024', 'G1-178']) assert.equal(resultOf(r.report, id).outcome, 'pass');
  const v = resultOf(r.report, 'G1-024').volatile[0];
  assert.equal(v.rule, 'blog-index-article-list');
  assert.deepEqual(v.added, ['https://www.micronshub.eu/en/blog/article-10']);
  assert.deepEqual(v.dropped, ['https://www.micronshub.eu/en/blog/article-0']);
  assert.deepEqual([...v.fields].sort(), ['F20', 'F21', 'F22', 'F23']);
  assert.deepEqual(r.report.new_urls.sort(), ['https://www.micronshub.eu/en/blog/article-10', `https://www.micronshub.eu${encPath('/fi/blogi/cnc-työstö-uutuus')}`].sort());
  assert.match(md(r.out), /## Volatile rules applied \(§2\.4\)\n[^]*\| G1-024 \| \/en\/blog \| blog-index-article-list \| F2\d.*1 new article listed first, 1 dropped off the end \|/);
});

test('snapshot mode, blog index: two new articles, list not yet at the cap (base ⊆ candidate) → pass', async () => {
  const r = await blogRun({ articles: [art('en', 'blog', 'n2'), art('en', 'blog', 'n1'), ...enBase] }, undefined, { entries: [BLOG_ENTRIES[0]] });
  assert.equal(r.code, 0, JSON.stringify(r.report?.results, null, 1));
  assert.deepEqual(resultOf(r.report, 'G1-024').volatile[0].dropped, []);
});

test('blog index, same change in live mode → fail (live stays exact)', async () => {
  const r = await blogRun({ articles: [NEW_EN, ...enBase.slice(0, 9)] }, undefined, { live: true, entries: [BLOG_ENTRIES[0]] });
  assert.equal(r.code, 1);
  const f = fieldIds(r.report, 'G1-024');
  for (const x of ['F20', 'F21', 'F22', 'F23']) assert.ok(f.includes(x), f.join());
  assert.equal(resultOf(r.report, 'G1-024').volatile, undefined);
});

test('snapshot mode, blog index: anything but "new articles first" still fails', async () => {
  const edited = enBase.map((a, i) => (i === 3 ? { ...a, title: 'Edited title' } : a));
  const editedLast = enBase.map((a, i) => (i === 9 ? { ...a, excerpt: 'Edited excerpt' } : a));
  const cases = {
    'edited title of a listed article': { articles: [NEW_EN, ...edited.slice(0, 9)] },
    'edited excerpt of the last article, nothing new': { articles: editedLast },
    'list shrinks': { articles: enBase.slice(0, 9) },
    'new article in the middle': { articles: [...enBase.slice(0, 4), NEW_EN, ...enBase.slice(4, 9)] },
    'new article at the end': { articles: [...enBase.slice(0, 9), NEW_EN] },
    'reordered list': { articles: [enBase[1], enBase[0], ...enBase.slice(2)] },
    'ItemList not updated with the HTML list': { articles: [NEW_EN, ...enBase.slice(0, 9)], jsonArticles: enBase },
    'new article and a change outside the list': { articles: [NEW_EN, ...enBase.slice(0, 9)], h1: 'Blog!' },
    'article list replaced by the empty-list paragraph': { articles: [] },
    // Each of the next three is caught by one guard only (the ItemList item comparison, the
    // list-free F23 hash, the position check).
    'new article and an extra member in an old ItemList entry, HTML unchanged': { articles: [NEW_EN, ...enBase.slice(0, 9)], jsonExtra: (a) => (a.slug === 'article-5' ? { image: 'https://www.micronshub.eu/x.png' } : {}) },
    'new article and an attribute change outside #seo-content': { articles: [NEW_EN, ...enBase.slice(0, 9)], rootAttr: ' data-x="1"' },
    'new article, ItemList positions starting at 0': { articles: [NEW_EN, ...enBase.slice(0, 9)], position: (i) => i },
  };
  for (const [name, cand] of Object.entries(cases)) {
    const r = await blogRun(cand, undefined, { entries: [BLOG_ENTRIES[0]] });
    assert.equal(r.code, 1, `${name}: ${JSON.stringify(resultOf(r.report, 'G1-024'))}`);
    const res = resultOf(r.report, 'G1-024');
    assert.equal(res.outcome, 'fail', name);
    assert.ok(res.volatile?.[0]?.applied === false, `${name}: the rule must report why it did not apply`);
  }
});

test('snapshot mode, blog index: a new item must be an article of this blog index (/<lang>/<blog>/<slug>)', async () => {
  const blogLink = (a) => `/en/blog/${a.slug}`;
  const only = (slug, href) => (a) => (a.slug === slug ? href : blogLink(a));
  const cases = {
    'list replaced by another language': { articles: Array.from({ length: 10 }, (_, i) => art('de', 'blog', `artikel-${i}`)), linkOf: (a) => `/de/blog/${a.slug}` },
    'list replaced by off-site links': { articles: Array.from({ length: 10 }, (_, i) => art('en', 'blog', `x-${i}`)), linkOf: (a) => `https://other.example/${a.slug}` },
    'a service page listed first': { articles: [art('en', 'blog', 'cnc'), ...enBase.slice(0, 9)], linkOf: only('cnc', '/en/services/cnc') },
    'a new article link with a query': { articles: [NEW_EN, ...enBase.slice(0, 9)], linkOf: only('article-10', '/en/blog/article-10?ref=x') },
    'a new article link one level deeper': { articles: [NEW_EN, ...enBase.slice(0, 9)], linkOf: only('article-10', '/en/blog/2026/article-10') },
    'the blog index itself listed first': { articles: [NEW_EN, ...enBase.slice(0, 9)], linkOf: only('article-10', '/en/blog/') },
    'an article on the preview host': { articles: [NEW_EN, ...enBase.slice(0, 9)], linkOf: only('article-10', 'https://microns-site.example.workers.dev/en/blog/article-10') },
  };
  for (const [name, cand] of Object.entries(cases)) {
    const r = await blogRun(cand, undefined, { entries: [BLOG_ENTRIES[0]] });
    const res = resultOf(r.report, 'G1-024');
    assert.equal(r.code, 1, `${name}: ${JSON.stringify(res)}`);
    assert.equal(res.outcome, 'fail', name);
    assert.equal(res.volatile?.[0]?.applied, false, name);
    assert.match(res.volatile[0].reason, /^article list: item 1 \(.*\) is not an article of \/en\/blog$/, name);
    assert.deepEqual(r.report.new_urls, [], name);
  }
});

test('snapshot mode, blog index: HTML items and ItemList entries must pair up, even when the base has the same mismatch', async () => {
  const swap = (l) => [l[0], l[2], l[1], ...l.slice(3)];
  const baseRoutes = { '/en/blog': page(blogIndexDoc({ articles: enBase, jsonArticles: swap(enBase) })), '/fi/blogi': page(blogIndexDoc({ lang: 'fi', blog: 'blogi', articles: fiBase })) };
  const r = await blogRun({ articles: [NEW_EN, ...enBase.slice(0, 9)], jsonArticles: [NEW_EN, ...swap(enBase).slice(0, 9)] }, undefined, { entries: [BLOG_ENTRIES[0]], baseRoutes });
  const res = resultOf(r.report, 'G1-024');
  assert.equal(r.code, 1, JSON.stringify(res));
  assert.equal(res.volatile?.[0]?.applied, false);
  assert.match(res.volatile[0].reason, /^article list not recognised \(base: list item 2: HTML link https:\/\/www\.micronshub\.eu\/en\/blog\/article-8 and ItemList url https:\/\/www\.micronshub\.eu\/en\/blog\/article-7 differ; candidate: list item 3: /);
});

test('snapshot vs live: when the blog index rule applies only on the database re-check, the re-check result is reported (transient, volatile record, new URLs)', async () => {
  const entries = [{ ...BLOG_ENTRIES[0], methods: ['GET'] }];
  const dbPage = (body) => ({ headers: { 'x-seo-source': 'db' }, body });
  const stale = enBase.map((a, i) => (i === 3 ? { ...a, title: 'Stale title' } : a));
  let n = 0;
  const base = await startSite({ routes: { '/en/blog': dbPage(blogIndexDoc({ articles: enBase })), '/sitemap-en.xml': blogSitemap(enBase) } });
  // First answer: a stale cached list; on the re-check: one new article first.
  const cand = await startSite({ routes: { '/en/blog': () => dbPage(blogIndexDoc({ articles: n++ === 0 ? stale : [NEW_EN, ...enBase.slice(0, 9)] })) } });
  const dir = tmpDir();
  try {
    const A = await capture(base, dir, 'A', [...entries, SITEMAP_ENTRIES[0]]);
    const r = await run(['--snapshot', A, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'o'), '--allow', writeAllow(dir), '--recheck-after', '1']);
    const res = resultOf(r.report, 'G1-024');
    assert.equal(r.code, 0, JSON.stringify(res));
    assert.equal(res.outcome, 'transient');
    assert.equal(res.recheck, 'equal after 1 s');
    assert.equal(res.volatile.length, 1);
    assert.equal(res.volatile[0].rule, 'blog-index-article-list');
    assert.notEqual(res.volatile[0].applied, false);
    assert.deepEqual(res.volatile[0].added, ['https://www.micronshub.eu/en/blog/article-10']);
    assert.match(res.volatile_first_fetch[0].reason, /item 4 .*: the HTML list item differs/);
    assert.deepEqual(r.report.new_urls, ['https://www.micronshub.eu/en/blog/article-10']);
    assert.match(md(path.join(dir, 'o')), /## Volatile rules applied \(§2\.4\)\n[^]*\| G1-024 \| \/en\/blog \| blog-index-article-list \| .*1 new article listed first/);
  } finally { await base.close(); await cand.close(); }
});

test('snapshot mode: the list rule applies only to the blog index URLs of the slug table', async () => {
  const doc = (articles) => page(blogIndexDoc({ articles }));
  const changed = [NEW_EN, ...enBase.slice(0, 9)];
  // Same blog index shape served at /en/about, labelled blog-index in a hand-edited URL list.
  const entries = [{ id: 'G1-020', group: 'G1', url: '/en/about', methods: ['GET', 'HEAD'], expect: { status: 200 }, kind: 'blog-index', profiles: ['gate', 'full'] },
    { ...BLOG_ENTRIES[0], kind: 'page' }];
  const base = await startSite({ routes: { '/en/about': doc(enBase), '/en/blog': doc(enBase) } });
  const cand = await startSite({ routes: { '/en/about': doc(changed), '/en/blog': doc(changed) } });
  const dir = tmpDir();
  try {
    const A = await capture(base, dir, 'A', entries);
    const r = await run(['--snapshot', A, '--candidate', cand.origin, ...compareArgs(dir, 'o')]);
    assert.equal(r.code, 1);
    assert.equal(resultOf(r.report, 'G1-020').outcome, 'fail', 'not a blog index URL');
    assert.equal(resultOf(r.report, 'G1-024').outcome, 'fail', 'URL list does not mark it blog-index');
  } finally { await base.close(); await cand.close(); }
});

test('blog index URLs come from the slug table: 14, localized, and the same as the generator marks', async () => {
  const src = await loadSources(REPO_ROOT);
  const paths = volatileLib.blogIndexPaths(src);
  assert.equal(paths.size, 14);
  for (const p of ['/en/blog', '/sv/blogg', '/nb/blogg', '/fi/blogi', '/de/blog', '/cs/blog']) assert.ok(paths.has(p), p);
  const locs = src.buildPrerenderRoutes().map((p) => `https://www.micronshub.eu${encPath(p)}`);
  for (const lang of src.LANGUAGES) locs.push(`https://www.micronshub.eu/${lang}/${src.SLUGS[lang].blog}/a-${lang}`);
  const doc = buildUrlSet({
    root: REPO_ROOT, src, base: null, profile: 'full', seed: 's', sitemapSource: 'fixture', shellSource: 'fixture',
    sitemapText: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`,
    shellText: '<script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="stylesheet" href="/assets/index-CCCCCCCC.css">',
    servicePages: [], contentPages: [{ language: 'fi', slug: 'blog', localized_slug: null }],
  });
  assert.deepEqual(doc.entries.filter((e) => e.kind === 'blog-index').map((e) => e.url).sort(), [...paths].sort());
});

test('article list extraction and the shift rule (unit)', () => {
  const l = blogIndexArticleList(blogIndexDoc({ articles: enBase }));
  assert.equal(l.error, undefined);
  assert.equal(l.items.length, 10);
  assert.equal(l.items[0].key, 'https://www.micronshub.eu/en/blog/article-9');
  assert.ok(!l.reduced.includes('article-9') && l.reduced.includes('"itemListElement":[]') && l.reduced.includes('BreadcrumbList'));
  assert.match(blogIndexArticleList('<html><body><p>x</p></body></html>').error, /article#seo-content/);
  const { articleListShift, publishedKey } = volatileLib;
  const key = (s) => `https://www.micronshub.eu/en/blog/${s}`;
  const it = (s) => ({ key: key(s), html: `h${s}`, jsonld: `j${s}` });
  const base = ['a', 'b', 'c'].map(it);
  // Published at capture time: the base list and the older article 'o' (sitemap), 'g' (URL set only).
  const sitemap = new Set(['a', 'b', 'c', 'o'].map((s) => publishedKey(key(s))));
  const published = { source: '/sitemap-en.xml', sitemapHas: (k) => sitemap.has(k), where: (k) => (sitemap.has(k) ? '/sitemap-en.xml' : k === publishedKey(key('g')) ? 'the base URL set' : null) };
  const shift = (cand, p = published) => articleListShift(base, cand, '/en/blog', p);
  assert.equal(shift(['n', 'a', 'b'].map(it)).ok, true);
  assert.deepEqual(shift(['n', 'a', 'b'].map(it)).dropped, [key('c')]);
  assert.deepEqual(shift(['a', 'b', 'c'].map(it)), { ok: true, added: [], dropped: [], unchanged: true, reason: null });
  assert.equal(shift(['n1', 'n2', 'n3'].map(it)).ok, true, 'a whole list of articles published since the capture (10 days of publishing) is accepted');
  assert.equal(shift(['a', 'b'].map(it)).ok, false);
  assert.equal(shift(['a', 'n', 'b'].map(it)).ok, false);
  assert.equal(shift(['n', 'n', 'a'].map(it)).ok, false);
  assert.equal(shift([it('n'), { ...it('a'), html: 'changed' }, it('b')]).ok, false);
  assert.equal(shift([it('n'), { ...it('a'), jsonld: 'changed' }, it('b')]).ok, false);
  const other = { key: 'https://www.micronshub.eu/de/blog/n', html: 'h', jsonld: 'j' };
  assert.deepEqual(shift([other, it('a'), it('b')]), { ok: false, added: [other.key], dropped: [], unchanged: false, reason: `item 1 (${other.key}) is not an article of /en/blog` });
  // Articles that already existed at capture time are not new.
  assert.equal(shift(['o', 'a', 'b'].map(it)).reason, `item 1 (${key('o')}) was already published when the base was captured (listed in /sitemap-en.xml)`);
  assert.equal(shift(['n', 'g', 'a'].map(it)).reason, `item 2 (${key('g')}) was already published when the base was captured (listed in the base URL set)`);
  // Without a record of what was published, or with a sitemap that misses a base article, nothing is new.
  assert.equal(shift(['n', 'a', 'b'].map(it), null).reason, 'no record of the articles published at capture time');
  assert.equal(shift(['n', 'a', 'b'].map(it), { error: 'no sitemap' }).reason, 'no sitemap');
  const stale = { ...published, sitemapHas: (k) => k !== publishedKey(key('c')) && sitemap.has(k) };
  assert.match(shift(['n', 'a', 'b'].map(it), stale).reason, /^the base snapshot's sitemaps \(\/sitemap-en\.xml\) do not list base article https:\/\/www\.micronshub\.eu\/en\/blog\/c, so/);
  // An unchanged list needs no record.
  assert.equal(shift(['a', 'b', 'c'].map(it), null).unchanged, true);
  // HTML and ItemList entries are paired item by item.
  const swapped = blogIndexArticleList(blogIndexDoc({ articles: enBase, jsonArticles: [enBase[0], enBase[2], enBase[1], ...enBase.slice(3)] }));
  assert.equal(swapped.error, `list item 2: HTML link ${key('article-8')} and ItemList url ${key('article-7')} differ`);
});

test('article of a blog index (unit): one non-empty path segment under the index path on www, no query or fragment', () => {
  const { isBlogArticleKey } = volatileLib;
  assert.equal(typeof isBlogArticleKey, 'function');
  const www = 'https://www.micronshub.eu';
  assert.equal(isBlogArticleKey(`${www}/en/blog/cnc-guide`, '/en/blog'), true);
  assert.equal(isBlogArticleKey(new URL('/fi/blogi/cnc-työstö-uutuus', www).href, '/fi/blogi'), true);
  for (const k of [`${www}/en/blog/`, `${www}/en/blog`, `${www}/en/blog/a/b`, `${www}/en/blog/a?x=1`, `${www}/en/blog/a#x`, `${www}/en/blogx/a`,
    `${www}/de/blog/a`, `${www}/en/services/a`, 'https://other.example/en/blog/a', 'http://www.micronshub.eu/en/blog/a', null, 'not a url']) {
    assert.equal(isBlogArticleKey(k, '/en/blog'), false, String(k));
  }
});

// ======================================================= 3. prerender tag scripts

const GTAG_LOADER = '<script src="https://www.googletagmanager.com/gtag/js?id=AW-17760727501"></script>';
const runtimeGtag = (gtm = '4e69u2') => `<script type="text/javascript" src="https://www.googletagmanager.com/gtag/js?id=G-G6T5PMFLRH&amp;cx=c&amp;gtm=${gtm}"></script>`;
const runtimeAds = (r, id = '17760727501') => `<script type="text/javascript" src="https://googleads.g.doubleclick.net/pagead/viewthroughconversion/${id}/?random=${r}&amp;cv=11&amp;fst=${r}&amp;auid=1159701935.${r}&amp;url=http%3A%2F%2F127.0.0.1%3A19001%2Ffi%2Fpalvelut&amp;rcb=3"></script>`;

/**
 * A prerendered page as the jsdom prerender writes it: one gtag loader element (added by the
 * index.html loader script, the same in every build) and, depending on build timing, the tag
 * runtime's own script elements, all in <head>.
 */
function prerendered({ tags = '', title = 'Palvelut | Microns Hub', canonical = 'https://www.micronshub.eu/fi/palvelut', hreflang = 'fi', jsonld = '{"@type":"Organization","name":"Microns Hub"}', seoText = 'CNC-työstö', bodyTags = '' } = {}) {
  return `<!DOCTYPE html><html lang="fi"><head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta name="description" content="Palvelut">
    <link rel="canonical" href="${canonical}">
    <link rel="alternate" hreflang="${hreflang}" href="https://www.micronshub.eu/fi/palvelut">
    <link rel="stylesheet" crossorigin="" href="/assets/index-BhClPXhf.css">
  ${GTAG_LOADER}${tags}<script type="application/ld+json">${jsonld}</script>
  </head><body><div id="root"><article id="seo-content" lang="fi"><h1>${seoText}</h1></article></div>${bodyTags}</body></html>`;
}

const STATIC_ENTRY = [{ id: 'G9-009', group: 'G9', url: '/fi/palvelut/index.html', methods: ['GET', 'HEAD'], kind: 'variant', profiles: ['gate', 'full'] }];
async function staticPair(baseDoc, candDoc, headers = {}) {
  const base = await startSite({ routes: { '/fi/palvelut/index.html': { headers, body: baseDoc } } });
  const cand = await startSite({ routes: { '/fi/palvelut/index.html': { headers, body: candDoc } } });
  const dir = tmpDir();
  try {
    return await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, STATIC_ENTRY), ...compareArgs(dir, 'o')]);
  } finally { await base.close(); await cand.close(); }
}

test('prerendered file: tag scripts with per-build values, or missing in one build → pass (F23 without them)', async () => {
  const one = prerendered({ tags: `${runtimeGtag()}${runtimeAds(1790937659344)}` });
  for (const other of [prerendered({ tags: runtimeAds(1790944124109) }), prerendered(), prerendered({ tags: `${runtimeGtag('4e6a10h2')}${runtimeAds(1, '11483442083')}${runtimeAds(2)}` })]) {
    const r = await staticPair(one, other);
    assert.equal(r.code, 0, JSON.stringify(diffsOf(r.report, 'G9-009')));
    const v = resultOf(r.report, 'G9-009').volatile[0];
    assert.equal(v.rule, 'prerender-tag-scripts');
    assert.deepEqual(v.base_removed, ['www.googletagmanager.com/gtag/js', 'googleads.g.doubleclick.net/pagead/viewthroughconversion/17760727501/']);
  }
});

test('prerendered file: SEO fields and other bytes still compare exactly next to tag scripts', async () => {
  const tags = runtimeAds(1);
  const base = prerendered({ tags });
  const cases = {
    F14: prerendered({ title: 'Other', tags: runtimeAds(2) }),
    F16: prerendered({ canonical: 'https://www.micronshub.eu/fi/palvelut/', tags: runtimeAds(2) }),
    F17: prerendered({ hreflang: 'sv', tags: runtimeAds(2) }),
    F20: prerendered({ jsonld: '{"@type":"Organization","name":"Microns"}', tags: runtimeAds(2) }),
    F21: prerendered({ seoText: 'Levytyöstö', tags: runtimeAds(2) }),
  };
  for (const [field, cand] of Object.entries(cases)) {
    const r = await staticPair(base, cand);
    assert.equal(r.code, 1, field);
    const f = fieldIds(r.report, 'G9-009');
    assert.ok(f.includes(field) && f.includes('F23'), `${field}: ${f.join()}`);
  }
  // Not the runtime's elements: another type, an extra attribute, a <body> position, another host, the static loader.
  const lookalikes = {
    'type="module"': prerendered({ tags: runtimeAds(1).replace('type="text/javascript"', 'type="module"') }),
    'type="text/plain"': prerendered({ tags: runtimeGtag().replace('type="text/javascript"', 'type="text/plain"') }),
    'extra attribute': prerendered({ tags: runtimeAds(1).replace('<script ', '<script async ') }),
    'in <body>': prerendered({ tags: '', bodyTags: runtimeAds(1) }),
    'other host': prerendered({ tags: runtimeAds(1).replace('googleads.g.doubleclick.net', 'ads.example.com') }),
    'static loader removed': prerendered({ tags }).replace(GTAG_LOADER, ''),
  };
  for (const [name, cand] of Object.entries(lookalikes)) {
    const r = await staticPair(prerendered(), cand);
    assert.equal(r.code, 1, `${name}: ${JSON.stringify(diffsOf(r.report, 'G9-009'))}`);
    assert.ok(fields(r.report, 'G9-009').includes('F23'), name);
  }
});

test('tag scripts on a response with X-Seo-Source (an SEO handler page) → still fail F23', async () => {
  const r = await staticPair(prerendered({ tags: runtimeAds(1) }), prerendered({ tags: runtimeAds(2) }), { 'x-seo-source': 'i18n' });
  assert.equal(r.code, 1);
  assert.deepEqual(fields(r.report, 'G9-009'), ['F23']);
});

test('tool version 1.1.0 in manifest and report; a snapshot captured before 1.1.0 (no tag-script variant) says why the rule did not apply', async () => {
  const base = await startSite({ routes: { '/fi/palvelut/index.html': { body: prerendered({ tags: runtimeAds(1) }) } } });
  const cand = await startSite({ routes: { '/fi/palvelut/index.html': { body: prerendered({ tags: runtimeAds(2) }) } } });
  const dir = tmpDir();
  try {
    const A = await capture(base, dir, 'A', STATIC_ENTRY);
    const manifest = JSON.parse(readFileSync(path.join(A, 'manifest.json'), 'utf8'));
    assert.equal(manifest.tool_version, '1.1.0');
    const fresh = await run(['--snapshot', A, '--candidate', cand.origin, ...compareArgs(dir, 'fresh')]);
    assert.equal(fresh.code, 0, JSON.stringify(resultOf(fresh.report, 'G9-009')));
    assert.equal(fresh.report.tool_version, '1.1.0');
    assert.equal(fresh.report.snapshots.base.tool_version, '1.1.0');
    assert.equal(resultOf(fresh.report, 'G9-009').volatile[0].rule, 'prerender-tag-scripts');

    // The same capture as the 1.0.0 tool stored it: no F23 variant without tag scripts.
    const old = path.join(dir, 'A-old');
    cpSync(A, old, { recursive: true });
    const lines = readFileSync(path.join(old, 'results.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (const l of lines) for (const h of l.hops || []) if (h.extracted) delete h.extracted.F23_sans_tag_scripts;
    writeFileSync(path.join(old, 'results.ndjson'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    writeFileSync(path.join(old, 'manifest.json'), JSON.stringify({ ...manifest, tool_version: '1.0.0' }));
    const r = await run(['--snapshot', old, '--candidate', cand.origin, ...compareArgs(dir, 'old')]);
    assert.equal(r.code, 1);
    assert.deepEqual(fields(r.report, 'G9-009'), ['F23']);
    assert.equal(r.report.snapshots.base.tool_version, '1.0.0');
    assert.deepEqual(resultOf(r.report, 'G9-009').volatile, [{ rule: 'prerender-tag-scripts', applied: false, reason: 'the base record has no F23 variant without tag scripts (captured by a tool before 1.1.0)' }]);
    assert.match(md(path.join(dir, 'old')), /Volatile rule prerender-tag-scripts not applied: the base record has no F23 variant without tag scripts \(captured by a tool before 1\.1\.0\)/);
  } finally { await base.close(); await cand.close(); }
});

test('tag-script rule (unit): matcher, default F23 unchanged, variant stored per document', () => {
  const doc = prerendered({ tags: `${runtimeGtag()}${runtimeAds(5)}` });
  const hop = { family: 'html', headers: {}, body_sha256: 'x' };
  const e = extractForHop(hop, Buffer.from(doc));
  assert.equal(e.F23.sha256, sha256(normaliseHtmlDocument(doc)), 'F23 keeps the tag scripts');
  assert.ok(normaliseHtmlDocument(doc).includes('viewthroughconversion'));
  assert.equal(e.F23_sans_tag_scripts.sha256, extractForHop(hop, Buffer.from(prerendered())).F23_sans_tag_scripts.sha256);
  assert.equal(e.F23_sans_tag_scripts.removed.length, 2);
  const el = (attrs, parent = 'head', kids = []) => ({ tagName: 'script', attrs, parentNode: { tagName: parent }, childNodes: kids });
  const src = { name: 'src', value: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/?random=1' };
  const type = { name: 'type', value: 'text/javascript' };
  assert.equal(volatileLib.isPrerenderTagScript(el([type, src])), true);
  assert.equal(volatileLib.isPrerenderTagScript(el([src])), false);
  for (const t of ['module', 'text/plain', 'application/javascript', 'TEXT/JAVASCRIPT']) assert.equal(volatileLib.isPrerenderTagScript(el([{ name: 'type', value: t }, src])), false, t);
  assert.equal(volatileLib.isPrerenderTagScript(el([type, src], 'body')), false);
  assert.equal(volatileLib.isPrerenderTagScript(el([type, src, { name: 'async', value: '' }])), false);
  assert.equal(volatileLib.isPrerenderTagScript(el([type, src], 'head', [{ nodeName: '#text', value: 'x' }])), false);
  assert.equal(volatileLib.isPrerenderTagScript(el([type, { name: 'src', value: 'https://www.googletagmanager.com/gtm.js?id=1' }])), false);
});

// ======================================================= 4. package test script

test('package.json "test" runs every test file with the glob form (Node 22 rejects a directory argument)', () => {
  const pkgDir = path.join(REPO_ROOT, 'scripts', 'seo-parity');
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.test, 'node --test test/*.test.mjs');
  assert.equal(pkg.version, TOOL_VERSION, 'package version follows the tool version written to manifests and reports');
  // Every module in test/ is either a *.test.mjs file (picked up by the glob) or the shared helpers.
  const files = readdirSync(path.join(pkgDir, 'test'));
  assert.deepEqual(files.filter((f) => !f.endsWith('.test.mjs') && f !== 'helpers.mjs'), []);
});
