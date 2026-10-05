// Resend client (MailerPort): POST {RESEND_API_BASE or https://api.resend.com}/emails with an Idempotency-Key, and
// GET /emails/{id} to read back the provider's message_id.
//
// Rules
//   - Every send carries an Idempotency-Key (at most 256 characters; Resend keeps it 24 h), so a retried Workflow step
//     never sends a second mail. The key is required: a send without one is refused before any request.
//   - Answers: 2xx -> {ok, provider_id}; 408, 429, 5xx, a network error or a timeout -> retryable; 409
//     concurrent_idempotent_requests -> retryable; every other 4xx (including a key reused with another payload) ->
//     not retryable.
//   - Failure messages carry the status and Resend's error name only, never the request or response body, an
//     address or the API key.
//   - The API key is checked when a mail is sent (a deploy without it fails the send step, not the Worker).

import { ConfigMissingError } from '../agents/config';
import type { MailerPort, OutboundMail } from '../ports/index';

export const RESEND_API = 'https://api.resend.com';
export const IDEMPOTENCY_KEY_MAX = 256;
const DEFAULT_TIMEOUT_MS = 30_000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface ResendOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Resend's JSON body of a mail (REST field names). */
export function resendBody(m: OutboundMail): Record<string, unknown> {
  const body: Record<string, unknown> = { from: m.from, to: m.to, subject: m.subject, text: m.text };
  if (m.html) body.html = m.html;
  if (m.reply_to) body.reply_to = m.reply_to;
  if (m.headers && Object.keys(m.headers).length) body.headers = m.headers;
  if (m.attachments?.length) {
    body.attachments = m.attachments.map((a) => (a.content_type ? { filename: a.filename, content: a.content_base64, content_type: a.content_type } : { filename: a.filename, content: a.content_base64 }));
  }
  if (m.tags?.length) body.tags = m.tags;
  return body;
}

async function errorName(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { name?: unknown };
    return typeof parsed.name === 'string' && /^[a-z_]{1,64}$/.test(parsed.name) ? parsed.name : 'error';
  } catch {
    return 'error';
  }
}

export function resendMailer(o: ResendOptions): MailerPort {
  const base = (o.baseUrl ?? RESEND_API).replace(/\/+$/, '');
  const fetchImpl = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const key = (): string => {
    if (!o.apiKey) throw new ConfigMissingError(['RESEND_API_KEY']);
    return o.apiKey;
  };

  return {
    async send(m: OutboundMail) {
      if (!m.idempotency_key || m.idempotency_key.length > IDEMPOTENCY_KEY_MAX) throw new Error('resend: an Idempotency-Key of 1-256 characters is required');
      if (!m.to.length) throw new Error('resend: no recipient');
      const apiKey = key();
      let response: Response;
      try {
        response = await fetchImpl(`${base}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotency_key },
          body: JSON.stringify(resendBody(m)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { ok: false as const, status: 0, retryable: true, message: timeout ? 'resend: timeout' : 'resend: network error' };
      }
      if (response.ok) {
        let id: unknown;
        try {
          id = ((await response.json()) as { id?: unknown }).id;
        } catch {
          id = undefined;
        }
        if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false as const, status: response.status, retryable: false, message: 'resend: answer without an email id' };
        return { ok: true as const, provider_id: id };
      }
      const name = await errorName(response);
      const status = response.status;
      const retryable = status === 408 || status === 429 || status >= 500 || (status === 409 && name === 'concurrent_idempotent_requests');
      return { ok: false as const, status, retryable, message: `resend: ${status} ${name}` };
    },

    async fetchMessageId(providerId: string) {
      if (!ID_RE.test(providerId)) throw new Error('resend: invalid email id');
      const apiKey = key();
      const response = await fetchImpl(`${base}/emails/${providerId}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`resend: GET email ${response.status}`);
      const body = (await response.json()) as { message_id?: unknown };
      return typeof body.message_id === 'string' && body.message_id.trim() ? body.message_id.trim() : null;
    },
  };
}
