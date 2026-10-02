import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { startSite, tmpDir, writeUrls, writeAllow, run, baseEnv, allFileContents, ACCESS_ID, ACCESS_SECRET, FIXTURE_ENTRIES } from './helpers.mjs';

const hasAccess = (req) => 'cf-access-client-id' in req.headers || 'cf-access-client-secret' in req.headers;

test('Access headers go to the candidate origin only, never to the base or redirect targets, never to disk', async () => {
  const base = await startSite();
  const third = await startSite();
  const cand = await startSite({ offsiteRedirect: `${third.origin}/landing` });
  const dir = tmpDir();
  const entries = [...FIXTURE_ENTRIES, { id: 'G9-001', group: 'G9', url: '/offsite', methods: ['GET', 'HEAD'], kind: 'variant', profiles: ['gate', 'full'] }];
  const out = path.join(dir, 'out');
  try {
    const env = { ...baseEnv(), CF_ACCESS_CLIENT_ID: ACCESS_ID, CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET };
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', out, '--allow', writeAllow(dir), '--recheck-after', '0'], env);
    assert.ok([0, 1].includes(r.code), r.err);
    assert.ok(base.requests.length > 0);
    assert.equal(base.requests.filter(hasAccess).length, 0, 'the base never sees Access headers');
    assert.equal(third.requests.length, 0, 'off-site redirect targets are recorded, never requested');
    const methods = new Set(cand.requests.filter(hasAccess).map((q) => q.method));
    assert.deepEqual([...methods].sort(), ['GET', 'HEAD', 'OPTIONS']);
    assert.ok(cand.requests.every(hasAccess), 'every candidate request carries the service token');
    assert.equal(cand.requests[0].headers['cf-access-client-secret'], ACCESS_SECRET);
    assert.equal(cand.requests[0].headers['user-agent'], 'micronshub-seo-parity/1.0 (owner-run parity check)');
    assert.equal(cand.requests[0].headers['sec-fetch-mode'], undefined, 'no browser fetch headers');
    for (const f of allFileContents(out)) {
      assert.ok(!f.text.includes(ACCESS_SECRET) && !f.text.includes(ACCESS_ID), `${f.path} must not contain Access values`);
    }
    assert.ok(!(r.out + r.err).includes(ACCESS_SECRET));
    assert.equal(r.report.access_headers, 'sent to the candidate origin only');
    const off = r.report.results.find((x) => x.id === 'G9-001');
    assert.equal(off.outcome, 'fail'); // the base 404s, the candidate redirects
  } finally { await base.close(); await cand.close(); await third.close(); }
});

