// IN-2 / I-2: storing attachments and the ZIP rules. Archives are read only through BlobPort range reads (a spy
// proves no whole-object read of an archive) and entries are written as streams; a ZIP entry whose declared size
// disagrees with its stream is aborted and flagged.

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { storeAttachments, kindsOf, type AttachmentRecord } from '../../src/mail-in/attachments';
import type { ParsedAttachment } from '../../src/mail-in/parse';
import { ZIP_LIMITS, entryProblem, extractEntry, readCentralDirectory, type ZipEntry } from '../../src/mail-in/zip';
import { R2Blob } from '../../src/ports/http-adapters';
import type { BlobPort } from '../../src/ports/index';
import type { OpsEnv } from '../../src/env';
import { FakeR2Bucket } from '../helpers/agent-env';
import { buildZip, type TestEntry } from './zip-builder';

const SHA = 'b'.repeat(64);
const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT(\'\',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n';
const DXF = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
const hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** BlobPort over a FakeR2Bucket with spies on every read. */
function blobWithSpies() {
  const bucket = new FakeR2Bucket();
  const blob = new R2Blob({ PRIVATE_FILES: bucket as unknown as R2Bucket } as OpsEnv);
  const get = vi.spyOn(blob, 'get');
  const getRange = vi.spyOn(blob, 'getRange');
  const put = vi.spyOn(blob, 'put');
  return { bucket, blob: blob as BlobPort, get, getRange, put };
}

function attachment(n: number, filename: string, bytes: Uint8Array | string, mime = 'application/octet-stream', inline = false): ParsedAttachment {
  const content = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return { n, filename, mime, size: content.byteLength, content: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer, inline };
}

async function storedZip(entries: TestEntry[], o: { zip64Marker?: boolean } = {}) {
  const spies = blobWithSpies();
  const zip = buildZip(entries, o);
  const records = await storeAttachments(spies.blob, SHA, [attachment(1, 'parts.zip', zip, 'application/zip')]);
  return { ...spies, records, zip };
}

describe('storeAttachments (MIME attachments)', () => {
  it('stores every attachment under email/<sha>/att/<n>-<safe> with its SHA-256; kinds from the bytes; inline parts marked', async () => {
    const { bucket, blob, put } = blobWithSpies();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const records = await storeAttachments(blob, SHA, [
      attachment(1, '../Bracket 1.step', STEP),
      attachment(2, 'logo.png', png, 'image/png', true),
      attachment(3, 'notes.txt', 'plain notes', 'text/plain'),
    ]);
    expect(records).toEqual([
      { n: 1, r2_key: `email/${SHA}/att/1-Bracket_1.step`, filename: '../Bracket 1.step', content_type: 'model/step', size_bytes: STEP.length, sha256: hex(STEP), kind: 'step' },
      { n: 2, r2_key: `email/${SHA}/att/2-logo.png`, filename: 'logo.png', content_type: 'image/png', size_bytes: png.length, sha256: hex(png), kind: 'image', inline: true },
      { n: 3, r2_key: `email/${SHA}/att/3-notes.txt`, filename: 'notes.txt', content_type: 'text/plain', size_bytes: 11, sha256: hex('plain notes'), kind: 'other' },
    ]);
    expect(bucket.text(`email/${SHA}/att/1-Bracket_1.step`)).toBe(STEP);
    expect(put.mock.calls[0][2]).toMatchObject({ sha256: hex(STEP) });
    expect(kindsOf(records)).toEqual(['other', 'step']);
  });

  it('is idempotent: a second run writes the same keys and records', async () => {
    const { bucket, blob } = blobWithSpies();
    const list = [attachment(1, 'a.dxf', DXF)];
    const first = await storeAttachments(blob, SHA, list);
    const second = await storeAttachments(blob, SHA, list);
    expect(second).toEqual(first);
    expect([...bucket.objects.keys()]).toEqual([`email/${SHA}/att/1-a.dxf`]);
  });
});

describe('ZIP archives (streamed from R2, one entry at a time)', () => {
  it('extracts entries after the last MIME attachment, with kinds and hashes; ignores directories and resource forks', async () => {
    const { records, get, getRange, bucket, put } = await storedZip([
      { name: 'parts/', content: '' },
      { name: 'parts/bracket.step', content: STEP },
      { name: 'parts/plate.dxf', content: DXF, method: 0 },
      { name: '__MACOSX/parts/._bracket.step', content: 'fork' },
    ]);
    expect(records.map((r) => [r.n, r.kind, r.parent, r.r2_key])).toEqual([
      [1, 'zip', undefined, `email/${SHA}/att/1-parts.zip`],
      [2, 'step', 1, `email/${SHA}/att/2-bracket.step`],
      [3, 'dxf', 1, `email/${SHA}/att/3-plate.dxf`],
    ]);
    expect(records[1]).toMatchObject({ sha256: hex(STEP), size_bytes: STEP.length, content_type: 'model/step', filename: 'bracket.step' });
    expect(bucket.text(`email/${SHA}/att/2-bracket.step`)).toBe(STEP);
    expect(bucket.text(`email/${SHA}/att/3-plate.dxf`)).toBe(DXF);
    expect(records[0].flags).toBeUndefined();
    // The archive is never read whole: only range reads touch it, and entries are written as streams.
    expect(get).not.toHaveBeenCalled();
    expect(getRange.mock.calls.every(([key]) => key === `email/${SHA}/att/1-parts.zip`)).toBe(true);
    expect(getRange.mock.calls.every(([, , length]) => length <= 65_557 + 22)).toBe(true);
    const entryPuts = put.mock.calls.filter(([key]) => key !== `email/${SHA}/att/1-parts.zip`);
    expect(entryPuts.length).toBe(2);
    expect(entryPuts.every(([, body]) => body instanceof ReadableStream)).toBe(true);
  });

  it('an entry whose declared size disagrees with its stream is aborted, flagged and not stored', async () => {
    const longer = await storedZip([{ name: 'a.step', content: STEP, declaredSize: STEP.length - 10 }, { name: 'b.dxf', content: DXF }]);
    expect(longer.records.map((r) => r.kind)).toEqual(['zip', 'dxf']);
    expect(longer.records[0]).toMatchObject({ flags: ['zip_entry_size_mismatch'], skipped_entries: 1 });
    expect([...longer.bucket.objects.keys()].some((k) => k.includes('a.step'))).toBe(false);
    const shorter = await storedZip([{ name: 'a.step', content: STEP, declaredSize: STEP.length + 10 }]);
    expect(shorter.records[0]).toMatchObject({ flags: ['zip_entry_size_mismatch'], skipped_entries: 1 });
    expect(shorter.records).toHaveLength(1);
  });

  it('entry rules: encrypted, unsupported method, symlink, nested archive (by name and by bytes), ratio, empty', async () => {
    const nested = buildZip([{ name: 'inner.step', content: STEP }]);
    const { records } = await storedZip([
      { name: 'secret.step', content: STEP, encrypted: true },
      { name: 'bz.step', content: STEP, methodNumber: 12, method: 0 },
      { name: 'link.step', content: 'target', symlink: true },
      { name: 'inner.zip', content: nested },
      { name: 'disguised.step', content: nested },
      { name: 'bomb.step', content: 'a'.repeat(200_000) },
      { name: 'empty.step', content: '' },
      { name: 'ok.dxf', content: DXF },
    ]);
    expect(records.map((r) => r.kind)).toEqual(['zip', 'dxf']);
    expect(new Set(records[0].flags)).toEqual(new Set([
      'zip_entry_encrypted', 'zip_entry_unsupported_method', 'zip_entry_symlink', 'zip_entry_nested_archive', 'zip_entry_ratio', 'zip_entry_empty',
    ]));
    expect(records[0].skipped_entries).toBe(7);
  });

  it('archive rules: too many entries, ZIP64 markers and unreadable archives are kept unextracted and flagged', async () => {
    const many = await storedZip(Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `p${i}.dxf`, content: DXF })));
    expect(many.records).toHaveLength(1);
    expect(many.records[0].flags).toEqual(['zip_too_many_entries']);
    const z64 = await storedZip([{ name: 'a.dxf', content: DXF }], { zip64Marker: true });
    expect(z64.records[0].flags).toEqual(['zip_zip64']);
    const spies = blobWithSpies();
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(40)]);
    const records = await storeAttachments(spies.blob, SHA, [attachment(1, 'broken.zip', broken, 'application/zip')]);
    expect(records).toEqual([expect.objectContaining({ kind: 'zip', flags: ['zip_unreadable'] })]);
  });

  it('size limits are checked before any byte is read: per entry, total and ratio', () => {
    const e = (over: Partial<ZipEntry>): ZipEntry => ({ name: 'a.step', method: 8, flags: 0, compressedSize: 1000, uncompressedSize: 2000, localHeaderOffset: 0, isDirectory: false, isSymlink: false, encrypted: false, ...over });
    expect(entryProblem(e({}), 0)).toBeNull();
    expect(entryProblem(e({ uncompressedSize: ZIP_LIMITS.maxEntryBytes + 1, compressedSize: ZIP_LIMITS.maxEntryBytes }), 0)).toBe('too_large');
    expect(entryProblem(e({ uncompressedSize: 2_000_000, compressedSize: 1_000_000 }), ZIP_LIMITS.maxTotalBytes - 1_000_000)).toBe('total_limit');
    expect(entryProblem(e({ uncompressedSize: 101_000, compressedSize: 1000 }), 0)).toBe('ratio');
    expect(entryProblem(e({ method: 0, compressedSize: 5, uncompressedSize: 6 }), 0)).toBe('size_mismatch');
  });

  it('reads the central directory by range reads only and extracts a single entry on request', async () => {
    const { blob, getRange, get } = blobWithSpies();
    const zip = buildZip([{ name: 'a.dxf', content: DXF }]);
    await blob.put('z.zip', zip.buffer as ArrayBuffer, { contentType: 'application/zip' });
    const cd = await readCentralDirectory(blob, 'z.zip', zip.length);
    expect(cd.ok).toBe(true);
    if (!cd.ok) return;
    expect(cd.entries.map((x) => [x.name, x.uncompressedSize])).toEqual([['a.dxf', DXF.length]]);
    const out = await extractEntry(blob, 'z.zip', cd.entries[0], 'out.dxf', () => 'image/vnd.dxf');
    expect(out).toEqual({ ok: true, kind: 'dxf', sha256: hex(DXF), size: DXF.length });
    expect(get).not.toHaveBeenCalled();
    expect(getRange).toHaveBeenCalled();
  });

  it('uses FixedLengthStream with the declared size when the runtime provides it', async () => {
    const created: number[] = [];
    class FakeFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
      constructor(size: number) {
        super();
        created.push(size);
      }
    }
    const g = globalThis as { FixedLengthStream?: unknown };
    g.FixedLengthStream = FakeFixedLengthStream;
    try {
      const { records } = await storedZip([{ name: 'a.step', content: STEP }]);
      expect(records.map((r: AttachmentRecord) => r.kind)).toEqual(['zip', 'step']);
      expect(created).toEqual([STEP.length]);
    } finally {
      delete g.FixedLengthStream;
    }
  });
});
