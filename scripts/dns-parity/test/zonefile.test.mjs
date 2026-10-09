import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCfApi } from '../lib/cfapi.mjs';
import { canonical } from '../lib/rdata.mjs';
import { TYPES } from '../lib/types.mjs';
import { parseTtl, parseZone, ZoneParseError } from '../lib/zonefile.mjs';

const fx = (f) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url));

test('Papaki-style export: directives, blank owners, parentheses, escapes, absolute and relative names', () => {
  const z = parseZone(fx('papaki.zone'), { origin: 'micronshub.eu' });
  const by = (name, type) => z.records.filter((r) => r.name === name && r.type === type);
  assert.equal(by('micronshub.eu', TYPES.SOA).length, 1);
  assert.equal(by('micronshub.eu', TYPES.SOA)[0].rdata.minimum, 3600);
  assert.equal(by('micronshub.eu', TYPES.NS).length, 2);
  const mx = by('micronshub.eu', TYPES.MX);
  assert.equal(mx.length, 5);
  assert.equal(canonical(mx[0]), '1 aspmx.l.google.com'); // upper case in the file
  assert.deepEqual(mx.map((r) => r.ttl), [3600, 3600, 3600, 3600, 3600]);
  assert.equal(by('micronshub.eu', TYPES.A)[0].ttl, 300);
  assert.equal(canonical(by('_dmarc.micronshub.eu', TYPES.TXT)[0]), '"v=DMARC1; p=none; rua=mailto:info@micronshub.eu"'); // \059 = ';'
  assert.equal(by('resend._domainkey.micronshub.eu', TYPES.TXT)[0].rdata.strings.length, 2);
  assert.equal(by('google._domainkey.micronshub.eu', TYPES.TXT)[0].rdata.strings.length, 2); // across lines
  assert.equal(canonical(by('*.micronshub.eu', TYPES.CNAME)[0]), 'cname.vercel-dns.com');
});

test('TTL units and class/TTL in either order', () => {
  assert.equal(parseTtl('1h30m'), 5400);
  assert.equal(parseTtl('2D'), 172800);
  assert.equal(parseTtl('abc'), null);
  const z = parseZone('$ORIGIN example.test.\na IN 1h A 192.0.2.1\nb 60 IN AAAA 2001:DB8::0:1\n', { origin: 'example.test' });
  assert.deepEqual(z.records.map((r) => [r.name, r.ttl, canonical(r)]), [['a.example.test', 3600, '192.0.2.1'], ['b.example.test', 60, '2001:db8::1']]);
});

test('RFC 3597 generic RDATA and unknown types', () => {
  const z = parseZone('$TTL 60\nh IN TYPE65 \\# 3 010203\nk IN HTTPS 1 . alpn=h2\n', { origin: 'example.test' });
  assert.equal(canonical(z.records[0]), '\\# 3 010203');
  assert.match(canonical(z.records[1]), /^\?text 1 \. alpn=h2$/);
});

test('Cloudflare export comments mark proxied records', () => {
  const z = parseZone('www.example.test. 1 IN A 192.0.2.1 ; cf_tags=cf-proxied:true\napi.example.test. 1 IN A 192.0.2.2 ; cf_tags=cf-proxied:false\n', { origin: 'example.test' });
  assert.deepEqual(z.records.map((r) => r.proxied), [true, false]);
});

test('errors carry the line number', () => {
  assert.throws(() => parseZone('$TTL 60\na IN A 999.1.1.1\n', { origin: 'x.test' }), (e) => e instanceof ZoneParseError && e.line === 2);
  assert.throws(() => parseZone('$TTL 60\n@ IN SOA a. b. ( 1 2 3 4 5\n', { origin: 'x.test' }), /unbalanced/);
  assert.throws(() => parseZone('$INCLUDE other.zone\n', { origin: 'x.test' }), /unsupported directive/);
  assert.throws(() => parseZone('a IN A 192.0.2.1\n', { origin: 'x.test' }), /no TTL/);
  assert.throws(() => parseZone(`$TTL 60\nt IN TXT "${'x'.repeat(256)}"\n`, { origin: 'x.test' }), /255/);
});

test('Cloudflare API export: envelope or pages, quoted or plain TXT, auto TTL, MX priority, proxied', () => {
  const z = parseCfApi(fx('cloudflare.json').toString(), 'micronshub.eu');
  const spf = z.records.find((r) => r.type === TYPES.TXT && r.name === 'micronshub.eu' && canonical(r).includes('spf1'));
  assert.equal(canonical(spf), '"v=spf1 include:_spf.google.com ~all"');
  const dkim = z.records.find((r) => r.name === 'resend._domainkey.micronshub.eu');
  assert.deepEqual(dkim.rdata.strings.map((s) => s.length), [255, 144]); // Cloudflare splits a long value at 255
  assert.equal(z.records.find((r) => r.type === TYPES.MX && r.rdata.preference === 1).ttl, null); // ttl 1 = automatic
  const pages = parseCfApi(fx('cloudflare-drift.json').toString(), 'micronshub.eu');
  assert.equal(pages.records.length, 14);
  assert.equal(pages.records.find((r) => r.name === 'www.micronshub.eu').proxied, true);
  assert.throws(() => parseCfApi('{"foo":1}', 'micronshub.eu'), /not a Cloudflare dns_records export/);
});
