// ZIP attachments of inbound mail: the entries are extracted one at a time from the stored archive in R2, by range
// reads, and streamed to their own R2 objects; neither the archive nor an entry is ever held in memory as a whole
// (128 MB isolate).
//
// Rules (an archive that breaks an archive rule is kept as it is, unextracted, and flagged)
//   - Archive: one level only; at most ZIP_LIMITS.maxEntries file entries; at most maxTotalBytes uncompressed over
//     the extracted entries; a readable end-of-central-directory record; no ZIP64 fields; the central directory at
//     most maxCentralDirectoryBytes.
//   - Entry (an entry that breaks an entry rule is skipped and counted on the archive's flags): stored (0) or
//     deflate (8) only; not encrypted; not a symbolic link; not an archive itself (by name, or by its first bytes);
//     at most maxEntryBytes uncompressed; declared ratio uncompressed / compressed at most maxRatio; the streamed
//     size must equal the declared size, else the entry is aborted and not stored.
//   - Directory entries and resource-fork entries (__MACOSX/, ._name) are ignored.
//   - Read path: BlobPort.head (archive size), BlobPort.getRange for the end record, the central directory, each
//     local header and each entry's data. Write path: DecompressionStream('deflate-raw') -> size and SHA-256 check
//     -> FixedLengthStream(<declared size>) where the runtime has it -> BlobPort.put.

import type { BlobPort } from '../ports/index';
import type { AttachmentKind } from './parse';
import { Sha256 } from './sha256';
import { extensionOf, isArchiveContainer, sniffKind } from './sniff';

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 50,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxRatio: 100,
  maxCentralDirectoryBytes: 1024 * 1024,
});

export type ZipArchiveProblem = 'unreadable' | 'zip64' | 'too_many_entries' | 'central_directory_too_large';
export type ZipEntryProblem =
  | 'encrypted'
  | 'unsupported_method'
  | 'symlink'
  | 'nested_archive'
  | 'too_large'
  | 'ratio'
  | 'total_limit'
  | 'size_mismatch'
  | 'empty'
  | 'unreadable';

export interface ZipEntry {
  /** Path inside the archive as stored (decoded). */
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
  isSymlink: boolean;
  encrypted: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
const NESTED_EXTENSIONS = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso']);

async function readRange(blob: BlobPort, key: string, offset: number, length: number): Promise<Uint8Array | null> {
  if (length === 0) return new Uint8Array(0);
  const stream = await blob.getRange(key, offset, length);
  if (!stream) return null;
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytes.length === length ? bytes : null;
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  // Without the UTF-8 flag the name is CP437; printable ASCII is the same, other bytes are shown as '_'.
  let out = '';
  for (const b of bytes) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '_';
  return out;
}

export type CentralDirectory = { ok: true; entries: ZipEntry[] } | { ok: false; problem: ZipArchiveProblem };

/** Reads the end record and the central directory of a stored archive by range reads. */
export async function readCentralDirectory(blob: BlobPort, key: string, size: number): Promise<CentralDirectory> {
  if (size < EOCD_MIN) return { ok: false, problem: 'unreadable' };
  const tailLength = Math.min(size, EOCD_SEARCH);
  const tail = await readRange(blob, key, size - tailLength, tailLength);
  if (!tail) return { ok: false, problem: 'unreadable' };
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, problem: 'unreadable' };
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, problem: 'zip64' };
  if (cdSize > ZIP_LIMITS.maxCentralDirectoryBytes) return { ok: false, problem: 'central_directory_too_large' };
  if (cdOffset + cdSize > size) return { ok: false, problem: 'unreadable' };
  const cd = await readRange(blob, key, cdOffset, cdSize);
  if (!cd) return { ok: false, problem: 'unreadable' };
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < total; k++) {
    if (p + 46 > cd.length || cdView.getUint32(p, true) !== CEN_SIGNATURE) return { ok: false, problem: 'unreadable' };
    const madeBy = cdView.getUint16(p + 4, true);
    const flags = cdView.getUint16(p + 8, true);
    const method = cdView.getUint16(p + 10, true);
    const compressedSize = cdView.getUint32(p + 20, true);
    const uncompressedSize = cdView.getUint32(p + 24, true);
    const nameLength = cdView.getUint16(p + 28, true);
    const extraLength = cdView.getUint16(p + 30, true);
    const commentLength = cdView.getUint16(p + 32, true);
    const external = cdView.getUint32(p + 38, true);
    const localHeaderOffset = cdView.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) return { ok: false, problem: 'zip64' };
    if (p + 46 + nameLength > cd.length) return { ok: false, problem: 'unreadable' };
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLength), (flags & 0x0800) !== 0);
    const unixMode = (madeBy >> 8) === 3 ? external >>> 16 : 0;
    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/') || name.endsWith('\\'),
      isSymlink: (unixMode & 0xf000) === 0xa000,
      encrypted: (flags & 0x0001) !== 0,
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries };
}

