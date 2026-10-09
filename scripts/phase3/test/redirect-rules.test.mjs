import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { APEX, WWW, buildRuleset, deriveFromBaseline, hstsAdvice } from '../redirect-rules.mjs';

const CLI = fileURLToPath(new URL('../redirect-rules.mjs', import.meta.url));
const PAYLOADS = fileURLToPath(new URL('../payloads/', import.meta.url));
const SEO_PARITY = new URL('../../seo-parity/lib/', import.meta.url);
const hop = (url, status, location, headers = {}) => ({ url, status, location, headers });

/**
 * A baseline in the shape scripts/seo-parity writes it: one GET record per entry, keyed by the entry URL. Host
 * variants are absolute URLs; pages of the base host (www) are keyed by their path. `httpApex` is the chain of
 * http://micronshub.eu/en: 'captured' = HTTPS first as a capture with base https://www.micronshub.eu records it (the
 * hop to https://micronshub.eu is another origin, so the chain stops there), 'followed' = HTTPS first with every hop
 * recorded, 'apex-first' = straight to https://www.
 */
function baseline({ apex = 308, http = 308, httpApex = 'captured', hsts = 'max-age=63072000' } = {}) {
  const m = new Map();
  const sts = hsts ? { 'strict-transport-security': hsts } : {};
  const apexCase = (from, to) => m.set(from, { hops: [hop(from, apex, to, sts), hop(to, 200, null, sts)] });
  apexCase('https://micronshub.eu/', 'https://www.micronshub.eu/');
  apexCase('https://micronshub.eu/en/services', 'https://www.micronshub.eu/en/services');
  apexCase('https://micronshub.eu/logo.png', 'https://www.micronshub.eu/logo.png');
  m.set('https://micronshub.eu/api/marketing?action=track&parity=1', { hops: [hop('https://micronshub.eu/api/marketing?action=track&parity=1', apex, 'https://www.micronshub.eu/api/marketing?action=track&parity=1')] });
  m.set('http://www.micronshub.eu/en', { hops: [hop('http://www.micronshub.eu/en', http, 'https://www.micronshub.eu/en'), hop('https://www.micronshub.eu/en', 200, null, sts)] });
  const chains = {
    captured: [hop('http://micronshub.eu/en', http, 'https://micronshub.eu/en')],
    followed: [hop('http://micronshub.eu/en', http, 'https://micronshub.eu/en'), hop('https://micronshub.eu/en', apex, 'https://www.micronshub.eu/en', sts), hop('https://www.micronshub.eu/en', 200, null, sts)],
    'apex-first': [hop('http://micronshub.eu/en', apex, 'https://www.micronshub.eu/en'), hop('https://www.micronshub.eu/en', 200, null, sts)],
  };
  m.set('http://micronshub.eu/en', { hops: chains[httpApex] });
  m.set('/en', { hops: [hop('https://www.micronshub.eu/en', 200, null, sts)] });
  m.set('https://laserkritis.micronshub.eu/en', { hops: [hop('https://laserkritis.micronshub.eu/en', 200, null)] });
  return m;
}

/**
 * A baseline snapshot written by the seo-parity capture itself (captureSide + SnapshotWriter with base
 * https://www.micronshub.eu, SEO_PARITY.md B5) against a stub client that answers like the platform redirects:
 * `order` 'https-first' (HTTP -> HTTPS on the same host, then apex -> www) or 'apex-first' (http://apex straight to
 * https://www). No network.
 */
