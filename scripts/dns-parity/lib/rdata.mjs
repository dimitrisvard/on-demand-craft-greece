// Canonical RDATA. Every source (wire, zone file, Cloudflare API JSON, capture text) produces records
// { name, type, ttl, rdata } where rdata is a plain object per type; canonical(rr, opts) renders the
// comparison string. Rules (contract: docs/migration/specs/PHASE36_SPEC.md §4.1, D3-13):
//   - domain names: lower case, no trailing dot;
//   - TXT: the character-strings of one record are concatenated (opts.txt = 'join', default; RFC 7208 §3.3,
//     RFC 6376 §3.6.2.2 read them that way) or compared as the exact chunk list (opts.txt = 'chunks');
//     bytes are compared, rendered as latin1 so every byte maps to one code unit;
//   - AAAA: RFC 5952 text form; CAA: tag lower case; DS digest lower-case hex;
//   - unknown types: RFC 3597 generic form "\# <len> <hex>".
import { isIPv4, isIPv6 } from 'node:net';
import { canonName } from './names.mjs';
import { TYPES, typeName } from './types.mjs';

export function ipv6Canonical(text) {
  const s = String(text).trim().toLowerCase();
  if (!isIPv6(s)) throw new Error(`invalid IPv6 address ${text}`);
  let head = s;
  let v4 = null;
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    v4 = s.slice(lastColon + 1);
    head = s.slice(0, lastColon + 1) + '0:0';
  }
  const parts = head.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length > 1 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) => parseInt(g || '0', 16));
  if (v4) {
    const o = v4.split('.').map(Number);
    groups[6] = (o[0] << 8) | o[1];
    groups[7] = (o[2] << 8) | o[3];
  }
  return compressIPv6(groups);
}

export function ipv6FromBytes(buf) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i));
  return compressIPv6(groups);
}

function compressIPv6(groups) {
  // RFC 5952 §4.2: compress the longest run of two or more zero groups, the first one on a tie.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) { i += 1; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best === -1) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

/** Bytes -> latin1 string (one code unit per byte), the TXT comparison domain. */
export const bytesToText = (buf) => Buffer.from(buf).toString('latin1');
/** JavaScript string (UTF-16, as JSON gives it) -> latin1 rendering of its UTF-8 bytes. */
export const utf8ToText = (s) => Buffer.from(String(s), 'utf8').toString('latin1');

/** Render a latin1 TXT string for humans: printable ASCII as is, everything else as \DDD (zone-file style). */
export function displayText(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x22 || c === 0x5c) out += `\\${ch}`;
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else out += `\\${String(c).padStart(3, '0')}`;
  }
  return `"${out}"`;
}

/**
 * Canonical comparison string of one record.
 * @param {{type:number, rdata:object}} rr
 * @param {{txt?: 'join'|'chunks'}} [opts]
 */
export function canonical(rr, opts = {}) {
  const d = rr.rdata;
  switch (rr.type) {
    case TYPES.A:
      return d.address;
    case TYPES.AAAA:
      return d.address;
    case TYPES.NS:
    case TYPES.CNAME:
    case TYPES.PTR:
      return canonName(d.target);
    case TYPES.MX:
      return `${d.preference} ${canonName(d.exchange)}`;
    case TYPES.TXT:
      return opts.txt === 'chunks'
        ? d.strings.map(displayText).join(' ')
        : displayText(d.strings.join(''));
    case TYPES.SRV:
      return `${d.priority} ${d.weight} ${d.port} ${canonName(d.target)}`;
    case TYPES.CAA:
      return `${d.flags} ${String(d.tag).toLowerCase()} ${displayText(d.value)}`;
    case TYPES.SOA:
      return `${canonName(d.mname)} ${canonName(d.rname)} ${d.serial} ${d.refresh} ${d.retry} ${d.expire} ${d.minimum}`;
    case TYPES.DS:
      return `${d.keyTag} ${d.algorithm} ${d.digestType} ${String(d.digest).toLowerCase()}`;
    case TYPES.DNSKEY:
      return `${d.flags} ${d.protocol} ${d.algorithm} ${String(d.publicKey).replace(/\s+/g, '')}`;
    default:
      if (d.generic) return `\\# ${d.generic.length / 2} ${d.generic}`;
      if (d.text !== undefined) return `?text ${String(d.text).replace(/\s+/g, ' ').trim()}`;
      throw new Error(`no canonical form for ${typeName(rr.type)}`);
  }
}

/** True when the canonical value could not be compared byte for byte with a wire answer. */
export function isUncomparable(value) {
  return value.startsWith('?text ');
}

export function checkAddress(type, text) {
  const t = String(text).trim();
  if (type === TYPES.A) {
    if (!isIPv4(t)) throw new Error(`invalid IPv4 address ${text}`);
    return { address: t.split('.').map(Number).join('.') };
  }
  return { address: ipv6Canonical(t) };
}
