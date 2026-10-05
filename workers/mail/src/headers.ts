// Header helpers of microns-mail (no MIME body parsing: the intake Workflow in microns-ops parses the body).
//
// Rules
//   - Recipient (envelope RCPT TO) lower-cased must be one of ALLOWED_RCPT; its local part names the mailbox ('rfq'
//     or 'replies').
//   - message_id_sha256 = lower-case hex SHA-256 of the UTF-8 bytes of the Message-ID header value after trimming
//     (angle brackets and case kept); without the header, SHA-256 of the raw MIME bytes.
//   - References: the <...> ids in order, at most 100. In-Reply-To: the first <...> id, else the trimmed value.
//   - From: RFC 2047 encoded words decoded; the address lower-cased; falls back to the envelope sender.
//   - Subject: encoded words decoded, control characters removed, at most 998 characters.
//   - Authentication-Results instances are read from the raw header block, top to bottom (Headers.get would join
//     several instances with commas); the record follows workers/ops/src/mail-in/auth-results.ts.

import { authResultsOf, type AuthResults } from '../../ops/src/mail-in/auth-results';

export type Mailbox = 'rfq' | 'replies';

export const SUBJECT_MAX = 998;
export const MAX_REFERENCES = 100;
/** The header block is read from at most this many bytes of the raw message. */
export const HEADER_SCAN_BYTES = 256 * 1024;

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** The trimmed Message-ID header value, or null when absent or blank. */
export function trimmedMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** message_id_sha256 of a message (see the rules above). */
export async function messageIdSha256(messageId: string | null, raw: ArrayBuffer): Promise<string> {
  return messageId ? sha256hex(messageId) : sha256hex(raw);
}

/** Mailbox of an accepted recipient, or null when the recipient is not in ALLOWED_RCPT. */
export function mailboxOf(recipient: string, allowedRcpt: string): Mailbox | null {
  const rcpt = String(recipient ?? '').trim().toLowerCase();
  const allowed = String(allowedRcpt ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!rcpt || !allowed.includes(rcpt)) return null;
  const local = rcpt.slice(0, rcpt.indexOf('@'));
  return local === 'rfq' || local === 'replies' ? local : null;
}

/** The <...> ids of a References or In-Reply-To value, in order, at most `max`. */
export function messageIdTokens(value: string | null | undefined, max = MAX_REFERENCES): string[] {
  const out: string[] = [];
  for (const match of String(value ?? '').matchAll(/<[^<>\s]+>/g)) {
    if (out.length >= max) break;
    out.push(match[0]);
  }
  return out;
}

export function inReplyToOf(value: string | null | undefined): string | null {
  return messageIdTokens(value, 1)[0] ?? trimmedMessageId(value);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = charset.toLowerCase().replace(/\*.*$/, '');
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // Unknown label: Latin-1 keeps every byte as one character.
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const binary = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function qBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '_') out.push(0x20);
    else if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(ch.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** Decodes RFC 2047 encoded words; white space between two adjacent encoded words is dropped. */
export function decodeEncodedWords(value: string): string {
  const joined = value.replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?)/g, '$1');
  return joined.replace(ENCODED_WORD, (whole, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toUpperCase() === 'B' ? base64Bytes(text) : qBytes(text);
      return decodeBytes(bytes, charset);
    } catch {
      return whole;
    }
  });
}

/** Subject as stored: decoded, without control characters, at most 998 characters; null when absent. */
export function subjectOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = decodeEncodedWords(value.replace(/\r?\n[ \t]+/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text.slice(0, SUBJECT_MAX);
}

/** Address and display name of a From value ('Name <a@b>', '"Name" <a@b>', 'a@b', 'a@b (Name)'). */
export function parseFrom(value: string | null | undefined, envelopeFrom: string): { email: string; name: string | null } {
  const raw = String(value ?? '').replace(/\r?\n[ \t]+/g, ' ').trim();
  const fallback = { email: String(envelopeFrom ?? '').trim().toLowerCase(), name: null };
  if (!raw) return fallback;
  const angle = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(raw);
  if (angle) {
    let name = angle[1].trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
    name = decodeEncodedWords(name).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return { email: angle[2].toLowerCase(), name: name || null };
  }
  const bare = /^([^\s<>()"]+@[^\s<>()"]+)\s*(?:\((.*)\))?$/.exec(raw);
  if (bare) {
    const name = bare[2] ? decodeEncodedWords(bare[2]).trim() : '';
    return { email: bare[1].toLowerCase(), name: name || null };
  }
  return fallback;
}

/** Values of every instance of a header in the raw header block, top to bottom (unfolded). */
export function rawHeaderValues(raw: ArrayBuffer | Uint8Array, name: string): string[] {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const head = bytes.subarray(0, Math.min(bytes.length, HEADER_SCAN_BYTES));
  let text = '';
  for (const b of head) text += String.fromCharCode(b);
  const end = text.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, ' ');
  const wanted = name.toLowerCase();
  const out: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === wanted) out.push(line.slice(colon + 1).trim());
  }
  return out;
}

/** inbound_emails.auth_results of a raw message. */
export function authResultsOfRaw(raw: ArrayBuffer | Uint8Array): AuthResults {
  return authResultsOf(rawHeaderValues(raw, 'authentication-results'));
}
