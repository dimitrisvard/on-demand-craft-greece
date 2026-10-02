// Regression tests for the review findings on the parity tool (each would
// have passed silently before its fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  startSite, tmpDir, writeUrls, writeAllow, run, baseEnv, diffsOf, FIXTURE_ENTRIES, REDIRECTS_FILE, ACCESS_ID, ACCESS_SECRET,
} from './helpers.mjs';
import { extractHtml, normaliseHtmlDocument } from '../lib/extract.mjs';
import { validateAllowList } from '../lib/allow.mjs';
import { accessTransportOk, isLoopbackHost } from '../lib/fetch.mjs';
import { addDays, collapse, isoDate, sha256 } from '../lib/util.mjs';

const TODAY = isoDate(new Date());
const fields = (report, id) => diffsOf(report, id).map((d) => d.field + (d.sub ? `:${d.sub}` : ''));

async function pair(baseOpts, candOpts, { entries = FIXTURE_ENTRIES, allow = [], args = [], env } = {}) {
  const base = await startSite(baseOpts);
  const cand = await startSite(candOpts);
  const dir = tmpDir();
  try {
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'out'),
      '--allow', writeAllow(dir, allow), '--recheck-after', '0', ...args], env);
    return { ...r, base, cand, dir };
  } finally { await base.close(); await cand.close(); }
}

// ---------------------------------------------------------------- F23 (parity-1)

const HEAD_TAGS = [
  '<link rel="alternate" hreflang="en" href="https://www.micronshub.eu/en?a=1&amp;b=2" />',
  '<link rel="alternate" hreflang="de" href="https://www.micronshub.eu/de" />',
  '<meta property="og:title" content="Rock &#39;n&#39; roll" />',
  '<meta name="twitter:title" content="Rock" />',
  '<script type="application/ld+json">\n    {"@context":"https://schema.org","name":"A \\u0026 B","url":"https://x/\\/y"}\n    </script>',
];
const page = (head = HEAD_TAGS, body = '<p>x</p>') => `<!DOCTYPE html><html lang="en"><head><title>T</title>\n    ${head.join('\n    ')}\n  </head><body>${body}</body></html>`;
const f23 = (html) => normaliseHtmlDocument(html);

test('F23: reordering hreflang, og/twitter meta and JSON-LD keys still passes', () => {
  const ref = f23(page());
  assert.equal(f23(page([...HEAD_TAGS].reverse())), ref);
  const reKeyed = [...HEAD_TAGS];
  reKeyed[4] = '<script type="application/ld+json">{ "url": "https://x/\\/y",\n "name": "A \\u0026 B", "@context": "https://schema.org" }</script>';
  assert.equal(f23(page(reKeyed)), ref);
});

test('F23: attribute, position and escaping changes in the moved elements fail', () => {
  const ref = f23(page());
  const mutate = (i, v) => { const h = [...HEAD_TAGS]; h[i] = v; return page(h); };
  const cases = {
    'rel=alternate dropped': mutate(1, '<link hreflang="de" href="https://www.micronshub.eu/de" />'),
    'og property= → name=': mutate(2, '<meta name="og:title" content="Rock &#39;n&#39; roll" />'),
    'attribute injected into og meta': mutate(2, '<meta property="og:title" content="Rock &#39;n&#39; roll" data-x="1" />'),
    'og content &#39; → \'': mutate(2, '<meta property="og:title" content="Rock \'n\' roll" />'),
    'hreflang href &amp; → &': mutate(0, '<link rel="alternate" hreflang="en" href="https://www.micronshub.eu/en?a=1&b=2" />'),
    'JSON-LD gains a nonce': mutate(4, HEAD_TAGS[4].replace('<script ', '<script nonce="abc" ')),
    'JSON-LD escaping \\u0026 → &': mutate(4, HEAD_TAGS[4].replace('\\u0026', '&')),
    'JSON-LD escaping \\/ → /': mutate(4, HEAD_TAGS[4].replace('\\/y', '/y')),
    'hreflang link moved into <body>': page(HEAD_TAGS.filter((_, i) => i !== 1), `<p>x</p>${HEAD_TAGS[1]}`),
  };
  for (const [name, html] of Object.entries(cases)) assert.notEqual(f23(html), ref, name);
});

