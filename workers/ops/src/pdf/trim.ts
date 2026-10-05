// PDF attachments for the model: only the first pages are sent (pages 1-5 by default), copied into a new document.
// Used by the intake extract step (IN); CAD files are never sent to the model.
//
// Rules
//   - PDFDocument.load with ignoreEncryption; an encrypted file is reported as 'encrypted' (its content streams
//     cannot be read), a file that does not load or has no page as 'unreadable'. Either way the card lists the file
//     as unreadable and nothing of it goes to the model.
//   - The trimmed copy carries no metadata of the original (title, author, producer) and has fixed dates, so the
//     same input gives the same bytes (and the same LLM fixture hash).

import { PDFDocument } from 'pdf-lib';

export const TRIM_MAX_PAGES = 5;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

export type TrimResult =
  | { ok: true; bytes: Uint8Array; pages: number; total_pages: number; truncated: boolean }
  | { ok: false; reason: 'encrypted' | 'unreadable' };

export async function trimPdf(input: ArrayBuffer | Uint8Array, maxPages = TRIM_MAX_PAGES): Promise<TrimResult> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (source.isEncrypted) return { ok: false, reason: 'encrypted' };
  try {
    const total = source.getPageCount();
    if (total === 0) return { ok: false, reason: 'unreadable' };
    const keep = Math.min(Math.max(1, Math.floor(maxPages)), total);
    const out = await PDFDocument.create({ updateMetadata: false });
    out.setCreationDate(FIXED_DATE);
    out.setModificationDate(FIXED_DATE);
    const pages = await out.copyPages(source, [...Array(keep).keys()]);
    for (const page of pages) out.addPage(page);
    const bytes = await out.save({ useObjectStreams: false });
    return { ok: true, bytes, pages: keep, total_pages: total, truncated: keep < total };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** Standard base64 of bytes (for an LLM document block). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}
