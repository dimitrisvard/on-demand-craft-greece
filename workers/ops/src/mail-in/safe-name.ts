// File names and R2 keys of inbound mail and of the RFQ files made from it.
//
//   attachment     email/<message_id_sha256>/att/<n>-<safe name>
//   rfq file       file_path <rfq_id>/<file_id>-<safe name>, r2_key 'rfq/' + file_path (the Phase 2 files API
//                  prefixes 'rfq/' to file_path), file_id = UUIDv5(rfq_id, sha256 of the bytes)
//
// Rules
//   - A sender's file name is used only as the last segment of a key, after safeName(): NFC, last path segment,
//     control characters removed, every character outside [A-Za-z0-9._-] replaced by '_', at most 100 characters
//     with the extension kept, empty or dots-only -> 'file'.
//   - displayName() is the name shown to staff: NFC, control characters removed, at most 200 characters.

import { safeName } from '../agents/ids';

export { safeName };

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** R2 key of attachment n of a stored message. */
export function attachmentKey(messageIdSha256: string, n: number, name: string): string {
  if (!HEX64.test(messageIdSha256)) throw new Error('attachmentKey: message_id_sha256 must be 64 lower-case hex');
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('attachmentKey: n must be an integer >= 1');
  return `email/${messageIdSha256}/att/${n}-${safeName(name)}`;
}

/** R2 key of the raw MIME of a stored message. */
export function rawKey(messageIdSha256: string): string {
  if (!HEX64.test(messageIdSha256)) throw new Error('rawKey: message_id_sha256 must be 64 lower-case hex');
  return `email/${messageIdSha256}/raw.eml`;
}

/** R2 key of the quote-stripped plain text of a stored message (read by the LLM steps of the intake). */
export function bodyTextKey(messageIdSha256: string): string {
  if (!HEX64.test(messageIdSha256)) throw new Error('bodyTextKey: message_id_sha256 must be 64 lower-case hex');
  return `email/${messageIdSha256}/body.txt`;
}

/** rfq_files.file_path and r2_key of an agent-written RFQ file. */
export function rfqFileLocation(rfqId: string, fileId: string, name: string): { file_path: string; r2_key: string } {
  if (!UUID.test(rfqId) || !UUID.test(fileId)) throw new Error('rfqFileLocation: rfq_id and file_id must be uuids');
  const file_path = `${rfqId}/${fileId}-${safeName(name)}`;
  return { file_path, r2_key: `rfq/${file_path}` };
}

/** Name shown to staff (never used in a key). */
export function displayName(name: string | null | undefined, fallback = 'attachment'): string {
  const value = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (!value) return fallback;
  return value.length <= 200 ? value : value.slice(0, 200);
}

/** UUID version 5 (SHA-1, RFC 9562 §5.5) of a name in a namespace uuid. */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  if (!UUID.test(namespace)) throw new Error('uuidV5: namespace must be a uuid');
  const ns = new Uint8Array(16);
  const hex = namespace.replace(/-/g, '');
  for (let i = 0; i < 16; i++) ns[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, 16);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
