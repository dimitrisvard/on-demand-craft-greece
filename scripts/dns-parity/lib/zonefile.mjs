// BIND master-file parser (RFC 1035 §5.1 subset): $ORIGIN, $TTL, '@', relative names, blank owner = previous
// owner, optional TTL/class in either order, parentheses across lines, ';' comments, quoted strings with
// \X and \DDD escapes, multi-string TXT, RFC 3597 '\#' RDATA. $INCLUDE is refused (an export is one file).
// Cloudflare's own export marks proxied records with a comment 'cf_tags=cf-proxied:true'; that comment is kept.
import { readFileSync } from 'node:fs';
import { checkAddress } from './rdata.mjs';
import { absolute, canonName } from './names.mjs';
import { typeNumber, TYPES } from './types.mjs';

const CLASSES = new Set(['IN', 'CH', 'HS', 'CS']);

export class ZoneParseError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

/** Split the file into logical lines of tokens. Input is a latin1 string (one char per byte). */
function tokenise(text) {
  const lines = [];
  let cur = null;
  let depth = 0;
  let lineNo = 1;
  let i = 0;
  const newLogical = (leadingSpace) => {
    cur = { tokens: [], leadingSpace, comment: '', line: lineNo };
  };
  const flush = () => {
    if (cur && (cur.tokens.length || cur.comment)) lines.push(cur);
    cur = null;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') {
      lineNo += 1;
      i += 1;
      if (depth === 0) flush();
      continue;
    }
    if (!cur) newLogical(ch === ' ' || ch === '\t');
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (ch === ';') {
      let j = text.indexOf('\n', i);
      if (j === -1) j = text.length;
      cur.comment += text.slice(i + 1, j).trim() + ' ';
      i = j;
      continue;
    }
    if (ch === '(') { depth += 1; i += 1; continue; }
    if (ch === ')') {
      if (depth === 0) throw new ZoneParseError("unbalanced ')'", lineNo);
      depth -= 1; i += 1; continue;
    }
    const quoted = ch === '"';
    let j = quoted ? i + 1 : i;
    let value = '';
    for (;;) {
      if (j >= text.length) {
        if (quoted) throw new ZoneParseError('unterminated quoted string', lineNo);
        break;
      }
      const c = text[j];
      if (quoted && c === '"') { j += 1; break; }
      if (!quoted && (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ';' || c === '(' || c === ')')) break;
      if (c === '\n') lineNo += 1;
      if (c === '\\') {
        const d = text.slice(j + 1, j + 4);
        if (/^\d{3}$/.test(d)) {
          const n = Number(d);
          if (n > 255) throw new ZoneParseError(`escape \\${d} out of range`, lineNo);
          value += String.fromCharCode(n);
          j += 4;
        } else {
          if (j + 1 >= text.length) throw new ZoneParseError('dangling backslash', lineNo);
          value += text[j + 1];
          j += 2;
        }
        continue;
      }
      value += c;
      j += 1;
    }
    cur.tokens.push({ value, quoted, raw: text.slice(i, j) });
    i = j;
  }
  if (depth !== 0) throw new ZoneParseError("unbalanced '('", lineNo);
  flush();
  return lines;
}

export function parseTtl(s) {
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+)([smhdw])/gi;
  let total = 0;
  let consumed = '';
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2].toLowerCase()];
    consumed += m[0];
  }
  return consumed.length === s.length && consumed ? total : null;
}

function nameArg(tok, origin, line) {
  if (!tok) throw new ZoneParseError('missing domain name', line);
  return absolute(tok.value === '@' ? '@' : tok.value, origin);
}