test('F18 is keyed on the attribute; F17 marks hreflang links without rel=alternate', () => {
  const a = extractHtml('<head><meta property="og:title" content="x"><link hreflang="de" href="/de"><link rel="alternate" hreflang="en" href="/en"></head>');
  const b = extractHtml('<head><meta name="og:title" content="x"><link rel="alternate" hreflang="de" href="/de"><link rel="alternate" hreflang="en" href="/en"></head>');
  assert.deepEqual(Object.keys(a.F18), ['property:og:title']);
  assert.deepEqual(Object.keys(b.F18), ['name:og:title']);
  assert.deepEqual(a.F17, [['de', '/de', 'rel='], ['en', '/en']]);
  assert.deepEqual(b.F17, [['de', '/de'], ['en', '/en']]);
});

test('end to end: rel=alternate dropped from one hreflang link → fail (F17, F23)', async () => {
  const r = await pair({}, { bodyTransform: (h) => h.replace('<link rel="alternate" hreflang="de"', '<link hreflang="de"') },
    { entries: FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001') });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F17'));
  assert.ok(fields(r.report, 'G1-001').includes('F23'));
});

// ---------------------------------------------------------------- whitespace (parity-2)

test('collapse folds ASCII whitespace only (NBSP, BOM, U+2028 survive)', () => {
  assert.equal(collapse(' a \t\n\f\r b '), 'a b');
  assert.equal(collapse('Prix : 10 €'), 'Prix : 10 €');
  assert.equal(collapse('﻿<html>'), '﻿<html>');
  assert.equal(collapse('a b'), 'a b');
});

