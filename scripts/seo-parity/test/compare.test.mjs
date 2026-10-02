import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startSite, tmpDir, writeUrls, writeAllow, run, diffsOf, FIXTURE_ENTRIES } from './helpers.mjs';

async function pair(baseOpts = {}, candOpts = {}, extraArgs = [], entries = FIXTURE_ENTRIES) {
  const base = await startSite(baseOpts);
  const cand = await startSite(candOpts);
  const dir = tmpDir();
  const urls = writeUrls(dir, entries);
  const allow = extraArgs.includes('--allow') ? [] : ['--allow', writeAllow(dir)];
  const out = path.join(dir, 'out');
  try {
    const r = await run(['--base', base.origin, '--candidate', cand.origin, '--urls', urls, '--out', out, '--recheck-after', '0', ...allow, ...extraArgs]);
    return { ...r, base, cand, dir, out };
  } finally {
    await base.close();
    await cand.close();
  }
}

const fields = (report, id) => diffsOf(report, id).map((d) => d.field + (d.sub ? `:${d.sub}` : ''));

test('identical hosts → exit 0, every entry passes', async () => {
  const r = await pair();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.report.summary.pass, FIXTURE_ENTRIES.length);
  assert.equal(r.report.summary.fail, 0);
  assert.equal(r.report.valid, true);
});

test('changed title → fail (F14)', async () => {
  const r = await pair({}, { title: 'Other title' });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F14'));
  assert.ok(r.report.results.find((x) => x.id === 'G1-001').diff_file, 'diff file written');
});

test('changed canonical → fail (F16)', async () => {
  const r = await pair({}, { canonical: 'https://www.micronshub.eu/en/' });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F16'));
});

test('hreflang order → pass (order-insensitive)', async () => {
  const r = await pair({}, { hreflangReversed: true });
  assert.equal(r.code, 0, JSON.stringify(diffsOf(r.report, 'G1-001')));
});

test('JSON-LD key order → pass (canonical JSON)', async () => {
  const r = await pair({}, { jsonldReordered: true });
  assert.equal(r.code, 0, JSON.stringify(diffsOf(r.report, 'G1-001')));
});

test('missing header → fail (F11, deny by default)', async () => {
  const r = await pair({}, { dropHeader: 'x-content-type-options' });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F11:x-content-type-options'));
  assert.ok(fields(r.report, 'G1-001').includes('F4:F11:x-content-type-options'), 'HEAD checked too');
});

test('extra header → fail (F11, deny by default)', async () => {
  const r = await pair({}, { extraHeader: ['speculation-rules', '"/cdn-cgi/speculation"'] });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F11:speculation-rules'));
});

test('ignored headers (date, cf-ray, x-vercel-id) never fail', async () => {
  const r = await pair({ extraHeader: ['x-vercel-id', 'fra1::abc'] }, { extraHeader: ['cf-ray', '123-FRA'] });
  assert.equal(r.code, 0, JSON.stringify(r.report.results.filter((x) => x.outcome !== 'pass')));
});

test('status difference → fail (F1)', async () => {
  const r = await pair({}, { enStatus: 404 });
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F1'));
  assert.ok(fields(r.report, 'G1-001').includes('F4:status'));
});

test('redirect Location difference → fail (F2, F3)', async () => {
  const r = await pair({}, { redirectTo: '/robots.txt' });
  assert.equal(r.code, 1);
  const f = fields(r.report, 'G6-001');
  assert.ok(f.includes('F2') && f.includes('F3'), f.join());
});

test('F2 origin normalisation: candidate origin is replaced by the base origin', async () => {
  const { originNormaliser } = await import('../lib/compare.mjs');
  const n = originNormaliser('https://www.micronshub.eu', 'https://microns-site.x.workers.dev');
  assert.equal(n('candidate', 'https://microns-site.x.workers.dev/de/angebot'), 'https://www.micronshub.eu/de/angebot');
  assert.equal(n('base', 'https://microns-site.x.workers.dev/de/angebot'), 'https://microns-site.x.workers.dev/de/angebot');
  assert.equal(n('candidate', 'https://example.org/x'), 'https://example.org/x');
});