test('capture → snapshot files; snapshot vs snapshot passes; snapshot vs live detects a change', async () => {
  const site = await startSite();
  const dir = tmpDir();
  const urls = writeUrls(dir);
  const A = path.join(dir, 'A'); const B = path.join(dir, 'B');
  try {
    const ca = await run(['--capture', '--base', site.origin, '--urls', urls, '--snapshot', A, '--vantage', 'test', '--bypass-method', 'none']);
    assert.equal(ca.code, 0, ca.err);
    const cb = await run(['--capture', '--base', site.origin, '--urls', urls, '--snapshot', B]);
    assert.equal(cb.code, 0, cb.err);
    for (const f of ['manifest.json', 'urls.json', 'results.ndjson']) assert.ok(existsSync(path.join(A, f)), f);
    const manifest = JSON.parse(readFileSync(path.join(A, 'manifest.json'), 'utf8'));
    assert.equal(manifest.user_agent, 'micronshub-seo-parity/1.0 (owner-run parity check)');
    assert.equal(manifest.vantage, 'test');
    assert.match(manifest.urls_sha256, /^[0-9a-f]{64}$/);
    const lines = readFileSync(path.join(A, 'results.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // One line per request: 5 entries × (GET + HEAD) + 1 OPTIONS.
    assert.equal(lines.length, 11);
    const get = lines.find((l) => l.entry_id === 'G1-001' && l.method === 'GET');
    assert.equal(get.hops[0].status, 200);
    assert.deepEqual(get.hops[0].extracted.F14, ['Microns Hub — On-demand manufacturing']);
    assert.ok(existsSync(path.join(A, 'raw', `${get.hops[0].body_sha256}.gz`)), 'raw body stored, content-addressed');
    const text = readFileSync(path.join(A, 'results.ndjson'), 'utf8');
    assert.ok(!/user-agent|cf-access/i.test(text), 'no request headers in the snapshot');
    // A second capture into an existing snapshot is refused.
    assert.equal((await run(['--capture', '--base', site.origin, '--urls', urls, '--snapshot', A])).code, 2);

    const ss = await run(['--snapshot', A, '--candidate', `snapshot:${B}`, '--out', path.join(dir, 'ss'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(ss.code, 0, JSON.stringify(ss.report?.results.filter((x) => x.outcome !== 'pass')));
    assert.equal(ss.report.mode, 'snapshot-vs-snapshot');
    assert.equal(ss.report.summary.pass, FIXTURE_ENTRIES.length);
  } finally { await site.close(); }

  const changed = await startSite({ title: 'Changed', sitemapExtra: '  <url><loc>https://www.micronshub.eu/en/blog/new</loc></url>\n' });
  try {
    const sl = await run(['--snapshot', A, '--candidate', changed.origin, '--out', path.join(dir, 'sl'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(sl.code, 1);
    assert.equal(sl.report.mode, 'snapshot-vs-live');
    assert.equal(sl.report.results.find((x) => x.id === 'G1-001').outcome, 'fail');
    // Snapshot mode: a new sitemap <loc> is listed, not compared (§2.4).
    assert.equal(sl.report.results.find((x) => x.id === 'G5-001').outcome, 'pass');
    assert.deepEqual(sl.report.new_urls, ['https://www.micronshub.eu/en/blog/new']);
  } finally { await changed.close(); }
});

test('database-backed difference that disappears on the re-check → transient', async () => {
  const base = await startSite();
  // Candidate serves a stale title on its first /en GET, then the right one.
  const cand = await startSite({ titleSequence: ['Stale cached title', 'Microns Hub — On-demand manufacturing'] });
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'out'), '--allow', writeAllow(dir), '--recheck-after', '1']);
    assert.equal(r.code, 0, JSON.stringify(r.report.results));
    const res = r.report.results[0];
    assert.equal(res.outcome, 'transient');
    assert.equal(res.recheck, 'equal after 1 s');
  } finally { await base.close(); await cand.close(); }
});

test('database-backed difference that stays → fail after the re-check', async () => {
  const base = await startSite();
  const cand = await startSite({ title: 'Still different' });
  const dir = tmpDir();
  const entries = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  try {
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'out'), '--allow', writeAllow(dir), '--recheck-after', '1']);
    assert.equal(r.code, 1);
    assert.equal(r.report.results[0].recheck, 'still different after 1 s');
  } finally { await base.close(); await cand.close(); }
});

test('preview candidate: apex and wildcard variants are not-applicable and never requested', async () => {
  const base = await startSite();
  const cand = await startSite({ robotsTag: 'noindex' });
  const dir = tmpDir();
  const entries = [{ id: 'G9-016', group: 'G9', url: 'https://micronshub.eu/', methods: ['GET', 'HEAD'], kind: 'variant', na_preview: 'S13', profiles: ['gate', 'full'] }];
  try {
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--candidate-role', 'preview', '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'out'), '--allow', writeAllow(dir)]);
    assert.equal(r.code, 0);
    assert.equal(r.report.summary.not_applicable, 1);
    assert.equal(base.requests.length + cand.requests.length, 0);
  } finally { await base.close(); await cand.close(); }
});

test('entry script runs as a subprocess (--help → exit 0)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { REPO_ROOT } = await import('../lib/cli.mjs');
  const p = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'seo-parity.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /Exit codes/);
  const bad = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'seo-parity.mjs'), '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