test('end to end: NBSP turned into a space, or a BOM prepended → fail', async () => {
  const nbsp = await pair({ bodyTransform: (h) => h.replace('Parts in days.', 'Parts in days.') },
    { bodyTransform: (h) => h.replace('Parts in days.', 'Parts in days.') }, { entries: FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001') });
  assert.equal(nbsp.code, 1);
  assert.ok(fields(nbsp.report, 'G1-001').includes('F21:text'));
  assert.ok(fields(nbsp.report, 'G1-001').includes('F23'));
  const bom = await pair({}, { bodyTransform: (h) => `﻿${h}` }, { entries: FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001') });
  assert.equal(bom.code, 1);
  assert.ok(fields(bom.report, 'G1-001').includes('F23'));
});

// ---------------------------------------------------------------- allow-list (parity-3, parity-4, robustness-4)

const fieldEntry = (over) => ({
  id: 'AL-950', url: '/en', match: 'exact', field: 'F4', expected: { base: 'a', candidate: 'b' },
  justification: 'test', applies_to: ['preview'], expires: addDays(TODAY, 30), approver: 'Dimitris', approved_on: TODAY, ...over,
});

test('allow-list: F4/F12 entries cannot cover F6 or F9 on SEO paths', () => {
  const errs = (e) => validateAllowList({ version: 1, entries: [fieldEntry(e)] }, TODAY);
  assert.match(errs({ sub: 'F6' }).join('\n'), /F6 and F9 must be identical/);
  assert.match(errs({ sub: 'F9' }).join('\n'), /F6 and F9 must be identical/);
  assert.match(errs({ sub: 'F9:x' }).join('\n'), /F6 and F9 must be identical/);
  assert.match(errs({ field: 'F12', sub: 'F6' }).join('\n'), /F6 and F9 must be identical/);
  assert.match(errs({}).join('\n'), /need a "sub"/);
  assert.match(errs({ url: '/en/**', match: 'glob', sub: 'F6' }).join('\n'), /F6 and F9 must be identical/);
  assert.deepEqual(errs({ sub: 'F11:x-frame-options' }), []);
  assert.deepEqual(errs({ url: '/robots.txt', sub: 'F6' }), []);
});

test('response entry: candidate redirects GET but answers HEAD 200 → fail', async () => {
  const allow = [{
    id: 'AL-951', url: '/client-only', match: 'exact', field: 'response',
    expected: { base: { status: 200 }, candidate: { status: 308, location: '/en' } },
    justification: 'test', applies_to: ['preview', 'production'], expires: addDays(TODAY, 30), approver: 'Dimitris', approved_on: TODAY,
  }];
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G6-002');
  const half = await pair({}, { clientOnlyRedirect: '/en', clientOnlyRedirectMethods: ['GET'] }, { entries, allow });
  assert.equal(half.code, 1);
  assert.equal(half.report.results[0].outcome, 'fail');
  const full = await pair({}, { clientOnlyRedirect: '/en' }, { entries, allow });
  assert.equal(full.code, 0, JSON.stringify(full.report.results));
  assert.equal(full.report.results[0].outcome, 'allowed');
});

test('AL-004-style same_as_url entry matches with and without --normalise-asset-hashes', async () => {
  const entries = [
    { id: 'G8-001', group: 'G8', url: '/_redirects', methods: ['GET', 'HEAD'], kind: 'special', profiles: ['gate', 'full'] },
    { id: 'G8-002', group: 'G8', url: '/index.html', methods: ['GET', 'HEAD'], kind: 'special', profiles: ['gate', 'full'] },
  ];
  const allow = [{
    id: 'AL-952', url: '/_redirects', match: 'exact', field: ['F5', 'F23', 'F24'],
    expected: {
      F5: { base: 'text/plain;charset=utf-8', candidate: 'text/html;charset=utf-8' },
      F23: { base: sha256(collapse(REDIRECTS_FILE)), candidate: { same_as_url: '/index.html' } },
      F24: { base: sha256(REDIRECTS_FILE), candidate: { same_as_url: '/index.html' } },
    },
    justification: 'test', applies_to: ['preview', 'production'], expires: addDays(TODAY, 30), approver: 'Dimitris', approved_on: TODAY,
  }];
  const opts = [{}, { redirectsShell: true }];
  const plain = await pair(...opts, { entries, allow });
  assert.equal(plain.code, 0, JSON.stringify(plain.report.results));
  assert.equal(plain.report.results[0].outcome, 'allowed');
  const hashless = await pair(...opts, { entries, allow, args: ['--normalise-asset-hashes'] });
  assert.equal(hashless.code, 0, JSON.stringify(hashless.report.results));
  assert.equal(hashless.report.results[0].outcome, 'allowed');
});

// ---------------------------------------------------------------- HEAD/OPTIONS Location (robustness-2)

test('HEAD Location differs while GET matches → fail (F4:location)', async () => {
  const r = await pair({}, { headRedirectTo: 'https://evil.example/elsewhere' }, { entries: FIXTURE_ENTRIES.filter((e) => e.id === 'G6-001') });
  assert.equal(r.code, 1);
  const d = diffsOf(r.report, 'G6-001').find((x) => x.field === 'F4' && x.sub === 'location');
  assert.ok(d, JSON.stringify(diffsOf(r.report, 'G6-001')));
  assert.equal(d.candidate, 'https://evil.example/elsewhere');
  // Same relative Location on both origins → equal after origin normalisation.
  const ok = await pair({}, {}, { entries: FIXTURE_ENTRIES.filter((e) => e.id === 'G6-001') });
  assert.equal(ok.code, 0, JSON.stringify(ok.report.results));
});

// ---------------------------------------------------------------- absolute entries (parity-5)

test('absolute host variants are not-applicable when a live side is not the production origin, whatever the role', async () => {
  const entries = [{ id: 'G9-016', group: 'G9', url: 'https://micronshub.eu/', methods: ['GET', 'HEAD'], kind: 'variant', na_preview: 'S13', profiles: ['gate', 'full'] }];
  const r = await pair({}, {}, { entries, args: ['--candidate-role', 'production'] });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.report.results[0].outcome, 'not-applicable');
  assert.match(r.report.results[0].stage, /^S13: micronshub\.eu is not served by/);
  assert.equal(r.base.requests.length + r.cand.requests.length, 0);
});

// ---------------------------------------------------------------- snapshots (robustness-1, robustness-3)

async function captureTo(site, dir, name, entries, env) {
  const snap = path.join(dir, name);
  const r = await run(['--capture', '--base', site.origin, '--urls', writeUrls(dir, entries), '--snapshot', snap], env);
  assert.equal(r.code, 0, r.err);
  return snap;
}

test('a snapshot from an invalid capture is refused (exit 3); an override capture makes the run unsignable', async () => {
  const site = await startSite();
  const dir = tmpDir();
  try {
    const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
    const A = await captureTo(site, dir, 'A', entries);
    const B = await captureTo(site, dir, 'B', entries);
    const noOverride = { PATH: process.env.PATH };
    // A and B were captured with PARITY_IGNORE_WINDOW=1 (test env): valid, not signable.
    const ok = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, '--out', path.join(dir, 'ok'), '--allow', writeAllow(dir)], noOverride);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(ok.report.signable, false);
    assert.ok(ok.report.unsignable_reasons.includes('base snapshot captured with PARITY_IGNORE_WINDOW=1'));
    assert.ok(ok.report.unsignable_reasons.includes('candidate snapshot captured with PARITY_IGNORE_WINDOW=1'));
    assert.equal(ok.report.snapshots.base.window_override, true);
    assert.match(readFileSync(path.join(dir, 'ok', 'report.md'), 'utf8'), /snapshot was captured with PARITY_IGNORE_WINDOW=1/);
    // Mark A invalid (as a capture that crossed 09:00 would be).
    const mf = path.join(A, 'manifest.json');
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    writeFileSync(mf, JSON.stringify({ ...m, valid: false, invalid_reasons: ['the run crossed 2026-10-02T09:00:00.000Z (volatile window)'] }));
    const bad = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, '--out', path.join(dir, 'bad'), '--allow', writeAllow(dir)], noOverride);
    assert.equal(bad.code, 3);
    assert.match(bad.err, /base snapshot .* invalid capture .*crossed/);
    const badCand = await run(['--snapshot', B, '--candidate', `snapshot:${A}`, '--out', path.join(dir, 'bad2'), '--allow', writeAllow(dir)], noOverride);
    assert.equal(badCand.code, 3);
  } finally { await site.close(); }
});

