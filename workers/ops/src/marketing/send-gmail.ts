// Campaign mail through a Google Workspace sender account: the Phase 4 Gmail port issues the access token
// (GmailPort.accessToken: the stored token while valid, else a refresh in memory, never written back) and the
// Phase 5 gmailSend port posts the raw message to users/me/messages/send.
//
// Rules
//   - The message is RFC 5322 with CRLF line ends: From "<display_name> <email>" (the repo's From form; the display
//     name is RFC 2047 encoded when it is not ASCII, or quoted when it holds specials), To, Subject (RFC 2047
//     base64 encoded words when not ASCII), MIME-Version 1.0, Content-Type text/html; charset=UTF-8,
//     Content-Transfer-Encoding base64 with 76-character lines. Gmail adds Date and Message-ID.
//   - CR and LF never reach a header value (they are replaced by spaces), so no header can be injected.
//   - A token answer 'invalid_grant' is a final failure (the grant must be reconnected); 'unavailable' is retryable.
//   - Results carry the provider status and a short reason only, never the token, an address or the body.

import type { GmailPort, GmailProviderConfig } from '../ports/index';
import type { GmailSendPort } from '../ports/p5';

export type SendOutcome = { ok: true; provider_id: string } | { ok: false; retryable: boolean; status: number | null; error: string };

const encoder = new TextEncoder();

function headerValue(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function isAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/** RFC 2047 encoded words (UTF-8, base64), split so that no word exceeds 75 characters and no character is cut. */
export function encodeWords(text: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const ch of text) {
    const next = chunk + ch;
    if (encoder.encode(next).length > 45) {
      words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`);
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  if (chunk !== '' || words.length === 0) words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`);
  return words.join('\r\n ');
}

/** A header text as is when it is printable ASCII, else as encoded words. */
export function encodeHeaderText(text: string): string {
  const clean = headerValue(text);
  return isAscii(clean) ? clean : encodeWords(clean);
}

/** "<display name> <address>" with the display name quoted or encoded where RFC 5322 needs it. */
export function mailbox(displayName: string | null | undefined, address: string): string {
  const addr = headerValue(address).trim();
  const name = headerValue(displayName ?? '').trim();
  if (!name) return `<${addr}>`;
  if (!isAscii(name)) return `${encodeWords(name)} <${addr}>`;
  if (/[()<>[\]:;@\\,."]/.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${addr}>`;
  return `${name} <${addr}>`;
}

/** The raw RFC 5322 message (rules above). */
export function buildMime(m: { fromName: string | null; fromEmail: string; to: string; subject: string; html: string }): Uint8Array {
  const body = base64(encoder.encode(m.html)).replace(/.{76}(?=.)/g, '$&\r\n');
  const lines = [
    `From: ${mailbox(m.fromName, m.fromEmail)}`,
    `To: ${headerValue(m.to).trim()}`,
    `Subject: ${encodeHeaderText(m.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ];
  return encoder.encode(lines.join('\r\n'));
}

/** Sends one campaign mail through a Google Workspace account. */
export async function sendViaGmail(
  gmail: GmailPort,
  gmailSend: GmailSendPort,
  account: { id: string; email: string; display_name: string | null; is_active: boolean; provider: string },
  config: GmailProviderConfig | null,
  m: { to: string; subject: string; html: string },
): Promise<SendOutcome> {
  const token = await gmail.accessToken({ id: account.id, email: account.email, provider: account.provider, is_active: account.is_active, provider_config: config });
  if ('error' in token) {
    return token.error === 'invalid_grant'
      ? { ok: false, retryable: false, status: null, error: 'gmail_invalid_grant' }
      : { ok: false, retryable: true, status: null, error: 'gmail_token_unavailable' };
  }
  const raw = buildMime({ fromName: account.display_name, fromEmail: account.email, to: m.to, subject: m.subject, html: m.html });
  const sent = await gmailSend.send(token.token, raw);
  if (sent.ok) return { ok: true, provider_id: sent.id };
  return { ok: false, retryable: sent.retryable, status: sent.status, error: `gmail_send_${sent.status}` };
}