async function captureBaseline(dir, { order, apex = 308, http = 308, hsts = 'max-age=63072000' }) {
  let run;
  let snapshot;
  try {
    run = await import(new URL('run.mjs', SEO_PARITY).href);
    snapshot = await import(new URL('snapshot.mjs', SEO_PARITY).href);
  } catch (e) {
    assert.fail(`scripts/seo-parity needs its dependencies (npm --prefix scripts/seo-parity ci): ${e.message}`);
  }
  const res = (status, headers = {}, body = '') => ({ response: { status, headers, setCookies: [], body: Buffer.from(body), wireLength: body.length, decodeError: null }, attempts: 1 });
  const client = {
    async send(url) {
      const u = new URL(url);
      const rest = `${u.pathname}${u.search}`;
      if (u.protocol === 'http:') {
        if (order === 'apex-first' && u.hostname === APEX) return res(apex, { location: `https://${WWW}${rest}` });
        return res(http, { location: `https://${u.host}${rest}` });
      }
      if (u.hostname === APEX) return res(apex, { location: `https://${WWW}${rest}`, 'strict-transport-security': hsts });
      return res(200, { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': hsts }, '<!doctype html><html><head><title>x</title></head><body></body></html>');
    },
  };
  const base = `https://${WWW}`;
  const urls = [
    '/en', 'https://micronshub.eu/', 'https://micronshub.eu/en/services', 'https://micronshub.eu/logo.png',
    'https://micronshub.eu/api/marketing?action=track&parity=1', 'http://www.micronshub.eu/en', 'http://micronshub.eu/en',
    'https://laserkritis.micronshub.eu/en',
  ];
  const w = new snapshot.SnapshotWriter(dir);
  for (const [i, url] of urls.entries()) {
    const entry = { id: `G9-${i + 1}`, url, methods: ['GET', 'HEAD'] };
    w.writeEntry(entry, await run.captureSide(entry, { client, origin: base, baseOrigin: base, side: 'base', maxHops: 5, store: w.store }));
  }
  await w.close({ base });
}

test('HTTPS-first baseline, captured (one hop) or followed (both hops): HTTP rule first, statuses copied, raw path, query kept, HSTS read from the www page', () => {
  for (const httpApex of ['captured', 'followed']) {
    const d = deriveFromBaseline(baseline({ apex: 307, http: 308, httpApex }));
    assert.deepEqual(d.problems, [], httpApex);
    assert.equal(d.order, 'https-first', httpApex);
    assert.equal(d.apexStatus, 307);
    assert.equal(d.httpStatus, 308);
    assert.deepEqual(d.hsts, { www: 'max-age=63072000', apexRedirect: 'max-age=63072000', tenant: null });
    const rs = buildRuleset(d);
    assert.deepEqual(rs.rules.map((r) => r.ref), ['microns_http_to_https', 'microns_apex_to_www']);
    assert.equal(rs.rules[1].action_parameters.from_value.status_code, 307);
    assert.equal(rs.rules[0].action_parameters.from_value.status_code, 308);
    assert.equal(rs.rules[0].expression, '(not ssl)');
    assert.equal(rs.rules[1].expression, '(http.host eq "micronshub.eu")');
    assert.match(rs.rules[1].action_parameters.from_value.target_url.expression, /raw\.http\.request\.uri\.path/);
    assert.ok(rs.rules.every((r) => r.action_parameters.from_value.preserve_query_string === true));
  }
});

test('one-hop baseline: apex rule first so http://apex goes straight to https://www', () => {
  const d = deriveFromBaseline(baseline({ httpApex: 'apex-first', hsts: null }));
  assert.deepEqual(d.problems, []);
  assert.equal(d.order, 'apex-first');
  assert.deepEqual(d.hsts, { www: null, apexRedirect: null, tenant: null });
  assert.deepEqual(buildRuleset(d).rules.map((r) => r.ref), ['microns_apex_to_www', 'microns_http_to_https']);
});

test('problems: every contradiction of the baseline is reported (missing, failed or non-redirecting variants, targets, statuses, hop order, www page)', () => {
  const m = baseline();
  m.delete('http://www.micronshub.eu/en');
  m.set('https://micronshub.eu/en/services', { hops: [hop('https://micronshub.eu/en/services', 308, 'https://www.micronshub.eu/')] });
  m.set('https://micronshub.eu/logo.png', { hops: [hop('https://micronshub.eu/logo.png', 303, 'https://www.micronshub.eu/logo.png')] });
  const d = deriveFromBaseline(m);
  assert.ok(d.problems.some((p) => /no GET record for http:\/\/www/.test(p)));
  assert.ok(d.problems.some((p) => /expected https:\/\/www\.micronshub\.eu\/en\/services/.test(p)));
  assert.ok(d.problems.some((p) => /several statuses/.test(p)));
  assert.ok(d.problems.some((p) => /303 is not available/.test(p)));
  assert.ok(!d.problems.some((p) => /HSTS on www unknown/.test(p)));
  m.delete('/en');
  assert.ok(deriveFromBaseline(m).problems.some((p) => /HSTS on www unknown/.test(p)));

  // One contradiction per baseline, with the exact report line.
  const only = (opts, change) => { const b = baseline(opts); change(b); return deriveFromBaseline(b).problems; };
  const chain = (url, ...hops) => (b) => b.set(url, { hops });
  assert.deepEqual(only({}, chain('http://micronshub.eu/en', hop('http://micronshub.eu/en', 308, 'https://example.test/en'))),
    ['http://micronshub.eu/en chain 308 https://example.test/en matches neither hop order']);
  assert.deepEqual(only({}, chain('http://micronshub.eu/en', hop('http://micronshub.eu/en', 308, 'https://micronshub.eu/en'), hop('https://micronshub.eu/en', 308, 'https://micronshub.eu/en/'))),
    ['http://micronshub.eu/en chain 308 https://micronshub.eu/en -> 308 https://micronshub.eu/en/ matches neither hop order']);
  assert.deepEqual(only({}, chain('https://micronshub.eu/', hop('https://micronshub.eu/', 200, null))), ['https://micronshub.eu/ did not redirect']);
  assert.deepEqual(only({}, (b) => b.set('https://micronshub.eu/logo.png', { hops: [], error: 'https://micronshub.eu/logo.png: timeout', stop: 'error' })),
    ['baseline GET https://micronshub.eu/logo.png failed: https://micronshub.eu/logo.png: timeout']);
  assert.deepEqual(only({}, chain('http://www.micronshub.eu/en', hop('http://www.micronshub.eu/en', 308, 'https://www.micronshub.eu/'))),
    ['http://www.micronshub.eu/en -> https://www.micronshub.eu/, expected https://www.micronshub.eu/en']);
  assert.deepEqual(only({}, chain('http://www.micronshub.eu/en', hop('http://www.micronshub.eu/en', 200, null))), ['http://www.micronshub.eu/en did not redirect']);
  assert.deepEqual(only({}, chain('http://micronshub.eu/en', hop('http://micronshub.eu/en', 200, null))), ['http://micronshub.eu/en did not redirect']);
  // Each hop of http://apex must carry the status of the rule that answers it.
  assert.deepEqual(only({}, chain('http://micronshub.eu/en', hop('http://micronshub.eu/en', 301, 'https://micronshub.eu/en'))),
    ['HTTP -> HTTPS status differs between hosts (301 vs 308)']);
  assert.deepEqual(only({ httpApex: 'followed' }, (b) => { b.get('http://micronshub.eu/en').hops[1].status = 301; }),
    ['https://micronshub.eu/en answered 301, the other apex redirects 308']);
  assert.deepEqual(only({ httpApex: 'apex-first' }, (b) => { b.get('http://micronshub.eu/en').hops[0].status = 301; }),
    ['http://micronshub.eu/en answered 301 straight to www, the apex redirects 308']);

  // HSTS of the www page comes from the page itself, never from a redirect hop for the same URL.
  const viaRedirect = new Map([['https://www.micronshub.eu/en?redirected', { hops: [hop('https://www.micronshub.eu/en', 308, 'https://www.micronshub.eu/en/', { 'strict-transport-security': 'max-age=1' })] }], ...baseline()]);
  assert.equal(deriveFromBaseline(viaRedirect).hsts.www, 'max-age=63072000');
  const onlyRedirect = baseline();
  onlyRedirect.set('/en', { hops: [hop('https://www.micronshub.eu/en', 308, 'https://www.micronshub.eu/en/', { 'strict-transport-security': 'max-age=1' })] });
  onlyRedirect.get('http://www.micronshub.eu/en').hops.pop();
  assert.deepEqual(deriveFromBaseline(onlyRedirect).problems, ['baseline has no answer for https://www.micronshub.eu/en (HSTS on www unknown)']);
});

test('HSTS advice: www only -> Worker var; several hosts -> zone setting; none -> none', () => {
  assert.equal(hstsAdvice({ www: 'max-age=1', apexRedirect: null, tenant: null }).mode, 'worker');
  assert.equal(hstsAdvice({ www: 'max-age=1', apexRedirect: null, tenant: null }).value, 'max-age=1');
  assert.equal(hstsAdvice({ www: 'max-age=1', apexRedirect: 'max-age=1', tenant: null }).mode, 'zone');
  assert.equal(hstsAdvice({ www: null, apexRedirect: null, tenant: null }).mode, 'none');
});

test('CLI: a snapshot written by the seo-parity capture gives the payload in either hop order; a contradiction exits 1; --default; usage errors exit 64', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rr-'));
  const out = path.join(dir, 'rules.json');
  assert.equal(spawnSync(process.execPath, [CLI, '--default', '--out', out]).status, 0);
  const cases = [
    { order: 'https-first', apex: 307, http: 308, rules: [['microns_http_to_https', 308], ['microns_apex_to_www', 307]] },
    { order: 'https-first', apex: 301, http: 301, rules: [['microns_http_to_https', 301], ['microns_apex_to_www', 301]] },
    { order: 'apex-first', apex: 308, http: 301, rules: [['microns_apex_to_www', 308], ['microns_http_to_https', 301]] },
  ];
  for (const c of cases) {
    const snap = path.join(dir, `${c.order}-${c.apex}-${c.http}`);
    await captureBaseline(snap, c);
    const r = spawnSync(process.execPath, [CLI, '--baseline', snap, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`^apex ${c.apex}, http ${c.http}, order ${c.order}$`, 'm'));
    assert.match(r.stderr, /^HSTS: zone = max-age=63072000;/m);
    assert.doesNotMatch(r.stderr, /^problem:/m);
    const rules = JSON.parse(readFileSync(out, 'utf8')).rules;
    assert.deepEqual(rules.map((x) => [x.ref, x.action_parameters.from_value.status_code]), c.rules);
  }
  // A baseline that contradicts the rules: the report names it and the exit code is 1.
  const bad = path.join(dir, 'bad');
  mkdirSync(bad);
  const lines = [...baseline()].map(([url, rec]) => JSON.stringify({ entry_id: url, url, method: 'GET', ...(url === 'https://micronshub.eu/' ? { hops: [hop(url, 200, null)] } : rec) }));
  writeFileSync(path.join(bad, 'results.ndjson'), `${lines.join('\n')}\n`);
  const r = spawnSync(process.execPath, [CLI, '--baseline', bad, '--out', path.join(bad, 'rules.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^problem: https:\/\/micronshub\.eu\/ did not redirect$/m);
  // Started through a symlinked path, the CLI still runs and still exits 1 on the contradiction.
  const linked = path.join(dir, 'linked-scripts');
  symlinkSync(path.dirname(CLI), linked, 'dir');
  const viaLink = spawnSync(process.execPath, [path.join(linked, path.basename(CLI)), '--baseline', bad, '--out', path.join(bad, 'rules-link.json')], { encoding: 'utf8' });
  assert.equal(viaLink.status, 1, viaLink.stderr);
  assert.match(viaLink.stderr, /^problem: https:\/\/micronshub\.eu\/ did not redirect$/m);
  const norm = spawnSync(process.execPath, [CLI, '--default', '--path-field', 'normalised'], { encoding: 'utf8' });
  assert.equal(norm.status, 0, norm.stderr);
  const targets = JSON.parse(norm.stdout).rules.map((x) => x.action_parameters.from_value.target_url.expression);
  assert.deepEqual(targets, ['concat("https://", http.host, http.request.uri.path)', 'concat("https://www.micronshub.eu", http.request.uri.path)']);
  assert.equal(spawnSync(process.execPath, [CLI, '--default', '--path-field', 'other']).status, 64);
  assert.equal(spawnSync(process.execPath, [CLI]).status, 64);
  assert.equal(spawnSync(process.execPath, [CLI, '--default', '--baseline', dir]).status, 64);
  assert.equal(spawnSync(process.execPath, [CLI, '--baseline', path.join(dir, 'missing')]).status, 64);
});

test('committed payloads: the redirect default equals the generator; the zone routes are the three Worker-less routes', () => {
  const gen = spawnSync(process.execPath, [CLI, '--default'], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  assert.equal(readFileSync(path.join(PAYLOADS, 'redirect-rules.default.json'), 'utf8'), gen.stdout);
  const zr = JSON.parse(readFileSync(path.join(PAYLOADS, 'zone-routes.json'), 'utf8'));
  assert.deepEqual(zr.routes.map((r) => r.pattern), ['cad-vps.micronshub.eu/*', 'files.micronshub.eu/*', 'mcp.micronshub.eu/*']);
  assert.ok(zr.routes.every((r) => !('script' in r) && /^[a-z0-9-]+\.micronshub\.eu\/\*$/.test(r.pattern)));
  assert.equal(typeof zr.rule, 'string');
  assert.match(zr.rule, /before its DNS record is proxied/);
});
