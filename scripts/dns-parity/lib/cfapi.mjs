// Cloudflare API export: the JSON of GET /zones/:zone_id/dns_records (envelope {result:[…]}, a bare array, or
// an array of envelopes when several pages were saved). Fields used: name, type, content, ttl, proxied,
// priority, data. TXT content is accepted with or without zone-file quoting ("a" "b" -> two strings).
// TTL 1 means "automatic" in the API and is reported as such (null); --ttl comparisons treat it as unknown.
import { readFileSync } from 'node:fs';
import { checkAddress, utf8ToText } from './rdata.mjs';
import { absolute, canonName, inZone } from './names.mjs';
import { parseZone } from './zonefile.mjs';
import { typeNumber, TYPES } from './types.mjs';

function flatten(doc) {
  if (Array.isArray(doc)) return doc.flatMap((d) => (d && typeof d === 'object' && Array.isArray(d.result) ? d.result : [d]));
  if (doc && Array.isArray(doc.result)) return doc.result;
  throw new Error('not a Cloudflare dns_records export (expected {result:[…]} or an array)');
}

function txtStrings(content) {
  const s = String(content);
  if (s.startsWith('"')) {
    // Same tokeniser as a zone file: parse 'x IN TXT <content>' and take its strings.
    const z = parseZone(`x 300 IN TXT ${s}\n`, { origin: 'invalid' });
    return z.records[0].rdata.strings;
  }
  const bytes = utf8ToText(s);
  // An unquoted value longer than 255 bytes is split by Cloudflare into 255-byte strings on the wire.
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) out.push(bytes.slice(i, i + 255));
  return out.length ? out : [''];
}

function rdataOf(r, zone) {
  const type = typeNumber(r.type);
  const c = r.content;
  switch (type) {
    case TYPES.A:
    case TYPES.AAAA:
      return checkAddress(type, c);
    case TYPES.CNAME:
    case TYPES.NS:
    case TYPES.PTR:
      return { target: absolute(`${canonName(c)}.`, zone) };
    case TYPES.MX:
      return { preference: Number(r.priority ?? r.data?.priority ?? 0), exchange: canonName(c) };
    case TYPES.TXT:
      return { strings: txtStrings(c) };
    case TYPES.SRV: {
      const d = r.data ?? {};
      if (d.target !== undefined) return { priority: Number(d.priority), weight: Number(d.weight), port: Number(d.port), target: canonName(d.target) };
      const [w, p, t] = String(c).trim().split(/\s+/);
      return { priority: Number(r.priority), weight: Number(w), port: Number(p), target: canonName(t) };
    }
    case TYPES.CAA: {
      const d = r.data ?? {};
      if (d.tag !== undefined) return { flags: Number(d.flags ?? 0), tag: String(d.tag), value: utf8ToText(d.value ?? '') };
      const z = parseZone(`x 300 IN CAA ${c}\n`, { origin: 'invalid' });
      return z.records[0].rdata;
    }
    default:
      return { text: String(c) };
  }
}

/**
 * @returns {{origin:string, records:Array<{name,type,ttl,rdata,proxied}>}}
 */
export function parseCfApi(json, zone) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const origin = canonName(zone);
  const records = [];
  for (const r of flatten(doc)) {
    if (!r || typeof r !== 'object' || !r.name || !r.type) throw new Error('record without name or type');
    const name = canonName(r.name);
    if (!inZone(name, origin)) continue;
    const type = typeNumber(r.type);
    records.push({
      name, type, ttl: r.ttl === 1 ? null : Number(r.ttl), rdata: rdataOf(r, origin),
      proxied: r.proxied === true, id: r.id,
    });
  }
  return { origin, records };
}

export function readCfApi(path, zone) {
  return parseCfApi(readFileSync(path, 'utf8'), zone);
}
