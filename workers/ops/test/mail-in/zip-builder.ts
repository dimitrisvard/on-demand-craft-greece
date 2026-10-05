// Builds small ZIP archives for the tests (stored or deflate entries, optional symlink / encrypted flags and a
// declared size that differs from the content), so every rule of src/mail-in/zip.ts can be exercised.

import { deflateRawSync } from 'node:zlib';

export interface TestEntry {
  name: string;
  content: Uint8Array | string;
  method?: 0 | 8;
  /** Declared uncompressed size (default: the real size). */
  declaredSize?: number;
  /** Declared compressed size (default: the real compressed size). */
  declaredCompressedSize?: number;
  symlink?: boolean;
  encrypted?: boolean;
  /** Override of the method number written to the headers (e.g. 12 = bzip2). */
  methodNumber?: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const bytesOf = (c: Uint8Array | string) => (typeof c === 'string' ? new TextEncoder().encode(c) : c);

export function buildZip(entries: TestEntry[], o: { zip64Marker?: boolean } = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = bytesOf(e.content);
    const method = e.method ?? 8;
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = new TextEncoder().encode(e.name);
    const crc = crc32(raw);
    const flags = 0x0800 | (e.encrypted ? 1 : 0);
    const methodNumber = e.methodNumber ?? method;
    const compressed = e.declaredCompressedSize ?? data.length;
    const uncompressed = e.declaredSize ?? raw.length;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, methodNumber, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed, true);
    lv.setUint32(22, uncompressed, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, methodNumber, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, ((e.symlink ? 0o120777 : 0o100644) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, o.zip64Marker ? 0xffff : entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
