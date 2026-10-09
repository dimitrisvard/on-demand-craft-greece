// DNS wire format (RFC 1035 §4, RFC 6891 OPT): build one query, decode one response. No dependency.
import { bytesToText, ipv6FromBytes } from './rdata.mjs';
import { canonName } from './names.mjs';
import { rcodeName, TYPES } from './types.mjs';

/**
 * @param {string} name
 * @param {number} type
 * @param {{id?: number, rd?: boolean, edns?: number|false}} [o] edns = advertised UDP payload size (default 1232)
 */
export function encodeQuery(name, type, o = {}) {
  const id = o.id ?? Math.floor(Math.random() * 0x10000);
  const rd = o.rd ?? false;
  const edns = o.edns === undefined ? 1232 : o.edns;
  const labels = canonName(name).split('.').filter(Boolean);
  const parts = [];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(rd ? 0x0100 : 0x0000, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(edns ? 1 : 0, 10);
  parts.push(header);
  for (const l of labels) {
    const b = Buffer.from(l, 'utf8');
    if (b.length > 63) throw new Error(`label too long in ${name}`);
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  const q = Buffer.alloc(4);
  q.writeUInt16BE(type, 0);
  q.writeUInt16BE(1, 2);
  parts.push(q);
  if (edns) {
    // OPT: root owner, type 41, class = UDP payload size, TTL = ext-rcode/version/flags 0, RDLENGTH 0.
    const opt = Buffer.alloc(11);
    opt.writeUInt8(0, 0);
    opt.writeUInt16BE(TYPES.OPT, 1);
    opt.writeUInt16BE(edns, 3);
    opt.writeUInt32BE(0, 5);
    opt.writeUInt16BE(0, 9);
    parts.push(opt);
  }
  return { id, buf: Buffer.concat(parts) };
}

function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let end = -1;
  let jumps = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('name runs past the message');
    const len = buf[pos];
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('truncated compression pointer');
      if (++jumps > 64) throw new Error('compression pointer loop');
      if (end === -1) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if ((len & 0xc0) !== 0) throw new Error(`unsupported label type 0x${len.toString(16)}`);
    if (len === 0) {
      if (end === -1) end = pos + 1;
      break;
    }
    if (pos + 1 + len > buf.length) throw new Error('label runs past the message');
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('latin1'));
    pos += 1 + len;
  }
  return { name: canonName(labels.join('.')), next: end };
}

function readCharStrings(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end) {
    const len = buf[p];
    if (p + 1 + len > end) throw new Error('character-string runs past RDATA');
    out.push(bytesToText(buf.subarray(p + 1, p + 1 + len)));
    p += 1 + len;
  }
  return out;
}

function decodeRdata(buf, type, start, len) {
  const end = start + len;
  const raw = buf.subarray(start, end);
  switch (type) {
    case TYPES.A:
      if (len !== 4) throw new Error('A RDATA is not 4 bytes');
      return { address: [...raw].join('.') };
    case TYPES.AAAA:
      if (len !== 16) throw new Error('AAAA RDATA is not 16 bytes');
      return { address: ipv6FromBytes(raw) };
    case TYPES.NS:
    case TYPES.CNAME:
    case TYPES.PTR:
      return { target: readName(buf, start).name };
    case TYPES.MX:
      return { preference: buf.readUInt16BE(start), exchange: readName(buf, start + 2).name };
    case TYPES.TXT:
      return { strings: readCharStrings(buf, start, end) };
    case TYPES.SRV:
      return {
        priority: buf.readUInt16BE(start), weight: buf.readUInt16BE(start + 2), port: buf.readUInt16BE(start + 4),
        target: readName(buf, start + 6).name,
      };
    case TYPES.CAA: {
      const tagLen = buf[start + 1];
      return {
        flags: buf[start],
        tag: raw.subarray(2, 2 + tagLen).toString('latin1'),
        value: bytesToText(raw.subarray(2 + tagLen)),
      };
    }
    case TYPES.SOA: {
      const m = readName(buf, start);
      const r = readName(buf, m.next);
      const p = r.next;
      return {
        mname: m.name, rname: r.name, serial: buf.readUInt32BE(p), refresh: buf.readUInt32BE(p + 4),
        retry: buf.readUInt32BE(p + 8), expire: buf.readUInt32BE(p + 12), minimum: buf.readUInt32BE(p + 16),
      };
    }
    case TYPES.DS:
      return { keyTag: buf.readUInt16BE(start), algorithm: buf[start + 2], digestType: buf[start + 3], digest: raw.subarray(4).toString('hex') };
    case TYPES.DNSKEY:
      return { flags: buf.readUInt16BE(start), protocol: buf[start + 2], algorithm: buf[start + 3], publicKey: raw.subarray(4).toString('base64') };
    default:
      return { generic: raw.toString('hex') };
  }
}

function readRR(buf, offset) {
  const { name, next } = readName(buf, offset);
  if (next + 10 > buf.length) throw new Error('RR header runs past the message');
  const type = buf.readUInt16BE(next);
  const klass = buf.readUInt16BE(next + 2);
  const ttl = buf.readUInt32BE(next + 4);
  const rdlen = buf.readUInt16BE(next + 8);
  const start = next + 10;
  if (start + rdlen > buf.length) throw new Error('RDATA runs past the message');
  const rr = type === TYPES.OPT
    ? { name, type, klass, ttl, rdata: { udpSize: klass } }
    : { name, type, klass, ttl, rdata: decodeRdata(buf, type, start, rdlen) };
  return { rr, next: start + rdlen };
}

