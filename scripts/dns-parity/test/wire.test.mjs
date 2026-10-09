import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canonical, ipv6Canonical } from '../lib/rdata.mjs';
import { TYPES } from '../lib/types.mjs';
import { decodeMessage, encodeQuery, encodeResponse } from '../lib/wire.mjs';

const fixture = (f) => new URL(`../fixtures/${f}`, import.meta.url);

test('query: header, RD flag, one question, EDNS OPT with 1232', () => {
  const { id, buf } = encodeQuery('WWW.Micronshub.EU.', TYPES.A, { id: 0xbeef, rd: false });
  assert.equal(id, 0xbeef);
  assert.equal(buf.readUInt16BE(0), 0xbeef);
  assert.equal(buf.readUInt16BE(2), 0x0000);
  assert.equal(buf.readUInt16BE(4), 1);
  assert.equal(buf.readUInt16BE(10), 1);
  const rd = encodeQuery('micronshub.eu', TYPES.MX, { rd: true, edns: false }).buf;
  assert.equal(rd.readUInt16BE(2), 0x0100);
  assert.equal(rd.readUInt16BE(10), 0);
  // labels are lower-cased and the trailing dot dropped
  assert.ok(buf.includes(Buffer.from('\x03www\x0amicronshub\x02eu\x00', 'latin1')));
});

test('round trip with compression: CNAME chain, AAAA, MX, two-string TXT, DS', () => {
  const answer = [
    { name: 'www.micronshub.eu', type: TYPES.CNAME, ttl: 300, rdata: { target: 'x.vercel-dns-017.com' } },
    { name: 'x.vercel-dns-017.com', type: TYPES.A, ttl: 60, rdata: { address: '64.29.17.65' } },
    { name: 'x.vercel-dns-017.com', type: TYPES.AAAA, ttl: 60, rdata: { address: '2001:db8::1' } },
    { name: 'micronshub.eu', type: TYPES.MX, ttl: 3600, rdata: { preference: 10, exchange: 'alt3.aspmx.l.google.com' } },
    { name: 'micronshub.eu', type: TYPES.TXT, ttl: 3600, rdata: { strings: ['v=DKIM1;', 'p=ABC'] } },
    { name: 'micronshub.eu', type: TYPES.DS, ttl: 3600, rdata: { keyTag: 14800, algorithm: 8, digestType: 2, digest: '8fdb79' } },
  ];
  const buf = encodeResponse({ id: 7, aa: true, question: { name: 'www.micronshub.eu', type: TYPES.A }, answer });
  const msg = decodeMessage(buf);
  assert.equal(msg.id, 7);
  assert.equal(msg.aa, true);
  assert.equal(msg.rcodeName, 'NOERROR');
  assert.deepEqual(msg.answer.map((r) => canonical(r)), [
    'x.vercel-dns-017.com', '64.29.17.65', '2001:db8::1', '10 alt3.aspmx.l.google.com', '"v=DKIM1;p=ABC"', '14800 8 2 8fdb79',
  ]);
  assert.equal(canonical(msg.answer[4], { txt: 'chunks' }), '"v=DKIM1;" "p=ABC"');
});

test('NXDOMAIN, TC and AD flags are read', () => {
  const m = decodeMessage(encodeResponse({ rcode: 3, tc: true, ad: true, question: { name: 'zz.micronshub.eu', type: TYPES.A } }));
  assert.equal(m.rcodeName, 'NXDOMAIN');
  assert.equal(m.tc, true);
  assert.equal(m.ad, true);
});

test('malformed messages throw instead of returning partial data', () => {
  const ok = encodeResponse({ question: { name: 'a.b', type: TYPES.A }, answer: [{ name: 'a.b', type: TYPES.A, rdata: { address: '1.2.3.4' } }] });
  assert.throws(() => decodeMessage(ok.subarray(0, ok.length - 2)), /past/);
  const loop = Buffer.from(ok);
  loop[12] = 0xc0; loop[13] = 12; // question name points at itself
  assert.throws(() => decodeMessage(loop), /loop/);
  assert.throws(() => decodeMessage(Buffer.alloc(5)), /header/);
});

test('a recorded DoH answer (cloudflare-dns.com, MX micronshub.eu, 2026-10-04) decodes to the 5 Workspace MX', () => {
  const msg = decodeMessage(readFileSync(fixture('doh-micronshub-mx.bin')));
  assert.equal(msg.rcodeName, 'NOERROR');
  assert.deepEqual(msg.answer.map((r) => canonical(r)).sort(), [
    '1 aspmx.l.google.com', '10 alt3.aspmx.l.google.com', '10 alt4.aspmx.l.google.com', '5 alt1.aspmx.l.google.com', '5 alt2.aspmx.l.google.com',
  ]);
});

test('IPv6 text form follows RFC 5952', () => {
  assert.equal(ipv6Canonical('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(ipv6Canonical('100::'), '100::');
  assert.equal(ipv6Canonical('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
  assert.equal(ipv6Canonical('::ffff:192.0.2.1'), '::ffff:c000:201');
});
