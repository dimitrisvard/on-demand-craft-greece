import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonical } from '../lib/rdata.mjs';
import { TYPES } from '../lib/types.mjs';
import { parseZone } from '../lib/zonefile.mjs';
import { ZoneModel } from '../lib/zonesim.mjs';

const ZONE = `$ORIGIN example.test.
$TTL 300
@ IN A 192.0.2.1
@ IN MX 10 mx.example.test.
www IN CNAME target.example.net.
* IN CNAME wild.example.net.
send IN TXT "v=spf1 -all"
resend._domainkey IN TXT "p=KEY"
`;
const zone = parseZone(ZONE, { origin: 'example.test' });
const rfc = new ZoneModel(zone, 'rfc4592');
const cf = new ZoneModel(zone, 'cloudflare');
const vals = (a) => a.rrs.map((r) => `${r.name} ${canonical(r)}`);

test('exact names, CNAME for every type, NODATA', () => {
  assert.deepEqual(vals(rfc.answer('www.example.test', TYPES.MX)), ['www.example.test target.example.net']);
  assert.equal(rfc.answer('send.example.test', TYPES.A).rrs.length, 0);
  assert.equal(rfc.answer('send.example.test', TYPES.A).status, 'NOERROR');
  assert.equal(rfc.answer('other.zone', TYPES.A).status, 'REFUSED');
});

test('wildcard synthesis: owner rewritten, several levels, blocked by any existing record', () => {
  assert.deepEqual(vals(rfc.answer('zz.example.test', TYPES.A)), ['zz.example.test wild.example.net']);
  assert.deepEqual(vals(rfc.answer('a.b.zz.example.test', TYPES.TXT)), ['a.b.zz.example.test wild.example.net']);
  assert.equal(rfc.answer('x.send.example.test', TYPES.A).status, 'NXDOMAIN'); // closest encloser 'send' has no '*'
  assert.equal(cf.answer('x.send.example.test', TYPES.A).status, 'NXDOMAIN');
});

test('empty non-terminal: RFC 4592 NODATA, Cloudflare applies the wildcard', () => {
  const r = rfc.answer('_domainkey.example.test', TYPES.TXT);
  assert.equal(r.status, 'NOERROR');
  assert.equal(r.rrs.length, 0);
  assert.equal(rfc.answer('x._domainkey.example.test', TYPES.A).status, 'NXDOMAIN');
  assert.deepEqual(vals(cf.answer('_domainkey.example.test', TYPES.TXT)), ['_domainkey.example.test wild.example.net']);
  assert.deepEqual(vals(cf.answer('x._domainkey.example.test', TYPES.A)), ['x._domainkey.example.test wild.example.net']);
  assert.deepEqual(rfc.emptyNonTerminals(), ['_domainkey.example.test']);
});

test('Cloudflare shapes: proxied host, apex CNAME flattening', () => {
  const z = parseZone(`$TTL 1
@ IN CNAME pages.example.net. ; cf_tags=cf-proxied:false
www IN CNAME origin.example.net. ; cf_tags=cf-proxied:true
`, { origin: 'example.test' });
  const m = new ZoneModel(z, 'cloudflare');
  assert.equal(m.answer('www.example.test', TYPES.A).proxied, true);
  assert.equal(m.answer('www.example.test', TYPES.CNAME).rrs.length, 0);
  assert.equal(m.answer('example.test', TYPES.A).flattened, 'pages.example.net');
  assert.equal(new ZoneModel(z, 'rfc4592').answer('www.example.test', TYPES.A).rrs[0].type, TYPES.CNAME);
});