test('snapshot join: --urls entry with another URL or an extra method → usage error (exit 2)', async () => {
  const site = await startSite();
  const dir = tmpDir();
  try {
    const A = await captureTo(site, dir, 'A', [{ ...FIXTURE_ENTRIES[0], methods: ['GET'] }]);
    const sub = tmpDir();
    const withHead = await run(['--snapshot', A, '--candidate', site.origin, '--urls', writeUrls(sub, [FIXTURE_ENTRIES[0]]), '--out', path.join(dir, 'o1'), '--allow', writeAllow(dir)]);
    assert.equal(withHead.code, 2);
    assert.match(withHead.err, /method HEAD not in the base snapshot/);
    const otherUrl = await run(['--snapshot', A, '--candidate', site.origin, '--urls', writeUrls(sub, [{ ...FIXTURE_ENTRIES[0], url: '/robots.txt', methods: ['GET'] }]), '--out', path.join(dir, 'o2'), '--allow', writeAllow(dir)]);
    assert.equal(otherUrl.code, 2);
    assert.match(otherUrl.err, /--urls has \/robots\.txt, the base snapshot has \/en/);
    const same = await run(['--snapshot', A, '--candidate', site.origin, '--out', path.join(dir, 'o3'), '--allow', writeAllow(dir)]);
    assert.equal(same.code, 0, same.err);
  } finally { await site.close(); }
});

test('capture from a non-production base records absolute entries as not requested; compare lists them not-applicable', async () => {
  const site = await startSite();
  const dir = tmpDir();
  try {
    const entries = [FIXTURE_ENTRIES[0], { id: 'G9-016', group: 'G9', url: 'https://micronshub.eu/', methods: ['GET', 'HEAD'], kind: 'variant', na_preview: 'S13', profiles: ['gate', 'full'] }];
    const A = await captureTo(site, dir, 'A', entries);
    const B = await captureTo(site, dir, 'B', entries);
    assert.ok(site.requests.every((q) => !q.url.startsWith('http')));
    const r = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, '--out', path.join(dir, 'o'), '--allow', writeAllow(dir), '--candidate-role', 'production']);
    assert.equal(r.code, 0, r.err);
    const g9 = r.report.results.find((x) => x.id === 'G9-016');
    assert.equal(g9.outcome, 'not-applicable');
    assert.match(g9.stage, /not requested in the base snapshot/);
  } finally { await site.close(); }
});

// ---------------------------------------------------------------- empty selection (robustness-6)

test('an empty selection is a usage error, not a pass', async () => {
  const dir = tmpDir();
  const urls = writeUrls(dir);
  const args = ['--base', 'http://127.0.0.1:9', '--candidate', 'http://127.0.0.1:9', '--urls', urls, '--out', path.join(dir, 'o'), '--allow', writeAllow(dir)];
  const r = await run([...args, '--only', 'G2']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no entries selected/);
  assert.equal((await run([...args, '--profile', 'sitemaps', '--only', 'G1'])).code, 2);
  const cap = await run(['--capture', '--base', 'http://127.0.0.1:9', '--urls', urls, '--snapshot', path.join(dir, 's'), '--only', 'G3']);
  assert.equal(cap.code, 2);
});

