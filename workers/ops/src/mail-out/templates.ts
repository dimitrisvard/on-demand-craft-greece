// Outbound mail of the agents (quote, follow-ups; the post-order hand-off mail uses plainMail): plain text as
// approved, plus a minimal HTML version generated from it.
//
// Rules
//   - The text is the approved text; nothing is added to it except the HTML rendering (escaped, paragraphs and line
//     breaks kept). Model output is never used as an address, a header name or a link.
//   - Subjects are one line: CR, LF and other control characters become spaces (no header injection), at most 200
//     characters.
//   - Quote mail: from QUOTE_FROM, Reply-To QUOTE_REPLY_TO, our Message-ID, the offer PDF attached as
//     'Offer_<rfq_number>_v<n>.pdf', tags agent=quote and qwid=<uuid>. Follow-ups add In-Reply-To and References and
//     carry no attachment.

import { safeName } from '../agents/ids';
import type { OutboundMail } from '../ports/index';

export const SUBJECT_MAX = 200;

/** One-line subject (see the rules above). */
export function cleanSubject(subject: string): string {
  const one = String(subject ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length <= SUBJECT_MAX ? one : one.slice(0, SUBJECT_MAX);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** HTML version of a plain text: escaped, blank lines -> paragraphs, single line breaks -> <br>. */
export function textToHtml(text: string): string {
  const paragraphs = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #2A2A2A;">${paragraphs.join('')}</div>`;
}

export interface PlainMail {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: OutboundMail['attachments'];
  tags?: OutboundMail['tags'];
  idempotency_key: string;
}

/** An OutboundMail from approved plain text (subject cleaned, HTML generated). */
export function plainMail(m: PlainMail): OutboundMail {
  const out: OutboundMail = {
    from: m.from,
    to: [...m.to],
    subject: cleanSubject(m.subject),
    text: m.text,
    html: textToHtml(m.text),
    idempotency_key: m.idempotency_key,
  };
  if (m.reply_to) out.reply_to = m.reply_to;
  if (m.headers && Object.keys(m.headers).length) out.headers = { ...m.headers };
  if (m.attachments?.length) out.attachments = m.attachments.map((a) => ({ ...a }));
  if (m.tags?.length) out.tags = m.tags.map((t) => ({ ...t }));
  return out;
}

/** File name of the attached offer. */
export function offerFileName(rfqNumber: string, version: number): string {
  return safeName(`Offer_${rfqNumber}_v${version}.pdf`);
}

export interface QuoteMailInput {
  from: string;
  reply_to: string;
  to: string;
  subject: string;
  body_text: string;
  quote_workflow_id: string;
  message_id: string;
  idempotency_key: string;
  /** Present for the quote mail; follow-ups have none. */
  pdf?: { filename: string; base64: string };
  /** Follow-ups: In-Reply-To and References. */
  reply_headers?: { 'In-Reply-To': string; References: string };
}

export function quoteMail(q: QuoteMailInput): OutboundMail {
  return plainMail({
    from: q.from,
    to: [q.to],
    reply_to: q.reply_to,
    subject: q.subject,
    text: q.body_text,
    headers: { 'Message-ID': q.message_id, ...(q.reply_headers ?? {}) },
    attachments: q.pdf ? [{ filename: q.pdf.filename, content_base64: q.pdf.base64, content_type: 'application/pdf' }] : undefined,
    tags: [
      { name: 'agent', value: 'quote' },
      { name: 'qwid', value: q.quote_workflow_id },
    ],
    idempotency_key: q.idempotency_key,
  });
}