/** True for entries that are archive metadata rather than content (ignored without a flag). */
export function isIgnoredEntry(e: ZipEntry): boolean {
  if (e.isDirectory) return true;
  const base = e.name.split(/[/\\]/).pop() ?? '';
  return e.name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || base === '';
}

/** The entry rule an entry breaks before any byte is read, or null. */
export function entryProblem(e: ZipEntry, extractedSoFar: number): ZipEntryProblem | null {
  if (e.encrypted) return 'encrypted';
  if (e.method !== 0 && e.method !== 8) return 'unsupported_method';
  if (e.isSymlink) return 'symlink';
  if (NESTED_EXTENSIONS.has(extensionOf(e.name))) return 'nested_archive';
  if (e.uncompressedSize === 0) return 'empty';
  if (e.uncompressedSize > ZIP_LIMITS.maxEntryBytes) return 'too_large';
  if (e.method === 0 && e.compressedSize !== e.uncompressedSize) return 'size_mismatch';
  if (e.uncompressedSize / Math.max(e.compressedSize, 1) > ZIP_LIMITS.maxRatio) return 'ratio';
  if (extractedSoFar + e.uncompressedSize > ZIP_LIMITS.maxTotalBytes) return 'total_limit';
  return null;
}

class EntrySizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntrySizeError';
  }
}

/** Passes bytes through, hashes them and errors as soon as they exceed `declared` or end short of it. */
function sizeCheck(declared: number, hash: Sha256): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > declared) {
        controller.error(new EntrySizeError('entry longer than declared'));
        return;
      }
      hash.update(chunk);
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (seen !== declared) controller.error(new EntrySizeError('entry shorter than declared'));
    },
  });
}

interface FixedLengthStreamLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

function fixedLengthStream(size: number): FixedLengthStreamLike | null {
  const Ctor = (globalThis as { FixedLengthStream?: new (n: number) => FixedLengthStreamLike }).FixedLengthStream;
  return typeof Ctor === 'function' ? new Ctor(size) : null;
}

/** Reads the first `bytes` of a stream (or all of it when shorter) and a stream of the whole content. */
async function peek(source: ReadableStream<Uint8Array>, bytes: number): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let done = false;
  while (length < bytes) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    chunks.push(next.value);
    length += next.value.byteLength;
  }
  const head = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    head.set(c, offset);
    offset += c.byteLength;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.byteLength) controller.enqueue(head);
      if (done) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head, stream };
}

export type ExtractResult =
  | { ok: true; kind: AttachmentKind; sha256: string; size: number }
  | { ok: false; problem: ZipEntryProblem };

/**
 * Streams one entry of the stored archive `archiveKey` to `targetKey`. `contentTypeOf(kind)` names the stored
 * object's type once the entry's first bytes are known.
 */
export async function extractEntry(
  blob: BlobPort,
  archiveKey: string,
  entry: ZipEntry,
  targetKey: string,
  contentTypeOf: (kind: AttachmentKind, head: Uint8Array) => string,
): Promise<ExtractResult> {
  const local = await readRange(blob, archiveKey, entry.localHeaderOffset, 30);
  if (!local) return { ok: false, problem: 'unreadable' };
  const lv = new DataView(local.buffer, local.byteOffset, local.byteLength);
  if (lv.getUint32(0, true) !== LOC_SIGNATURE) return { ok: false, problem: 'unreadable' };
  const dataOffset = entry.localHeaderOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  const raw = await blob.getRange(archiveKey, dataOffset, entry.compressedSize);
  if (!raw) return { ok: false, problem: 'unreadable' };
  const inflated = entry.method === 8 ? raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>) : (raw as ReadableStream<Uint8Array>);
  let peeked: { head: Uint8Array; stream: ReadableStream<Uint8Array> };
  try {
    peeked = await peek(inflated, 4096);
  } catch {
    return { ok: false, problem: 'unreadable' };
  }
  const kind = sniffKind(peeked.head, entry.name, '', entry.uncompressedSize);
  if (kind === 'zip' || isArchiveContainer(peeked.head, entry.name)) {
    await peeked.stream.cancel().catch(() => undefined);
    return { ok: false, problem: 'nested_archive' };
  }
  const hash = new Sha256();
  const checked = peeked.stream.pipeThrough(sizeCheck(entry.uncompressedSize, hash));
  const fixed = fixedLengthStream(entry.uncompressedSize);
  const contentType = contentTypeOf(kind, peeked.head);
  try {
    if (fixed) {
      const piping = checked.pipeTo(fixed.writable).then(
        () => null,
        (e: unknown) => e,
      );
      await blob.put(targetKey, fixed.readable, { contentType });
      const pipeError = await piping;
      if (pipeError) throw pipeError;
    } else {
      await blob.put(targetKey, checked, { contentType });
    }
  } catch (e) {
    if (e instanceof EntrySizeError || (e instanceof Error && /declared|length/i.test(e.message))) return { ok: false, problem: 'size_mismatch' };
    return { ok: false, problem: 'unreadable' };
  }
  return { ok: true, kind, sha256: hash.hex(), size: entry.uncompressedSize };
}
