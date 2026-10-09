// End-to-end diff runs with in-memory and injected-transport sources. No network: every ns:/doh: source gets a
// fake udp/tcp/fetch built from a zone model and encodeResponse().
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { outcome, compareOutcomes } from '../lib/compare.mjs';
import { buildNameList, runParity } from '../lib/run.mjs';
import { openSource } from '../lib/sources.mjs';
import { TYPES } from '../lib/types.mjs';
import { decodeMessage, encodeResponse } from '../lib/wire.mjs';
import { parseZone } from '../lib/zonefile.mjs';
import { ZoneModel } from '../lib/zonesim.mjs';

const fx = (f) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));
const CLI = fileURLToPath(new URL('../../dns-parity.mjs', import.meta.url));
const README = fileURLToPath(new URL('../README.md', import.meta.url));
const ZONE = 'micronshub.eu';

/** The Cloudflare API export after S12-S14: www, the apex and the wildcard are proxied placeholders, every other record as before. */
function flippedExport() {
  const doc = JSON.parse(readFileSync(fx('cloudflare.json'), 'utf8'));
  const flip = (name, type, content) => Object.assign(doc.result.find((r) => r.name === name && ['A', 'CNAME'].includes(r.type)), { type, content, proxied: true });
  flip('www.micronshub.eu', 'AAAA', '100::');
  flip('micronshub.eu', 'A', '192.0.2.1');
  flip('*.micronshub.eu', 'AAAA', '100::');
  return doc;
}

/** A fake authoritative server: answers from a zone file through the wire codec. */
function fakeServer(file, { aa = true, truncateUdp = false, fail = null } = {}) {
  const model = new ZoneModel(parseZone(readFileSync(file), { origin: ZONE }), 'rfc4592');
  const calls = { udp: 0, tcp: 0 };
  const respond = (buf, viaTcp) => {
    const q = decodeMessage(buf);
    const question = q.question[0];
    if (fail && fail(question)) return Promise.reject(new Error('timeout after 3000 ms'));
    const a = model.answer(question.name, question.type);
    const tc = truncateUdp && !viaTcp;
    return Promise.resolve(encodeResponse({
      id: q.id, aa, tc, rcode: a.status === 'NXDOMAIN' ? 3 : 0, question,
      answer: tc ? [] : a.rrs.map((r) => ({ ...r })),
    }));
  };
  return {
    calls,
    udp: (buf) => { calls.udp += 1; return respond(buf, false); },
    tcp: (buf) => { calls.tcp += 1; return respond(buf, true); },
    lookup: async () => '192.0.2.53',
  };
}

test('name list: defaults, probes, owners and empty non-terminals of enumerable sources; infra excluded', () => {
  const s = openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE });
  const list = buildNameList({ zone: ZONE, probeSeed: 'fixed', sources: [s] });
  const names = list.map((e) => e.name);
  for (const n of ['micronshub.eu', 'www.micronshub.eu', '*.micronshub.eu', 'resend._domainkey.micronshub.eu', '_domainkey.micronshub.eu', 'send.micronshub.eu', 'laserkritis.micronshub.eu']) {
    assert.ok(names.includes(n), n);
  }
  assert.ok(names.some((n) => /^zz-dnsparity-[0-9a-f]{8}\.micronshub\.eu$/.test(n)));
  const apex = list.find((e) => e.name === ZONE);
  assert.ok(!apex.types.includes(TYPES.NS) && !apex.types.includes(TYPES.SOA));
  const withInfra = buildNameList({ zone: ZONE, sources: [s], includeInfra: true }).find((e) => e.name === ZONE);
  assert.ok(withInfra.types.includes(TYPES.NS) && withInfra.types.includes(TYPES.SOA));
  // the same seed gives the same probes
  assert.deepEqual(buildNameList({ zone: ZONE, probeSeed: 'fixed' }).map((e) => e.name), buildNameList({ zone: ZONE, probeSeed: 'fixed' }).map((e) => e.name));
});