// ---------------------------------------------------------------- Access transport (robustness-7)

test('Access credentials only over https or loopback http', async () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.5.6.7'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('10.0.0.1'), false);
  assert.equal(isLoopbackHost('microns-site.example.workers.dev'), false);
  assert.equal(accessTransportOk('https://microns-site.example.workers.dev/en'), true);
  assert.equal(accessTransportOk('http://microns-site.example.workers.dev/en'), false);
  assert.equal(accessTransportOk('http://127.0.0.1:8787/en'), true);
  const dir = tmpDir();
  const env = { ...baseEnv(), CF_ACCESS_CLIENT_ID: ACCESS_ID, CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET };
  const r = await run(['--base', 'http://127.0.0.1:9', '--candidate', 'http://microns-site.example.workers.dev', '--urls', writeUrls(dir), '--out', path.join(dir, 'o'), '--allow', writeAllow(dir)], env);
  assert.equal(r.code, 2);
  assert.match(r.err, /only over https/);
  assert.ok(!r.err.includes(ACCESS_SECRET));
});

// ---------------------------------------------------------------- snapshot-mode blog articles

test('snapshot mode, blog article: a new hreflang link passes (base ⊆ candidate); live mode and other changes fail', async () => {
  const site = await startSite();
  const dir = tmpDir();
  const entries = [{ ...FIXTURE_ENTRIES[0], kind: 'blog-article' }];
  const addLink = (h) => h.replace('<link rel="alternate" hreflang="fr"', '<link rel="alternate" hreflang="nl" href="https://www.micronshub.eu/nl"/>\n<link rel="alternate" hreflang="fr"');
  const grown = await startSite({ bodyTransform: addLink });
  const grownAndEdited = await startSite({ bodyTransform: (h) => addLink(h).replace('Parts in days.', 'Parts in weeks.') });
  try {
    const A = await captureTo(site, dir, 'A', entries);
    const ok = await run(['--snapshot', A, '--candidate', grown.origin, '--out', path.join(dir, 'o1'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(ok.code, 0, JSON.stringify(ok.report.results));
    const edited = await run(['--snapshot', A, '--candidate', grownAndEdited.origin, '--out', path.join(dir, 'o2'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(edited.code, 1);
    assert.ok(fields(edited.report, 'G1-001').includes('F23'));
    const live = await run(['--base', site.origin, '--candidate', grown.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'o3'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(live.code, 1);
    assert.ok(fields(live.report, 'G1-001').includes('F17') && fields(live.report, 'G1-001').includes('F23'));
  } finally { await site.close(); await grown.close(); await grownAndEdited.close(); }
});

// ---------------------------------------------------------------- generator ids (robustness-3)

test('G3 entry ids do not depend on the order of the content_pages rows', async () => {
  const { loadSources } = await import('../lib/sources.mjs');
  const { buildUrlSet, encPath } = await import('../lib/urls.mjs');
  const { REPO_ROOT } = await import('../lib/cli.mjs');
  const src = await loadSources(REPO_ROOT);
  const locs = src.buildPrerenderRoutes().map((p) => `https://www.micronshub.eu${encPath(p)}`);
  for (const lang of src.LANGUAGES) locs.push(`https://www.micronshub.eu/${lang}/${src.SLUGS[lang].blog}/article-${lang}`);
  const sitemapText = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
  const rows = [
    { language: 'cs', slug: 'education', localized_slug: 'vzdelavani' },
    { language: 'de', slug: 'about', localized_slug: null },
    { language: 'cs', slug: 'industries', localized_slug: 'odvetvi' },
  ];
  const build = (contentPages) => buildUrlSet({
    root: REPO_ROOT, src, base: null, profile: 'full', seed: 's', sitemapText, sitemapSource: 'fixture',
    shellText: '<script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="stylesheet" href="/assets/index-CCCCCCCC.css">', shellSource: 'fixture',
    servicePages: [], contentPages,
  }).entries.filter((e) => e.group === 'G3').map((e) => `${e.id} ${e.url}`);
  assert.deepEqual(build(rows), build([...rows].reverse()));
});
