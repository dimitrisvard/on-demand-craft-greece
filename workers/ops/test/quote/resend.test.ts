// Q-4: the Resend client (request body, headers, Idempotency-Key, GET /emails/{id}, status mapping) and the outbound
// mail helpers (Message-IDs, reply headers, idempotency keys, plain text to HTML).
import { describe, expect, it } from 'vitest';
import { resendBody, resendMailer, RESEND_API } from '../../src/mail-out/resend';
import { handoffIdempotencyKey, quoteIdempotencyKey, quoteMessageId, replyHeaders, withBrackets } from '../../src/mail-out/mime-ids';
import { cleanSubject, offerFileName, plainMail, quoteMail, textToHtml } from '../../src/mail-out/templates';
import type { OutboundMail } from '../../src/ports/index';

const QWID = '11111111-2222-4333-8444-555555555555';
const KEY = 't1-resend-value';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function recordingFetch(answers: Array<Response | Error>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    seen.push({ url: String(input), method: init?.method ?? 'GET', headers, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    const next = answers.shift();
    if (!next) throw new Error('no answer left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetch: impl, seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mail(over: Partial<OutboundMail> = {}): OutboundMail {
  return quoteMail({
    from: 'MicronsHub Quotations <info@micronshub.eu>',
    reply_to: 'replies@rfq.micronshub.eu',
    to: 'buyer@example.de',
    subject: 'Your offer RFQ-05102026-1',
    body_text: 'Dear Ms Beispiel,\n\nplease find our offer attached.\n\nKind regards',
    quote_workflow_id: QWID,
    message_id: quoteMessageId(QWID, 0, 'rfq.micronshub.eu'),
    idempotency_key: quoteIdempotencyKey(QWID, 'send'),
    pdf: { filename: offerFileName('RFQ-05102026-1', 1), base64: 'JVBERi0xLjc=' },
    ...over,
  } as Parameters<typeof quoteMail>[0]);
}

describe('resendMailer.send', () => {
  it('posts the JSON body with Bearer key, Idempotency-Key, Message-ID header, Reply-To, PDF attachment and tags', async () => {
    const { fetch, seen } = recordingFetch([json(200, { id: 're-abc_123' })]);
    const result = await resendMailer({ apiKey: KEY, fetch }).send(mail());
    expect(result).toEqual({ ok: true, provider_id: 're-abc_123' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${RESEND_API}/emails`);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0].headers['idempotency-key']).toBe(`quote/${QWID}/send`);
    expect(seen[0].body).toEqual({
      from: 'MicronsHub Quotations <info@micronshub.eu>',
      to: ['buyer@example.de'],
      subject: 'Your offer RFQ-05102026-1',
      text: 'Dear Ms Beispiel,\n\nplease find our offer attached.\n\nKind regards',
      html: textToHtml('Dear Ms Beispiel,\n\nplease find our offer attached.\n\nKind regards'),
      reply_to: 'replies@rfq.micronshub.eu',
      headers: { 'Message-ID': `<q.${QWID}.0@rfq.micronshub.eu>` },
      attachments: [{ filename: 'Offer_RFQ-05102026-1_v1.pdf', content: 'JVBERi0xLjc=', content_type: 'application/pdf' }],
      tags: [
        { name: 'agent', value: 'quote' },
        { name: 'qwid', value: QWID },
      ],
    });
  });

  it('uses RESEND_API_BASE when given', async () => {
    const { fetch, seen } = recordingFetch([json(200, { id: 'stub-email-1' })]);
    await resendMailer({ apiKey: KEY, baseUrl: 'http://127.0.0.1:9999/resend/', fetch }).send(mail());
    expect(seen[0].url).toBe('http://127.0.0.1:9999/resend/emails');
  });

  it('maps statuses: 4xx not retryable; 408, 429, 5xx, concurrent idempotent requests and network errors retryable', async () => {
    const cases: Array<[Response | Error, boolean, number]> = [
      [json(422, { name: 'validation_error', message: 'x' }), false, 422],
      [json(403, { name: 'invalid_api_key' }), false, 403],
      [json(409, { name: 'invalid_idempotent_request' }), false, 409],
      [json(409, { name: 'concurrent_idempotent_requests' }), true, 409],
      [json(429, { name: 'rate_limit_exceeded' }), true, 429],
      [json(408, {}), true, 408],
      [json(500, { name: 'internal_server_error' }), true, 500],
      [new TypeError('fetch failed'), true, 0],
    ];
    for (const [answer, retryable, status] of cases) {
      const { fetch } = recordingFetch([answer]);
      const r = await resendMailer({ apiKey: KEY, fetch }).send(mail());
      expect(r).toMatchObject({ ok: false, retryable, status });
    }
  });

  it('never puts the response text, an address or the key into a failure message', async () => {
    const { fetch } = recordingFetch([json(422, { name: 'validation_error', message: 'The buyer@example.de address is invalid' })]);
    const r = await resendMailer({ apiKey: KEY, fetch }).send(mail());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe('resend: 422 validation_error');
      expect(r.message).not.toContain('example');
      expect(r.message).not.toContain(KEY);
    }
  });

  it('refuses a send without an Idempotency-Key and a send without the API key (config_missing)', async () => {
    const { fetch, seen } = recordingFetch([]);
    await expect(resendMailer({ apiKey: KEY, fetch }).send(mail({ idempotency_key: '' }))).rejects.toThrow(/Idempotency-Key/);
    await expect(resendMailer({ apiKey: KEY, fetch }).send(mail({ idempotency_key: 'k'.repeat(257) }))).rejects.toThrow(/Idempotency-Key/);
    await expect(resendMailer({ apiKey: undefined, fetch }).send(mail())).rejects.toMatchObject({ code: 'config_missing', names: ['RESEND_API_KEY'] });
    expect(seen).toHaveLength(0);
  });
});

describe('resendMailer.fetchMessageId', () => {
  it('reads message_id from GET /emails/{id}; 404 -> null; other errors throw', async () => {
    const { fetch, seen } = recordingFetch([json(200, { object: 'email', id: 're-1', message_id: ' <abc@resend.example> ' }), json(404, { name: 'not_found' }), json(500, {})]);
    const m = resendMailer({ apiKey: KEY, fetch });
    expect(await m.fetchMessageId('re-1')).toBe('<abc@resend.example>');
    expect(seen[0]).toMatchObject({ url: `${RESEND_API}/emails/re-1`, method: 'GET' });
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(await m.fetchMessageId('re-2')).toBeNull();
    await expect(m.fetchMessageId('re-3')).rejects.toThrow(/500/);
    await expect(m.fetchMessageId('../etc')).rejects.toThrow(/invalid email id/);
  });
});

describe('mail helpers', () => {
  it('message ids, idempotency keys and reply headers', () => {
    expect(quoteMessageId(QWID, 1, 'rfq.micronshub.eu')).toBe(`<q.${QWID}.1@rfq.micronshub.eu>`);
    expect(quoteIdempotencyKey(QWID, 2)).toBe(`quote/${QWID}/fu2`);
    expect(handoffIdempotencyKey(QWID)).toBe(`order/${QWID}/handoff`);
    expect(() => quoteIdempotencyKey('nope', 'send')).toThrow();
    expect(withBrackets(' abc@x ')).toBe('<abc@x>');
    expect(withBrackets('<abc@x>')).toBe('<abc@x>');
    expect(withBrackets('a b@x')).toBeNull();
    expect(withBrackets('')).toBeNull();
    expect(replyHeaders('<a@x>', ['<a@x>', 'b@y', '<c@z>'])).toEqual({ 'In-Reply-To': '<a@x>', References: '<a@x> <b@y> <c@z>' });
    const many = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`);
    const refs = replyHeaders('<first@x>', many).References.split(' ');
    expect(refs).toHaveLength(20);
    expect(refs[0]).toBe('<first@x>');
    expect(refs[19]).toBe('<m29@x>');
  });

  it('subjects are one line; text becomes escaped HTML paragraphs', () => {
    expect(cleanSubject('Offer\r\nBcc: someone@example.com')).toBe('Offer Bcc: someone@example.com');
    expect(cleanSubject('x'.repeat(300))).toHaveLength(200);
    expect(textToHtml('Hello <b>&\n\nline 1\nline 2')).toBe('<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #2A2A2A;"><p>Hello &lt;b&gt;&amp;</p><p>line 1<br>line 2</p></div>');
    const m = plainMail({ from: 'a@example.com', to: ['b@example.com'], subject: 's', text: 't', idempotency_key: 'k' });
    expect(m).toEqual({ from: 'a@example.com', to: ['b@example.com'], subject: 's', text: 't', html: textToHtml('t'), idempotency_key: 'k' });
    expect(resendBody(m)).toEqual({ from: 'a@example.com', to: ['b@example.com'], subject: 's', text: 't', html: textToHtml('t') });
  });

  it('a follow-up carries In-Reply-To and References and no attachment', () => {
    const fu = quoteMail({
      from: 'f@example.com', reply_to: 'r@example.com', to: 'b@example.com', subject: 'Re: offer', body_text: 'friendly reminder',
      quote_workflow_id: QWID, message_id: quoteMessageId(QWID, 1, 'rfq.micronshub.eu'), idempotency_key: quoteIdempotencyKey(QWID, 1),
      reply_headers: replyHeaders(`<q.${QWID}.0@rfq.micronshub.eu>`, []),
    });
    expect(fu.headers).toEqual({ 'Message-ID': `<q.${QWID}.1@rfq.micronshub.eu>`, 'In-Reply-To': `<q.${QWID}.0@rfq.micronshub.eu>`, References: `<q.${QWID}.0@rfq.micronshub.eu>` });
    expect(fu.attachments).toBeUndefined();
  });
});