test('zone export vs Cloudflare API export: equal, the empty non-terminal reported as expected (exit 0)', async () => {
  const r = await runParity({ zone: ZONE, a: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), b: openSource(`cfapi:${fx('cloudflare.json')}`, { zone: ZONE }), probeSeed: 'fixed' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.counts.DIFF, undefined);
  assert.ok(r.rows.filter((x) => x.status === 'EXPECTED_ENT').every((x) => x.rel === '_domainkey' || x.rel === 'x._domainkey'));
});

test('drift: missing MX, changed SPF, record added by the scan, proxied www (exit 1)', async () => {
  const r = await runParity({ zone: ZONE, a: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), b: openSource(`cfapi:${fx('cloudflare-drift.json')}`, { zone: ZONE }), expectDnsOnly: true });
  assert.equal(r.exitCode, 1);
  const diff = (rel, type) => r.rows.find((x) => x.rel === rel && x.type === type && x.status === 'DIFF');
  assert.ok(diff('@', 'MX'));
  assert.ok(diff('@', 'TXT'));
  assert.ok(diff('ftp', 'A'));
  assert.ok(diff('www', 'A'));
  assert.ok(r.rows.some((x) => x.status === 'DIFF' && /--expect-dns-only/.test(x.reason)));
});

test('allow-list turns a listed difference into ALLOWED; an expired entry does not', async () => {
  const base = { zone: ZONE, a: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), b: openSource(`cfapi:${fx('cloudflare-drift.json')}`, { zone: ZONE }), defaultNames: false, names: [{ name: '@', types: ['TXT'] }] };
  const allow = [{ id: 'DNS-AL-1', name: '@', type: 'TXT', reason: 'SPF hardened on purpose', expires: '2099-01-01' }];
  const r = await runParity({ ...base, allow });
  const row = r.rows.find((x) => x.rel === '@' && x.type === 'TXT');
  assert.equal(row.status, 'ALLOWED');
  assert.equal(row.was, 'DIFF');
  const expired = await runParity({ ...base, allow: [{ ...allow[0], expires: '2000-01-01' }] });
  assert.equal(expired.rows.find((x) => x.rel === '@' && x.type === 'TXT').status, 'DIFF');
});

test('ns: source over a fake server: UDP, TCP after TC, AA required', async () => {
  const srv = fakeServer(fx('papaki.zone'), { truncateUdp: true });
  const ns = openSource('ns:dns1.example.test', { zone: ZONE, ...srv });
  const a = await ns.query('micronshub.eu', TYPES.MX);
  assert.equal(srv.calls.udp, 1);
  assert.equal(srv.calls.tcp, 1);
  assert.equal(outcome(a, 'micronshub.eu', TYPES.MX).values.length, 5);
  const nonAuth = openSource('ns:dns1.example.test', { zone: ZONE, ...fakeServer(fx('papaki.zone'), { aa: false }) });
  const b = await nonAuth.query('micronshub.eu', TYPES.A);
  assert.equal(b.status, 'ERROR');
  assert.match(b.error, /not authoritative/);
});

test('ns: vs zone: equal; one timeout makes the run incomplete (exit 2)', async () => {
  const good = await runParity({ zone: ZONE, a: openSource('ns:dns1.example.test', { zone: ZONE, ...fakeServer(fx('papaki.zone')) }), b: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), probeSeed: 'fixed' });
  assert.equal(good.exitCode, 0);
  const flaky = fakeServer(fx('papaki.zone'), { fail: (q) => q.name === 'send.micronshub.eu' && q.type === TYPES.TXT });
  const bad = await runParity({ zone: ZONE, a: openSource('ns:dns1.example.test', { zone: ZONE, retries: 1, ...flaky }), b: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), probeSeed: 'fixed' });
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.rows.find((x) => x.rel === 'send' && x.type === 'TXT').status, 'ERROR');
});

