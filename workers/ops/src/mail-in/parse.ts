// MIME parsing of stored inbound mail (raw MIME from R2), shared by the intake Workflow and the reply consumer.
// Header values and text are returned for the agent steps; nothing here is logged.
//
// Rules
//   - postal-mime parses the message; attachments come back as bytes, numbered n = 1, 2, ... in message order.
//   - The plain-text part is the body; a message with an HTML part only gets its text from htmlToText(): scripts,
//     styles and comments dropped, block elements become line breaks, entities decoded. HTML is never kept or
//     rendered (the dashboard shows text only).
//   - Message ids keep their angle brackets and case (trimmed); References is split into at most 100 <...> ids.
//   - Header values used for rules (Auto-Submitted, Precedence, List-Id, Content-Type) are returned as they are,
//     trimmed; every Authentication-Results instance is returned top to bottom.
//   - An attachment is 'inline' (a signature or logo, left out of RFQ files, CAD jobs and the model input) only when
//     it is an image of at most INLINE_LOGO_MAX_BYTES whose Content-ID the HTML part references (cid:). The
//     Content-Disposition decides nothing: mail clients send PDFs, drawings and photos inline as well.

import PostalMime from 'postal-mime';

export type AttachmentKind = 'step' | 'dxf' | 'stl' | 'pdf' | 'image' | 'zip' | 'other';

export interface ParsedHeaders {
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from_email: string | null;
  from_name: string | null;
  to: string[];
  subject: string | null;
  date: string | null;
  auto_submitted: string | null;
  precedence: string | null;
  list_id: string | null;
  content_type: string | null;
  /** Every Authentication-Results value, top to bottom. */
  authentication_results?: string[];
}

export interface ParsedAttachment {
  /** 1-based position in the message. */
  n: number;
  filename: string;
  mime: string;
  size: number;
  content: ArrayBuffer;
  /** A signature or logo: a small image referenced by Content-ID from the HTML part (see the rules above). */
  inline?: boolean;
}

export interface ParsedMail {
  headers: ParsedHeaders;
  /** Plain text body (HTML converted to text when there is no plain part). */
  text: string;
  /** True when text was derived from the HTML part. */
  from_html: boolean;
  attachments: ParsedAttachment[];
}

export const MAX_REFERENCES = 100;
/** Largest image treated as a signature or logo when the HTML part references it by Content-ID. */
export const INLINE_LOGO_MAX_BYTES = 64 * 1024;

/** A Content-ID or cid: reference without angle brackets, URL escapes decoded, lower case. */
function normaliseCid(value: string): string {
  let v = value.trim().replace(/^<|>$/g, '');
  try {
    v = decodeURIComponent(v);
  } catch {
    // keep the value as written
  }
  return v.toLowerCase();
}

/** Content-IDs the HTML part references (cid:...). */
export function cidReferences(html: string | null | undefined): Set<string> {
  const refs = new Set<string>();
  for (const m of String(html ?? '').matchAll(/\bcid:([^"'\s)>]+)/gi)) refs.add(normaliseCid(m[1]));
  return refs;
}

/** True for a signature or logo (see the rules above). */
export function isInlineLogo(a: { mime: string; size: number; contentId?: string | null }, refs: ReadonlySet<string>): boolean {
  if (!a.mime.startsWith('image/') || a.size > INLINE_LOGO_MAX_BYTES || !a.contentId) return false;
  return refs.has(normaliseCid(a.contentId));
}

/** Message ids of a References / In-Reply-To value: the <...> tokens in order, at most `max`. */
export function messageIdTokens(value: string | null | undefined, max = MAX_REFERENCES): string[] {
  const out: string[] = [];
  for (const match of String(value ?? '').matchAll(/<[^<>\s]+>/g)) {
    if (out.length >= max) break;
    out.push(match[0]);
  }
  return out;
}

// Named entities common in business mail; any other named entity is left as written.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', plusmn: '\u00b1', deg: '\u00b0', euro: '\u20ac',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', times: '\u00d7', divide: '\u00f7', micro: '\u00b5', ndash: '\u2013',
  mdash: '\u2014', hellip: '\u2026', bull: '\u2022', middot: '\u00b7', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c',
  rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', sect: '\u00a7', para: '\u00b6', sup2: '\u00b2', sup3: '\u00b3',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', oslash: '\u00f8', Oslash: '\u00d8', auml: '\u00e4', Auml: '\u00c4',
  ouml: '\u00f6', Ouml: '\u00d6', uuml: '\u00fc', Uuml: '\u00dc', szlig: '\u00df', eacute: '\u00e9', Eacute: '\u00c9',
  egrave: '\u00e8', agrave: '\u00e0', aacute: '\u00e1', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', ntilde: '\u00f1',
  ccedil: '\u00e7', aring: '\u00e5', Aring: '\u00c5', aelig: '\u00e6', AElig: '\u00c6',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text of an HTML body (never used as HTML). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote|pre)\s*>/gi, '\n')
      .replace(/<(p|div|li|tr|h[1-6]|table|blockquote|pre)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headerValue(headers: Array<{ key: string; value: string }>, key: string): string | null {
  const hit = headers.find((h) => h.key === key);
  const value = hit?.value?.trim();
  return value ? value : null;
}

function toArrayBuffer(content: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (typeof content === 'string') return new TextEncoder().encode(content).buffer as ArrayBuffer;
  if (content instanceof ArrayBuffer) return content;
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

export async function parseMime(raw: ArrayBuffer | Uint8Array): Promise<ParsedMail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const headers = email.headers ?? [];
  const from = email.from && 'address' in email.from && email.from.address ? email.from : null;
  const to: string[] = [];
  for (const addr of email.to ?? []) {
    if (addr.address) to.push(addr.address);
    else for (const member of addr.group ?? []) if (member.address) to.push(member.address);
  }
  const plain = typeof email.text === 'string' ? email.text.trim() : '';
  const fromHtml = !plain && typeof email.html === 'string' && email.html.trim() !== '';
  const text = fromHtml ? htmlToText(email.html as string) : plain;
  const refs = cidReferences(email.html);
  const attachments: ParsedAttachment[] = (email.attachments ?? []).map((a, i) => {
    const content = toArrayBuffer(a.content);
    const mime = (a.mimeType || 'application/octet-stream').toLowerCase();
    return {
      n: i + 1,
      filename: a.filename ?? `attachment-${i + 1}`,
      mime,
      size: content.byteLength,
      content,
      inline: isInlineLogo({ mime, size: content.byteLength, contentId: a.contentId }, refs),
    };
  });
  return {
    headers: {
      message_id: email.messageId?.trim() || null,
      in_reply_to: messageIdTokens(email.inReplyTo, 1)[0] ?? (email.inReplyTo?.trim() || null),
      references: messageIdTokens(email.references),
      from_email: from?.address ?? null,
      from_name: from?.name?.trim() || null,
      to,
      subject: email.subject ?? null,
      date: email.date ?? null,
      auto_submitted: headerValue(headers, 'auto-submitted'),
      precedence: headerValue(headers, 'precedence'),
      list_id: headerValue(headers, 'list-id'),
      content_type: headerValue(headers, 'content-type'),
      authentication_results: headers.filter((h) => h.key === 'authentication-results').map((h) => h.value),
    },
    text,
    from_html: fromHtml,
    attachments,
  };
}
