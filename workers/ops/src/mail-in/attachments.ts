// Stores the attachments of a parsed inbound mail in R2 (email/<sha>/att/<n>-<safe name>) and describes them for
// inbound_emails.attachments and the intake steps.
//
// Rules
//   - Every MIME attachment is stored with its SHA-256 (R2 verifies it on put); the same key on a retry, so the step
//     is idempotent. The kind comes from the bytes (sniff.ts).
//   - A ZIP attachment is stored as it is, then its entries are extracted from R2 one at a time (zip.ts); extracted
//     entries are numbered after the last MIME attachment, in archive order, and carry `parent` = the archive's n.
//     Problems are recorded on the archive's record as flags ('zip_<problem>' for the archive,
//     'zip_entry_<problem>' once per kind of entry problem) with the number of skipped entries.
//   - Records hold names, kinds, sizes and hashes only (no content, no address).

import type { BlobPort } from '../ports/index';
import { sha256hex } from '../agents/ids';
import type { AttachmentKind, ParsedAttachment } from './parse';
import { attachmentKey, displayName } from './safe-name';
import { contentTypeFor, sniffKind } from './sniff';
import { entryProblem, extractEntry, isIgnoredEntry, readCentralDirectory, ZIP_LIMITS, type ZipEntryProblem } from './zip';

/** One element of inbound_emails.attachments. */
export interface AttachmentRecord {
  n: number;
  r2_key: string;
  /** Name shown to staff (the sender's name, cleaned; never used in a key). */
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  kind: AttachmentKind;
  /** A signature or logo (a small image the HTML part references by Content-ID, parse.ts); never another kind. */
  inline?: boolean;
  /** n of the archive this entry was extracted from. */
  parent?: number;
  flags?: string[];
  /** Archive: entries not extracted because they broke an entry rule. */
  skipped_entries?: number;
}

async function storeOne(blob: BlobPort, sha: string, a: ParsedAttachment): Promise<AttachmentRecord> {
  const bytes = new Uint8Array(a.content);
  const digest = await sha256hex(bytes);
  const kind = sniffKind(bytes, a.filename, a.mime);
  const contentType = contentTypeFor(kind, a.mime, bytes);
  const key = attachmentKey(sha, a.n, a.filename);
  await blob.put(key, a.content, { contentType, sha256: digest });
  const record: AttachmentRecord = {
    n: a.n,
    r2_key: key,
    filename: displayName(a.filename, `attachment-${a.n}`),
    content_type: contentType,
    size_bytes: bytes.byteLength,
    sha256: digest,
    kind,
  };
  // Only an image can be a signature or logo; any other kind (STEP, PDF, ...) is always an RFQ file.
  if (a.inline && kind === 'image') record.inline = true;
  return record;
}

/** Extracts the entries of a stored archive; returns the entry records and updates the archive record's flags. */
export async function expandArchive(blob: BlobPort, sha: string, archive: AttachmentRecord, firstN: number): Promise<AttachmentRecord[]> {
  const flags = new Set<string>(archive.flags ?? []);
  const out: AttachmentRecord[] = [];
  const cd = await readCentralDirectory(blob, archive.r2_key, archive.size_bytes);
  if (!cd.ok) {
    flags.add(`zip_${cd.problem}`);
    archive.flags = [...flags];
    return out;
  }
  const entries = cd.entries.filter((e) => !isIgnoredEntry(e));
  if (entries.length > ZIP_LIMITS.maxEntries) {
    flags.add('zip_too_many_entries');
    archive.flags = [...flags];
    return out;
  }
  let extracted = 0;
  let skipped = 0;
  let n = firstN;
  for (const entry of entries) {
    const before: ZipEntryProblem | null = entryProblem(entry, extracted);
    if (before) {
      skipped++;
      flags.add(`zip_entry_${before}`);
      continue;
    }
    const name = entry.name.split(/[/\\]/).pop() || `entry-${n}`;
    const key = attachmentKey(sha, n, name);
    const result = await extractEntry(blob, archive.r2_key, entry, key, (kind, head) => contentTypeFor(kind, 'application/octet-stream', head));
    if (!result.ok) {
      skipped++;
      flags.add(`zip_entry_${result.problem}`);
      continue;
    }
    extracted += result.size;
    out.push({
      n,
      r2_key: key,
      filename: displayName(name, `entry-${n}`),
      content_type: contentTypeFor(result.kind, 'application/octet-stream'),
      size_bytes: result.size,
      sha256: result.sha256,
      kind: result.kind,
      parent: archive.n,
    });
    n++;
  }
  if (skipped) archive.skipped_entries = skipped;
  if (flags.size) archive.flags = [...flags];
  return out;
}

/** Stores every attachment (and the entries of ZIP attachments); records in n order. */
export async function storeAttachments(blob: BlobPort, sha: string, attachments: readonly ParsedAttachment[]): Promise<AttachmentRecord[]> {
  const records: AttachmentRecord[] = [];
  for (const a of attachments) records.push(await storeOne(blob, sha, a));
  let next = records.reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const expanded: AttachmentRecord[] = [];
  for (const record of records) {
    if (record.kind !== 'zip') continue;
    const entries = await expandArchive(blob, sha, record, next);
    next += entries.length;
    expanded.push(...entries);
  }
  return [...records, ...expanded];
}

/** Kinds present (for cards and step results), e.g. ['step', 'pdf']. */
export function kindsOf(records: readonly AttachmentRecord[]): AttachmentKind[] {
  return [...new Set(records.filter((r) => !r.inline).map((r) => r.kind))].sort();
}