test('doh: source: RFC 8484 GET with base64url, recursive chain kept out of the comparison', async () => {
  let seen = null;
  const fetch = async (url, init) => {
    seen = { url, accept: init.headers.accept };
    const q = decodeMessage(Buffer.from(new URL(url).searchParams.get('dns'), 'base64url'));
    const body = encodeResponse({ id: q.id, aa: false, ra: true, rd: true, question: q.question[0], answer: [
      { name: 'www.micronshub.eu', type: TYPES.CNAME, rdata: { target: '3096eb4eb748a48f.vercel-dns-017.com' } },
      { name: '3096eb4eb748a48f.vercel-dns-017.com', type: TYPES.A, rdata: { address: '64.29.17.65' } },
    ] });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/dns-message' } });
  };
  const doh = openSource('doh:cloudflare', { zone: ZONE, fetch });
  const ans = await doh.query('www.micronshub.eu', TYPES.A);
  assert.match(seen.url, /^https:\/\/cloudflare-dns\.com\/dns-query\?dns=[A-Za-z0-9_-]+$/);
  assert.equal(seen.accept, 'application/dns-message');
  assert.deepEqual(outcome(ans, 'www.micronshub.eu', TYPES.A).values, ['CNAME 3096eb4eb748a48f.vercel-dns-017.com']);
  assert.equal(outcome(ans, 'www.micronshub.eu', TYPES.A, { follow: true }).values.length, 2);
});

test('capture source: lossy prefix comparison of a cut DKIM value, EMPTY matches NODATA, missing questions skipped', async () => {
  const r = await runParity({ zone: ZONE, a: openSource(`capture:${fx('capture.txt')}`, { zone: ZONE }), b: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), defaultNames: false, names: [
    { name: 'resend._domainkey', types: ['TXT'] }, { name: 'send', types: ['MX', 'TXT'] }, { name: '@', types: ['A', 'AAAA', 'MX', 'CAA'] }, { name: 'www', types: ['A', 'CNAME'] },
  ] });
  const st = (rel, type) => r.rows.find((x) => x.rel === rel && x.type === type).status;
  assert.equal(st('resend._domainkey', 'TXT'), 'MATCH');
  assert.equal(st('send', 'MX'), 'MATCH');
  assert.equal(st('@', 'AAAA'), 'MATCH');
  assert.equal(st('@', 'CAA'), 'SKIPPED');
  assert.equal(st('www', 'A'), 'MATCH');
  assert.equal(r.exitCode, 0);
});

test('comparison rules: TTL ignored by default, exact and max on request; TXT chunks; case and trailing dot', () => {
  const rr = (ttl, strings) => ({ status: 'NOERROR', rrs: [{ name: 'a.example.test', type: TYPES.TXT, ttl, rdata: { strings } }] });
  const o1 = outcome(rr(3600, ['ab', 'c']), 'A.Example.Test.', TYPES.TXT);
  const o2 = outcome(rr(300, ['abc']), 'a.example.test', TYPES.TXT);
  assert.equal(compareOutcomes(o1, o2, { qtype: TYPES.TXT, ttl: 'ignore' }).status, 'MATCH');
  assert.equal(compareOutcomes(o1, o2, { qtype: TYPES.TXT, ttl: 'exact' }).status, 'TTL_DIFF');
  assert.equal(compareOutcomes(o1, o2, { qtype: TYPES.TXT, ttl: 300 }).status, 'TTL_DIFF');
  const c1 = outcome(rr(1, ['ab', 'c']), 'a.example.test', TYPES.TXT, { txt: 'chunks' });
  const c2 = outcome(rr(1, ['abc']), 'a.example.test', TYPES.TXT, { txt: 'chunks' });
  assert.equal(compareOutcomes(c1, c2, { qtype: TYPES.TXT }).status, 'DIFF');
  const nx = outcome({ status: 'NXDOMAIN', rrs: [] }, 'x', TYPES.A);
  const nodata = outcome({ status: 'NOERROR', rrs: [] }, 'x', TYPES.A);
  assert.equal(compareOutcomes(nx, nodata, { qtype: TYPES.A }).status, 'DIFF');
});