/** Decode a full response. Throws on a malformed message (the caller reports it as an ERROR answer). */
export function decodeMessage(buf) {
  if (buf.length < 12) throw new Error('message shorter than the header');
  const flags = buf.readUInt16BE(2);
  const counts = [4, 6, 8, 10].map((o) => buf.readUInt16BE(o));
  const msg = {
    id: buf.readUInt16BE(0),
    qr: !!(flags & 0x8000), opcode: (flags >> 11) & 0xf, aa: !!(flags & 0x0400), tc: !!(flags & 0x0200),
    rd: !!(flags & 0x0100), ra: !!(flags & 0x0080), ad: !!(flags & 0x0020), cd: !!(flags & 0x0010),
    rcode: flags & 0xf, question: [], answer: [], authority: [], additional: [],
  };
  let p = 12;
  for (let i = 0; i < counts[0]; i++) {
    const { name, next } = readName(buf, p);
    msg.question.push({ name, type: buf.readUInt16BE(next), klass: buf.readUInt16BE(next + 2) });
    p = next + 4;
  }
  for (const [section, n] of [['answer', counts[1]], ['authority', counts[2]], ['additional', counts[3]]]) {
    for (let i = 0; i < n; i++) {
      const { rr, next } = readRR(buf, p);
      msg[section].push(rr);
      p = next;
    }
  }
  const opt = msg.additional.find((r) => r.type === TYPES.OPT);
  if (opt) msg.rcode |= ((opt.ttl >>> 24) & 0xff) << 4;
  msg.rcodeName = rcodeName(msg.rcode);
  return msg;
}

// ----- test helper: build a response (used by the fixtures generator and unit tests) -----

function encodeName(name, table, offset) {
  // Simple compression: reuse the longest suffix already written.
  const labels = canonName(name).split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (table.has(suffix)) {
      const ptr = table.get(suffix);
      out.push(Buffer.from([0xc0 | (ptr >> 8), ptr & 0xff]));
      return Buffer.concat(out);
    }
    const here = offset + out.reduce((a, b) => a + b.length, 0);
    if (here < 0x3fff) table.set(suffix, here);
    const b = Buffer.from(labels[i], 'latin1');
    out.push(Buffer.from([b.length]), b);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function encodeRdata(rr, table, offset) {
  const d = rr.rdata;
  switch (rr.type) {
    case TYPES.A: return Buffer.from(d.address.split('.').map(Number));
    case TYPES.AAAA: {
      const b = Buffer.alloc(16);
      const full = d.address.includes('::')
        ? (() => { const [l, r] = d.address.split('::'); const L = l ? l.split(':') : []; const R = r ? r.split(':') : []; return [...L, ...Array(8 - L.length - R.length).fill('0'), ...R]; })()
        : d.address.split(':');
      full.forEach((g, i) => b.writeUInt16BE(parseInt(g, 16), i * 2));
      return b;
    }
    case TYPES.NS: case TYPES.CNAME: case TYPES.PTR: return encodeName(d.target, table, offset);
    case TYPES.MX: {
      const pref = Buffer.alloc(2); pref.writeUInt16BE(d.preference, 0);
      return Buffer.concat([pref, encodeName(d.exchange, table, offset + 2)]);
    }
    case TYPES.TXT: return Buffer.concat(d.strings.flatMap((s) => { const b = Buffer.from(s, 'latin1'); return [Buffer.from([b.length]), b]; }));
    case TYPES.DS: { const h = Buffer.alloc(4); h.writeUInt16BE(d.keyTag, 0); h[2] = d.algorithm; h[3] = d.digestType; return Buffer.concat([h, Buffer.from(d.digest, 'hex')]); }
    default: return Buffer.from(d.generic ?? '', 'hex');
  }
}

/** Build a response message; used only by tests and fixture generation. */
export function encodeResponse({ id = 0x1234, aa = true, tc = false, rd = false, ra = false, ad = false, rcode = 0, question, answer = [], authority = [] }) {
  const table = new Map();
  const chunks = [];
  let len = 12;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8000 | (aa ? 0x0400 : 0) | (tc ? 0x0200 : 0) | (rd ? 0x0100 : 0) | (ra ? 0x0080 : 0) | (ad ? 0x0020 : 0) | (rcode & 0xf), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answer.length, 6);
  header.writeUInt16BE(authority.length, 8);
  chunks.push(header);
  const qn = encodeName(question.name, table, len);
  const qt = Buffer.alloc(4); qt.writeUInt16BE(question.type, 0); qt.writeUInt16BE(1, 2);
  chunks.push(qn, qt); len += qn.length + 4;
  for (const rr of [...answer, ...authority]) {
    const n = encodeName(rr.name, table, len);
    const fixed = Buffer.alloc(10);
    const rd = encodeRdata(rr, table, len + n.length + 10);
    fixed.writeUInt16BE(rr.type, 0); fixed.writeUInt16BE(1, 2); fixed.writeUInt32BE(rr.ttl ?? 300, 4); fixed.writeUInt16BE(rd.length, 8);
    chunks.push(n, fixed, rd); len += n.length + 10 + rd.length;
  }
  return Buffer.concat(chunks);
}
