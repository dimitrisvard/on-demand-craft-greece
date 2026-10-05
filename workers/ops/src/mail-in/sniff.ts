// Kind of an attachment from its bytes (magic numbers), never from the sender's file name or MIME type alone.
//
//   pdf    '%PDF-'
//   image  PNG signature or JPEG SOI marker (FF D8 FF)
//   zip    'PK\x03\x04' (or the empty-archive 'PK\x05\x06') with a .zip name or a zip MIME type; office documents
//          (docx, xlsx, pptx, odt, ...) are zip containers too and stay 'other'
//   step   text starting with 'ISO-10303-21' (after an optional BOM and white space)
//   dxf    group code 0 + SECTION at the start (optionally after 999 comment groups), or the binary DXF sentinel
//   stl    ASCII 'solid' followed by 'facet' within the first 1 KB, or a binary STL whose size is exactly
//          84 + 50 x <triangle count in bytes 80-83>
//   other  everything else

import type { AttachmentKind } from './parse';

const OFFICE_EXTENSIONS = new Set(['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'jar', 'apk', 'epub', '3mf', 'kmz']);
const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip']);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function headText(bytes: Uint8Array, max = 4096): string {
  let out = '';
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** True for bytes that start a ZIP container that is not an office document (by name). */
export function isArchiveContainer(bytes: Uint8Array, filename: string): boolean {
  const zipMagic = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
  return zipMagic && !OFFICE_EXTENSIONS.has(extensionOf(filename));
}

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(name ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Kind of a file from its first bytes. `totalSize` is the size of the whole file when `content` is only its head
 * (streamed archive entries); the binary STL rule needs it.
 */
export function sniffKind(content: ArrayBuffer | Uint8Array, filename = '', mime = '', totalSize?: number): AttachmentKind {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const size = totalSize ?? bytes.length;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const ext = extensionOf(filename);
    if (OFFICE_EXTENSIONS.has(ext)) return 'other';
    return ext === 'zip' || ZIP_TYPES.has(mime.toLowerCase()) ? 'zip' : 'other';
  }
  const head = headText(bytes);
  const text = head.replace(/^﻿|^\xEF\xBB\xBF/, '');
  if (/^\s*ISO-10303-21\s*;/.test(text)) return 'step';
  if (text.startsWith('AutoCAD Binary DXF')) return 'dxf';
  if (/^(?:\s*999\s*\r?\n[^\r\n]*\r?\n)*\s*0\s*\r?\n\s*SECTION\s*\r?\n/.test(text)) return 'dxf';
  if (/^\s*solid\b/i.test(text) && /\bfacet\b/i.test(text.slice(0, 1024))) return 'stl';
  if (bytes.length >= 84) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (count > 0 && size === 84 + 50 * count) return 'stl';
  }
  return 'other';
}

/** Kinds the intake copies into the RFQ's files. */
export const RFQ_FILE_KINDS: ReadonlySet<AttachmentKind> = new Set(['step', 'stl', 'dxf', 'pdf', 'image']);

/** Kinds that become CAD jobs. */
export const CAD_KINDS: ReadonlySet<AttachmentKind> = new Set(['step', 'stl', 'dxf']);

/** MIME type stored with an attachment of a kind (the sender's type when the kind has no fixed one). */
export function contentTypeFor(kind: AttachmentKind, senderType: string, bytes?: Uint8Array): string {
  switch (kind) {
    case 'pdf':
      return 'application/pdf';
    case 'image':
      return bytes && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ? 'image/png' : 'image/jpeg';
    case 'zip':
      return 'application/zip';
    case 'step':
      return 'model/step';
    case 'stl':
      return 'model/stl';
    case 'dxf':
      return 'image/vnd.dxf';
    default:
      return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(senderType) ? senderType.toLowerCase() : 'application/octet-stream';
  }
}