function rdataFor(type, toks, origin, line) {
  const need = (n) => { if (toks.length < n) throw new ZoneParseError(`expected ${n} RDATA fields`, line); };
  const int = (t, max = 0xffffffff) => {
    if (!/^\d+$/.test(t.value) || Number(t.value) > max) throw new ZoneParseError(`bad number ${t.value}`, line);
    return Number(t.value);
  };
  if (toks[0] && !toks[0].quoted && toks[0].raw === '\\#') {
    need(2);
    const len = int(toks[1], 65535);
    const hex = toks.slice(2).map((t) => t.value).join('').toLowerCase();
    if (!/^[0-9a-f]*$/.test(hex) || hex.length !== len * 2) throw new ZoneParseError('bad \\# RDATA', line);
    return { generic: hex };
  }
  try {
    switch (type) {
      case TYPES.A:
      case TYPES.AAAA:
        need(1);
        return checkAddress(type, toks[0].value);
      case TYPES.NS:
      case TYPES.CNAME:
      case TYPES.PTR:
        need(1);
        return { target: nameArg(toks[0], origin, line) };
      case TYPES.MX:
        need(2);
        return { preference: int(toks[0], 65535), exchange: nameArg(toks[1], origin, line) };
      case TYPES.TXT:
        need(1);
        for (const t of toks) if (t.value.length > 255) throw new ZoneParseError('TXT character-string longer than 255 bytes', line);
        return { strings: toks.map((t) => t.value) };
      case TYPES.SRV:
        need(4);
        return { priority: int(toks[0], 65535), weight: int(toks[1], 65535), port: int(toks[2], 65535), target: nameArg(toks[3], origin, line) };
      case TYPES.CAA:
        need(3);
        return { flags: int(toks[0], 255), tag: toks[1].value, value: toks.slice(2).map((t) => t.value).join(' ') };
      case TYPES.SOA:
        need(7);
        return {
          mname: nameArg(toks[0], origin, line), rname: nameArg(toks[1], origin, line), serial: int(toks[2]),
          refresh: parseTtl(toks[3].value), retry: parseTtl(toks[4].value), expire: parseTtl(toks[5].value), minimum: parseTtl(toks[6].value),
        };
      case TYPES.DS:
        need(4);
        return { keyTag: int(toks[0], 65535), algorithm: int(toks[1], 255), digestType: int(toks[2], 255), digest: toks.slice(3).map((t) => t.value).join('').toLowerCase() };
      case TYPES.DNSKEY:
        need(4);
        return { flags: int(toks[0], 65535), protocol: int(toks[1], 255), algorithm: int(toks[2], 255), publicKey: toks.slice(3).map((t) => t.value).join('') };
      default:
        return { text: toks.map((t) => (t.quoted ? JSON.stringify(t.value) : t.value)).join(' ') };
    }
  } catch (e) {
    if (e instanceof ZoneParseError) throw e;
    throw new ZoneParseError(e.message, line);
  }
}

/**
 * @param {string|Buffer} input file content
 * @param {{origin: string, defaultTtl?: number}} o
 * @returns {{origin: string, records: Array<{name:string,type:number,ttl:number,rdata:object,proxied:boolean,line:number}>}}
 */
export function parseZone(input, o) {
  const text = Buffer.isBuffer(input) ? input.toString('latin1') : Buffer.from(input, 'utf8').toString('latin1');
  let origin = canonName(o.origin);
  let defaultTtl = o.defaultTtl ?? null;
  let lastOwner = null;
  let lastTtl = null;
  const records = [];
  for (const ln of tokenise(text)) {
    const toks = [...ln.tokens];
    if (!toks.length) continue;
    const first = toks[0].value.toUpperCase();
    if (!ln.leadingSpace && !toks[0].quoted && first.startsWith('$')) {
      if (first === '$ORIGIN') { origin = absolute(toks[1]?.value ?? '', origin); continue; }
      if (first === '$TTL') {
        const t = parseTtl(toks[1]?.value ?? '');
        if (t === null) throw new ZoneParseError('bad $TTL', ln.line);
        defaultTtl = t;
        continue;
      }
      throw new ZoneParseError(`unsupported directive ${first}`, ln.line);
    }
    let owner;
    if (ln.leadingSpace) {
      if (!lastOwner) throw new ZoneParseError('record without an owner', ln.line);
      owner = lastOwner;
    } else {
      owner = nameArg(toks.shift(), origin, ln.line);
    }
    let ttl = null;
    for (let k = 0; k < 2 && toks.length; k++) {
      const v = toks[0].value;
      const asTtl = toks[0].quoted ? null : parseTtl(v);
      if (asTtl !== null && ttl === null) { ttl = asTtl; toks.shift(); continue; }
      if (CLASSES.has(v.toUpperCase())) {
        if (v.toUpperCase() !== 'IN') throw new ZoneParseError(`class ${v} not supported`, ln.line);
        toks.shift();
        continue;
      }
      break;
    }
    const typeTok = toks.shift();
    if (!typeTok) throw new ZoneParseError('missing type', ln.line);
    let type;
    try { type = typeNumber(typeTok.value); } catch (e) { throw new ZoneParseError(e.message, ln.line); }
    const rdata = rdataFor(type, toks, origin, ln.line);
    const effTtl = ttl ?? defaultTtl ?? lastTtl;
    if (effTtl === null) throw new ZoneParseError('no TTL and no $TTL', ln.line);
    lastOwner = owner;
    lastTtl = effTtl;
    records.push({ name: owner, type, ttl: effTtl, rdata, proxied: /cf-proxied:true/.test(ln.comment), line: ln.line });
  }
  return { origin, records };
}

export function readZoneFile(path, origin) {
  return parseZone(readFileSync(path), { origin });
}