test('HEAD body non-empty → fail (F4 body)', async () => {
  const r = await pair({}, { headBody: true });
  assert.equal(r.code, 1);
  const d = diffsOf(r.report, 'G1-001').find((x) => x.field === 'F4' && x.sub === 'body');
  assert.ok(d, JSON.stringify(diffsOf(r.report, 'G1-001')));
  assert.ok(d.candidate > 0);
});

test('X-Robots-Tag, preview role: candidate noindex passes, missing fails', async () => {
  const ok = await pair({}, { robotsTag: 'noindex' }, ['--candidate-role', 'preview']);
  assert.equal(ok.code, 0, JSON.stringify(ok.report.results.filter((x) => x.outcome !== 'pass')));
  const missing = await pair({}, {}, ['--candidate-role', 'preview']);
  assert.equal(missing.code, 1);
  assert.ok(fields(missing.report, 'G1-001').includes('F10'));
  const wrong = await pair({}, { robotsTag: 'noindex, nofollow' }, ['--candidate-role', 'preview']);
  assert.equal(wrong.code, 1);
});

test('X-Robots-Tag, production role: must equal the base', async () => {
  const r = await pair({}, { robotsTag: 'noindex' }, ['--candidate-role', 'production']);
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F10'));
  const same = await pair({}, {}, ['--candidate-role', 'production']);
  assert.equal(same.code, 0);
});

test('__cf_bm cookie on a production candidate → fail', async () => {
  const r = await pair({}, { cfBm: true }, ['--candidate-role', 'production']);
  assert.equal(r.code, 1);
  assert.ok(fields(r.report, 'G1-001').includes('F11:__cf_bm'));
});

test('sitemap byte difference → F24 and parsed F26 detail', async () => {
  const extra = '  <url><loc>https://www.micronshub.eu/en/blog/new</loc><lastmod>2026-10-02</lastmod></url>\n';
  const r = await pair({}, { sitemapExtra: extra });
  assert.equal(r.code, 1);
  const f = fields(r.report, 'G5-001');
  assert.ok(f.includes('F24') && f.includes('F26:loc-added'), f.join());
});

test('challenge 429 + x-vercel-mitigated from the base → exit 3 (invalid run)', async () => {
  const r = await pair({ challenge: true }, {});
  assert.equal(r.code, 3);
  assert.equal(r.report.valid, false);
  assert.match(r.report.invalid_reasons.join(), /challenge/);
});

test('unreachable candidate → errors above 0.5 % → exit 3', async () => {
  const base = await startSite();
  const dir = tmpDir();
  try {
    const r = await run(['--base', base.origin, '--candidate', 'http://127.0.0.1:9', '--urls', writeUrls(dir), '--out', path.join(dir, 'out'), '--allow', writeAllow(dir), '--recheck-after', '0']);
    assert.equal(r.code, 3);
    assert.equal(r.report.summary.error, FIXTURE_ENTRIES.length);
  } finally { await base.close(); }
});

test('usage errors → exit 2', async () => {
  assert.equal((await run(['--base', 'https://x.example'])).code, 2);
  assert.equal((await run(['--candidate', 'https://x.example', '--base', 'not a url', '--urls', 'x'])).code, 2);
  assert.equal((await run(['--bogus-flag'])).code, 2);
});

test('asset hash drift: fails by default, passes with --normalise-asset-hashes and lists the pair', async () => {
  const strict = await pair({}, { assetHash: 'ZzYyXx99' });
  assert.equal(strict.code, 1);
  assert.ok(fields(strict.report, 'G1-001').includes('F25'));
  const loose = await pair({}, { assetHash: 'ZzYyXx99' }, ['--normalise-asset-hashes']);
  assert.equal(loose.code, 0, JSON.stringify(diffsOf(loose.report, 'G1-001')));
  assert.deepEqual(loose.report.asset_hash_pairs, [['/assets/index-AbCdEf12.js', '/assets/index-ZzYyXx99.js']]);
});