test('after the flip: --expect-proxied accepts Cloudflare answers for the listed names only; other types of a flipped CNAME pass', async () => {
  const live = outcome({ status: 'NOERROR', rrs: [{ name: 'www.micronshub.eu', type: TYPES.A, ttl: 300, rdata: { address: '104.21.0.1' } }] }, 'www.micronshub.eu', TYPES.A);
  const before = outcome({ status: 'NOERROR', rrs: [{ name: 'www.micronshub.eu', type: TYPES.CNAME, ttl: 300, rdata: { target: 'x.vercel-dns-017.com' } }] }, 'www.micronshub.eu', TYPES.A);
  assert.equal(compareOutcomes(before, live, { qtype: TYPES.A, expectProxied: true, proxiedSide: 'b' }).status, 'EXPECTED_PROXIED');
  assert.equal(compareOutcomes(before, before, { qtype: TYPES.A, expectProxied: true, proxiedSide: 'b' }).status, 'DIFF');
  assert.equal(compareOutcomes(before, live, { qtype: TYPES.A }).status, 'DIFF');
  const doc = flippedExport();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dns-parity-'));
  const write = (name, d) => { const f = path.join(dir, name); writeFileSync(f, JSON.stringify(d)); return f; };
  const run = (file, expectProxied) => runParity({ zone: ZONE, a: openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE }), b: openSource(`cfapi:${file}`, { zone: ZONE }), probeSeed: 'fixed', expectProxied });
  const flipped = write('after.json', doc);
  const ok = await run(flipped, ['www', '@', '*']);
  assert.equal(ok.exitCode, 0, ok.rows.filter((x) => x.status === 'DIFF').map((x) => `${x.rel} ${x.type} ${x.reason}`).join('\n'));
  for (const type of ['MX', 'TXT', 'HTTPS']) assert.equal(ok.rows.find((x) => x.rel === 'www' && x.type === type).status, 'EXPECTED_PROXIED', type);
  assert.equal(ok.rows.find((x) => x.rel === '@' && x.type === 'MX').status, 'MATCH');
  // Only a former CNAME may become empty: listing the apex keeps its mail records compared (gate item 5).
  const mailLost = write('mail-lost.json', { ...doc, result: doc.result.filter((r) => !(r.name === ZONE && (r.type === 'MX' || (r.type === 'TXT' && r.content.includes('v=spf1'))))) });
  const lost = await run(mailLost, ['www', '@', '*']);
  assert.equal(lost.exitCode, 1);
  assert.equal(lost.rows.find((x) => x.rel === '@' && x.type === 'MX').status, 'DIFF');
  assert.equal(lost.rows.find((x) => x.rel === '@' && x.type === 'TXT').status, 'DIFF');
  // Each step lists only the names already proxied (README runbook rows): after S12 only www and the api record are.
  const s12List = /\| S12 [^|]*\| the same with `--expect-proxied ([^`]+)`/.exec(readFileSync(README, 'utf8'))?.[1];
  assert.equal(s12List, 'www,api');
  const s12 = JSON.parse(readFileSync(fx('cloudflare.json'), 'utf8'));
  Object.assign(s12.result.find((r) => r.name === `www.${ZONE}`), { type: 'AAAA', content: '100::', proxied: true });
  s12.result.push({ id: 'r-api', name: `api.${ZONE}`, type: 'AAAA', content: '100::', ttl: 1, proxied: true });
  const s12File = write('s12.json', s12);
  assert.equal((await run(s12File, s12List.split(','))).exitCode, 0);
  assert.equal((await run(s12File, ['www', '@', '*', 'api'])).exitCode, 1);
  // A name not listed is still compared, and a record added next to a placeholder still differs.
  assert.equal((await run(flipped, ['www', '@'])).exitCode, 1);
  doc.result.push({ id: 'r100', name: 'www.micronshub.eu', type: 'TXT', content: 'added', ttl: 1 });
  const added = await run(write('added.json', doc), ['www', '@', '*']);
  assert.equal(added.rows.find((x) => x.rel === 'www' && x.type === 'TXT').status, 'DIFF');
});

test('--forbid-target: an answer or record pointing at a listed target fails the run, also when allow-listed or proxied', async () => {
  const zone = () => openSource(`zone:${fx('papaki.zone')}`, { zone: ZONE });
  const cfApi = (f) => openSource(`cfapi:${fx(f)}`, { zone: ZONE });
  const base = { zone: ZONE, probeSeed: 'fixed' };
  assert.equal((await runParity({ ...base, a: zone(), b: cfApi('cloudflare.json') })).exitCode, 0);
  // Targets are compared in canonical form (case, trailing dot); a suffix matches every name below it.
  const r = await runParity({ ...base, a: zone(), b: cfApi('cloudflare.json'), forbidTargets: ['Vercel-DNS.com.', '216.198.79.1'] });
  assert.equal(r.exitCode, 1);
  const hit = (rel, type) => r.rows.find((x) => x.rel === rel && x.type === type && x.status === 'DIFF' && /^forbidden target/.test(x.reason));
  assert.match(hit('@', 'A').reason, /216\.198\.79\.1/);
  assert.equal(hit('@', 'A').was, 'MATCH');
  assert.match(hit('*', 'CNAME').reason, /forbidden target vercel-dns\.com: side A answers CNAME cname\.vercel-dns\.com/);
  assert.ok(hit('random-probe-xyz', 'A'), 'a name the wildcard answers is checked too');
  assert.ok(!r.rows.some((x) => x.rel === 'www' && /^forbidden/.test(x.reason ?? '')), 'a host that does not end with a listed target is not flagged');
  // An allow-list entry turns the drift DIFF of ftp into ALLOWED; the forbidden target still fails it.
  const allow = [{ id: 'DNS-AL-2', name: 'ftp', type: '*', reason: 'record added on purpose', expires: '2099-01-01' }];
  const one = { defaultNames: false, names: [{ name: 'ftp', types: ['A'] }] };
  const allowed = await runParity({ ...base, ...one, a: zone(), b: cfApi('cloudflare-drift.json'), allow });
  assert.equal(allowed.rows.find((x) => x.rel === 'ftp' && x.type === 'A').status, 'ALLOWED');
  const blocked = await runParity({ ...base, ...one, a: zone(), b: cfApi('cloudflare-drift.json'), allow, forbidTargets: ['216.198.79.1'] });
  assert.equal(blocked.rows.find((x) => x.rel === 'ftp' && x.type === 'A').status, 'DIFF');
  // A proxied record answers with Cloudflare addresses only; its stored target is read from the source itself.
  const drift = cfApi('cloudflare-drift.json');
  const hidden = await runParity({ ...base, a: drift, b: drift, defaultNames: false, names: [{ name: 'www', types: ['A', 'CNAME'] }], forbidTargets: ['vercel-dns-017.com'] });
  assert.equal(hidden.exitCode, 1);
  const rec = hidden.rows.filter((x) => /^forbidden target/.test(x.reason ?? ''));
  assert.deepEqual(rec.map((x) => [x.rel, x.type]), [['www', 'CNAME']]);
  assert.match(rec[0].reason, /proxied record in cfapi:/);
  // CLI: repeatable option, report line, exit 1; an empty target is a usage error.
  const cli = spawnSync(process.execPath, [CLI, '--zone', ZONE, '--a', `zone:${fx('papaki.zone')}`, '--b', `cfapi:${fx('cloudflare.json')}`, '--forbid-target', 'vercel-dns.com', '--forbid-target', '216.198.79.1'], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /forbidden target 216\.198\.79\.1/);
  assert.equal(spawnSync(process.execPath, [CLI, '--zone', ZONE, '--a', `zone:${fx('papaki.zone')}`, '--b', `cfapi:${fx('cloudflare.json')}`, '--forbid-target', '.']).status, 64);
  // The check before the Vercel project is deleted (README row OW6-11, CLI header): one option set, every Vercel target.
  const readmeCmd = /`--a cfapi:<today's export> --b doh:cloudflare (--expect-proxied [^`]*--forbid-target [^`]*)`/.exec(readFileSync(README, 'utf8'))?.[1];
  const headerCmd = /--b doh:cloudflare \\\n\/\/\s+(--expect-proxied [^\n]*?)\s+\(Phase 6/.exec(readFileSync(CLI, 'utf8'))?.[1];
  assert.ok(readmeCmd && headerCmd, 'the README and the CLI header give the Phase 6 command');
  assert.equal(headerCmd, readmeCmd);
  const opts = readmeCmd.split(' ');
  assert.deepEqual(opts.slice(0, 2), ['--expect-proxied', 'www,@,*,api']);
  for (const t of ['vercel-dns.com', 'vercel-dns-017.com', '216.198.79.1']) assert.ok(opts.includes(t), t);
  // Side B stands in for the live answers after the flips: the proxied names answer plain Cloudflare addresses.
  const live = flippedExport();
  for (const name of [ZONE, `www.${ZONE}`, `*.${ZONE}`]) {
    Object.assign(live.result.find((x) => x.name === name && x.proxied), { type: 'A', content: '104.21.0.1', proxied: false });
    live.result.push({ id: `live-${name}`, name, type: 'AAAA', content: '2606:4700::1', ttl: 300, proxied: false });
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dns-parity-'));
  const save = (name, d) => { const f = path.join(dir, name); writeFileSync(f, JSON.stringify(d)); return f; };
  const liveFile = save('live.json', live);
  const phase6 = (file, args) => spawnSync(process.execPath, [CLI, '--zone', ZONE, '--a', `cfapi:${file}`, '--b', `cfapi:${liveFile}`, ...args], { encoding: 'utf8' });
  const after = save('after.json', flippedExport());
  const clean = phase6(after, opts);
  assert.equal(clean.status, 0, clean.stdout);
  // www left on the project CNAME of the rollback: only the vercel-dns-017.com target catches it.
  const left = flippedExport();
  Object.assign(left.result.find((x) => x.name === `www.${ZONE}`), { type: 'CNAME', content: '3096eb4eb748a48f.vercel-dns-017.com', proxied: false });
  const stale = phase6(save('www-left.json', left), opts);
  assert.equal(stale.status, 1, stale.stdout);
  assert.match(stale.stdout, /forbidden target vercel-dns-017\.com/);
  // The --expect-proxied list is part of the command: proxied records answer Cloudflare addresses on side B.
  assert.equal(phase6(after, opts.slice(2)).status, 1);
});

test('CLI exit codes: 0 equal, 1 differences, 2 unreadable source, 64 usage', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(run('--zone', ZONE, '--a', `zone:${fx('papaki.zone')}`, '--b', `cfapi:${fx('cloudflare.json')}`).status, 0);
  assert.equal(run('--zone', ZONE, '--a', `zone:${fx('papaki.zone')}`, '--b', `cfapi:${fx('cloudflare-drift.json')}`).status, 1);
  assert.equal(run('--zone', ZONE, '--a', `zone:${fx('capture.txt')}`, '--b', `cfapi:${fx('cloudflare.json')}`).status, 2);
  assert.equal(run('--zone', ZONE, '--a', 'bogus:x', '--b', `cfapi:${fx('cloudflare.json')}`).status, 64);
  assert.equal(run('--a', 'x').status, 64);
  const ds = spawnSync(process.execPath, [CLI, 'ds', '--zone', ZONE, '--via', `zone:${fx('papaki.zone')}`, '--expect', 'absent'], { encoding: 'utf8' });
  assert.equal(ds.status, 0, ds.stdout + ds.stderr);
});
