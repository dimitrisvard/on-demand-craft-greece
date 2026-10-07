// IN-1 / M-1: microns-mail T1. Header helpers (Message-ID trim, References split, From parsing with encoded words,
// subjects), recipient check, sha256hex vectors, M3/M4 retries and the M7 fallback with fake bindings, the
// duplicate stop, an ignored RPC failure, the shadow copy and the one log line without addresses or subjects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { handleEmail, type MailEnv } from '../src/index';
import { INSERT_DELAYS_MS, insertInboundEmail } from '../src/db';
import {
  authResultsOfRaw,
  decodeEncodedWords,
  inReplyToOf,
  mailboxOf,
  messageIdSha256,
  messageIdTokens,
  parseFrom,
  rawHeaderValues,
  sha256hex,
  subjectOf,
  trimmedMessageId,
} from '../src/headers';
import { handOver } from '../src/ingest';
import { STORE_DELAYS_MS, rawKey, storeRaw } from '../src/store';

/** SHA-256 hex computed independently of src/headers.ts (WebCrypto directly). */
async function hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TENANT = '00000000-0000-0000-0000-000000000001';
const ROW_ID = '3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a';
const ALLOWED = 'rfq@rfq.example.com,replies@rfq.example.com';

const RAW = [
  'From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <J.Mueller@Example.DE>',
  'To: rfq@rfq.example.com',
  'Subject: =?UTF-8?B?QW5mcmFnZSBXaW5rZWwgw4QtMjA=?=',
  'Message-ID:   <anfrage-1@mail.example.de>  ',
  'In-Reply-To: <q.1@rfq.example.com>',
  'References: <a@x.example> <b@y.example>',
  'Authentication-Results: mx.example.net; dmarc=pass header.from=example.de',
  'Authentication-Results: other.example; dmarc=fail',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Bitte um ein Angebot.',
  '',
].join('\r\n');

interface FakeMessage extends ForwardableEmailMessage {
  rejects: string[];
  forwards: Array<{ rcpt: string; headers: Record<string, string> }>;
}

function fakeMessage(o: { raw?: string; to?: string; from?: string; failForward?: boolean } = {}): FakeMessage {
  const raw = o.raw ?? RAW;
  const headerBlock = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const headers = new Headers();
  for (const line of headerBlock.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers.append(line.slice(0, i), line.slice(i + 1).trim());
  }
  const rejects: string[] = [];
  const forwards: FakeMessage['forwards'] = [];
  return {
    from: o.from ?? 'bounce-123@mail.example.de',
    to: o.to ?? 'RFQ@rfq.example.com',
    headers,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    setReject(reason: string) {
      rejects.push(reason);
    },
    async forward(rcpt: string, h?: Headers) {
      if (o.failForward) throw new Error('forward failed');
      forwards.push({ rcpt, headers: h ? Object.fromEntries(h.entries()) : {} });
    },
    async reply() {},
    rejects,
    forwards,
  } as unknown as FakeMessage;
}

class FakeBucket {
  readonly puts: Array<{ key: string; size: number; options: R2PutOptions | undefined }> = [];
  /** Stored objects: bytes as text, custom metadata and the SHA-256 R2 verified on put. */
  readonly objects = new Map<string, { text: string; customMetadata?: Record<string, string>; sha256?: string }>();
  failures = 0;
  async put(key: string, body: ArrayBuffer, options?: R2PutOptions) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('R2 unavailable');
    }
    if (options?.sha256 && options.sha256 !== (await hex(new Uint8Array(body)))) throw new Error('checksum mismatch');
    this.puts.push({ key, size: body.byteLength, options });
    this.objects.set(key, { text: new TextDecoder().decode(body), customMetadata: options?.customMetadata as Record<string, string> | undefined, sha256: options?.sha256 as string | undefined });
    return {} as R2Object;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    const sha256 = o.sha256 ? Uint8Array.from(o.sha256.match(/../g)!.map((h) => parseInt(h, 16))).buffer : undefined;
    return { key, customMetadata: o.customMetadata, checksums: { sha256 } } as unknown as R2Object;
  }
}

function fakeOps(o: { fail?: boolean } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  return {
    calls,
    async startIntake(input: unknown) {
      calls.push({ method: 'startIntake', input });
      if (o.fail) throw new Error('ops unavailable');
      return { status: 'started' as const, instance_id: 'rfq-intake-x' };
    },
    async ingestReply(input: unknown) {
      calls.push({ method: 'ingestReply', input });
      if (o.fail) throw new Error('ops unavailable');
      return { status: 'queued' as const };
    },
  };
}

function env(over: Partial<MailEnv> = {}, ops = fakeOps(), bucket = new FakeBucket()): MailEnv & { bucket: FakeBucket; ops: ReturnType<typeof fakeOps> } {
  return {
    PRIVATE_FILES: bucket as unknown as R2Bucket,
    OPS: ops as unknown as MailEnv['OPS'],
    ALLOWED_RCPT: ALLOWED,
    SUPABASE_URL: 'https://project.supabase.test',
    AGENT_TENANT_ID: TENANT,
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-value',
    ...over,
    bucket,
    ops,
  };
}

type Answer = { status: number; body?: unknown } | 'network';

function fakeFetch(answers: Answer[]) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a === 'network' || a === undefined) throw new TypeError('fetch failed');
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  return Object.assign(fn, { requests });
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const noSleep = vi.fn(async (_ms: number) => {});
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  noSleep.mockClear();
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const SHA_OF_ID = await hex('<anfrage-1@mail.example.de>');

describe('header helpers', () => {
  it('Message-ID: trimmed, brackets and case kept; hash = SHA-256 of the trimmed value, else of the raw bytes', async () => {
    expect(trimmedMessageId('  <A.b@X.example> \r\n')).toBe('<A.b@X.example>');
    expect(trimmedMessageId('   ')).toBeNull();
    expect(trimmedMessageId(null)).toBeNull();
    expect(await messageIdSha256('<anfrage-1@mail.example.de>', new ArrayBuffer(0))).toBe(SHA_OF_ID);
    const raw = new TextEncoder().encode('no id').buffer as ArrayBuffer;
    expect(await messageIdSha256(null, raw)).toBe(await hex('no id'));
  });

  it('sha256hex vectors', async () => {
    expect(await sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256hex(new Uint8Array([0xff, 0x00]))).toBe('ea5dbf9596d187e9500f23e9a680109475341cf4e81f7e043f7d97152c10772f');
  });

  it('References: <...> ids in order, at most 100; In-Reply-To: the first id', () => {
    expect(messageIdTokens('<a@x>\r\n <B@y>  garbage <c@z>')).toEqual(['<a@x>', '<B@y>', '<c@z>']);
    expect(messageIdTokens(Array.from({ length: 120 }, (_, i) => `<${i}@x>`).join(' '))).toHaveLength(100);
    expect(inReplyToOf(' <q.1@rfq.example.com> (comment)')).toBe('<q.1@rfq.example.com>');
    expect(inReplyToOf('not-bracketed@x')).toBe('not-bracketed@x');
    expect(inReplyToOf(null)).toBeNull();
  });

  it('From: encoded words, quoted names, bare addresses, comments; envelope fallback', () => {
    expect(parseFrom('=?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <J.Mueller@Example.DE>', 'x@y')).toEqual({ email: 'j.mueller@example.de', name: 'Jürgen Müller' });
    expect(parseFrom('"Becker, Anna" <anna@example.com>', 'x@y')).toEqual({ email: 'anna@example.com', name: 'Becker, Anna' });
    expect(parseFrom('=?ISO-8859-1?Q?Fran=E7ois?= <f@example.com>', 'x@y')).toEqual({ email: 'f@example.com', name: 'François' });
    expect(parseFrom('anna@example.com (Anna B)', 'x@y')).toEqual({ email: 'anna@example.com', name: 'Anna B' });
    expect(parseFrom('anna@example.com', 'x@y')).toEqual({ email: 'anna@example.com', name: null });
    expect(parseFrom('Undisclosed', 'Envelope@Example.com')).toEqual({ email: 'envelope@example.com', name: null });
    expect(parseFrom(null, 'envelope@example.com')).toEqual({ email: 'envelope@example.com', name: null });
  });

  it('Subject: adjacent encoded words joined, control characters removed, at most 998 characters', () => {
    expect(subjectOf('=?UTF-8?B?QW5mcmFnZSBXaW5rZWwgw4QtMjA=?=')).toBe('Anfrage Winkel Ä-20');
    expect(decodeEncodedWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?= c')).toBe('ab c');
    expect(subjectOf('Re:\tline\u0007bell')).toBe('Re: line bell');
    expect(subjectOf('x'.repeat(2000))).toHaveLength(998);
    expect(subjectOf(null)).toBeNull();
    expect(decodeEncodedWords('=?unknown-charset?B?SGk=?=')).toBe('Hi');
  });

  it('recipient check: only ALLOWED_RCPT, case-insensitive; the local part names the mailbox', () => {
    expect(mailboxOf('RFQ@rfq.example.com', ALLOWED)).toBe('rfq');
    expect(mailboxOf(' replies@rfq.example.com ', ALLOWED)).toBe('replies');
    expect(mailboxOf('sales@rfq.example.com', ALLOWED)).toBeNull();
    expect(mailboxOf('rfq@example.com', ALLOWED)).toBeNull();
    expect(mailboxOf('other@rfq.example.com', 'other@rfq.example.com')).toBeNull();
  });

  it('Authentication-Results instances come from the raw header block, top to bottom; nothing is trusted until pinned', () => {
    const raw = new TextEncoder().encode(RAW);
    expect(rawHeaderValues(raw, 'Authentication-Results')).toEqual(['mx.example.net; dmarc=pass header.from=example.de', 'other.example; dmarc=fail']);
    expect(rawHeaderValues(new TextEncoder().encode('X-A: 1\r\n folded\r\n\r\nX-A: body'), 'x-a')).toEqual(['1 folded']);
    expect(authResultsOfRaw(raw)).toEqual({ v: 1, trusted: false, authserv_id: 'mx.example.net', spf: 'none', dkim: 'none', dmarc: 'none', dmarc_from_domain: null, raw_count: 2 });
  });
});

describe('email() handler', () => {
  it('M0: an unknown recipient is rejected before anything is read or stored', async () => {
    const e = env();
    const m = fakeMessage({ to: 'sales@rfq.example.com' });
    const f = fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]);
    await handleEmail(m, e, ctx, { fetch: f, sleep: noSleep });
    expect(m.rejects).toEqual(['Unknown recipient']);
    expect(e.bucket.puts).toEqual([]);
    expect(f.requests).toEqual([]);
    expect(lines).toEqual([expect.stringMatching(/^\[microns-mail\] mail - - rejected_rcpt \d+$/)]);
  });

  it('M1-M5: stores the raw MIME, inserts the row from headers only and starts the intake with ids only', async () => {
    const e = env();
    const m = fakeMessage();
    const f = fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]);
    await handleEmail(m, e, ctx, { fetch: f, sleep: noSleep, now: () => Date.UTC(2026, 9, 5, 8, 0, 0) });
    expect(e.bucket.puts).toEqual([{
      key: `email/${SHA_OF_ID}/raw.eml`,
      size: RAW.length,
      options: {
        httpMetadata: { contentType: 'message/rfc822' },
        sha256: await hex(RAW),
        customMetadata: { mailbox: 'rfq', received_at: '2026-10-05T08:00:00.000Z', raw_sha256: await hex(RAW) },
      },
    }]);
    expect(f.requests).toHaveLength(1);
    const req = f.requests[0];
    expect(req.url).toBe('https://project.supabase.test/rest/v1/inbound_emails?on_conflict=tenant_id,message_id_sha256&select=id');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers).toMatchObject({ prefer: 'resolution=ignore-duplicates,return=representation', apikey: 'service-test-value', authorization: 'Bearer service-test-value' });
    expect(JSON.parse(String(req.init.body))).toEqual({
      tenant_id: TENANT,
      message_id: '<anfrage-1@mail.example.de>',
      message_id_sha256: SHA_OF_ID,
      mailbox: 'rfq',
      source: 'email_routing',
      from_email: 'j.mueller@example.de',
      from_name: 'Jürgen Müller',
      to_email: 'rfq@rfq.example.com',
      subject: 'Anfrage Winkel Ä-20',
      in_reply_to: '<q.1@rfq.example.com>',
      references_ids: ['<a@x.example>', '<b@y.example>'],
      received_at: '2026-10-05T08:00:00.000Z',
      raw_r2_key: `email/${SHA_OF_ID}/raw.eml`,
      raw_size_bytes: RAW.length,
      auth_results: { v: 1, trusted: false, authserv_id: 'mx.example.net', spf: 'none', dkim: 'none', dmarc: 'none', dmarc_from_domain: null, raw_count: 2 },
      status: 'received',
    });
    expect(e.ops.calls).toEqual([{ method: 'startIntake', input: { v: 1, inbound_email_id: ROW_ID, message_id_sha256: SHA_OF_ID, tenant_id: TENANT } }]);
    expect(m.rejects).toEqual([]);
    expect(m.forwards).toEqual([]);
    expect(lines).toEqual([`[microns-mail] mail rfq ${SHA_OF_ID.slice(0, 16)} started 0`]);
  });

  it('replies@ -> ingestReply; a missing Message-ID hashes the raw bytes', async () => {
    const raw = RAW.replace(/Message-ID:[^\r\n]*\r\n/, '');
    const e = env();
    const m = fakeMessage({ raw, to: 'replies@rfq.example.com' });
    await handleEmail(m, e, ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    const sha = await hex(raw);
    expect(e.bucket.puts[0].key).toBe(rawKey(sha));
    expect(e.ops.calls).toEqual([{ method: 'ingestReply', input: { v: 1, inbound_email_id: ROW_ID, message_id_sha256: sha, tenant_id: TENANT, mailbox: 'replies' } }]);
  });

  it('M4 duplicate (redelivery): empty answer -> stop, no hand-over, no copy', async () => {
    const e = env({ MAIL_COPY_TO: 'copy@example.com' });
    const m = fakeMessage();
    await handleEmail(m, e, ctx, { fetch: fakeFetch([{ status: 201, body: [] }]), sleep: noSleep });
    expect(e.ops.calls).toEqual([]);
    expect(m.forwards).toEqual([]);
    expect(lines).toEqual([expect.stringMatching(/ rfq [0-9a-f]{16} duplicate \d+$/)]);
  });

  it('M3: R2 is retried with 200 and 800 ms pauses; three failures -> M7 fallback forward', async () => {
    const bucket = new FakeBucket();
    bucket.failures = 2;
    const e = env({}, fakeOps(), bucket);
    await handleEmail(fakeMessage(), e, ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([...STORE_DELAYS_MS]);
    expect(bucket.puts).toHaveLength(1);
    expect(e.ops.calls).toHaveLength(1);

    const failing = new FakeBucket();
    failing.failures = 3;
    const e2 = env({ MAIL_FALLBACK_TO: 'fallback@example.com' }, fakeOps(), failing);
    const m2 = fakeMessage();
    await handleEmail(m2, e2, ctx, { fetch: fakeFetch([{ status: 201, body: [] }]), sleep: noSleep });
    expect(m2.forwards).toEqual([{ rcpt: 'fallback@example.com', headers: {} }]);
    expect(m2.rejects).toEqual([]);
    expect(e2.ops.calls).toEqual([]);
    expect(lines.at(-1)).toMatch(/ rfq [0-9a-f]{16} fallback_forwarded \d+$/);
  });

  it('M4: 503 and network errors are retried twice; a final failure falls back; without MAIL_FALLBACK_TO the mail is rejected', async () => {
    const f = fakeFetch([{ status: 503 }, 'network', { status: 201, body: [{ id: ROW_ID }] }]);
    const e = env();
    await handleEmail(fakeMessage(), e, ctx, { fetch: f, sleep: noSleep });
    expect(f.requests).toHaveLength(3);
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([...INSERT_DELAYS_MS]);
    expect(e.ops.calls).toHaveLength(1);

    noSleep.mockClear();
    const f2 = fakeFetch([{ status: 503 }]);
    const e2 = env();
    const m2 = fakeMessage();
    await handleEmail(m2, e2, ctx, { fetch: f2, sleep: noSleep });
    expect(f2.requests).toHaveLength(3);
    expect(m2.rejects).toEqual(['Temporary processing error, please resend later']);
    expect(lines.at(-1)).toMatch(/ fallback_rejected \d+$/);

    const f3 = fakeFetch([{ status: 400, body: { code: '23514', message: 'check violation' } }]);
    const m3 = fakeMessage({ failForward: true });
    await handleEmail(m3, env({ MAIL_FALLBACK_TO: 'fallback@example.com' }), ctx, { fetch: f3, sleep: noSleep });
    expect(f3.requests).toHaveLength(1);
    expect(m3.rejects).toEqual(['Temporary processing error, please resend later']);
  });

  it('missing configuration fails the mail into the fallback, never the Worker', async () => {
    const e = env({ SUPABASE_SERVICE_ROLE_KEY: '' });
    const m = fakeMessage();
    await handleEmail(m, e, ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    expect(m.rejects).toEqual(['Temporary processing error, please resend later']);
    expect(lines.some((l) => l.includes('mail config missing: SUPABASE_SERVICE_ROLE_KEY'))).toBe(true);
  });

  it('M5: an RPC failure is ignored (the row stays received for the dispatcher); M6 copies when MAIL_COPY_TO is set', async () => {
    const e = env({ MAIL_COPY_TO: 'copy@example.com' }, fakeOps({ fail: true }));
    const m = fakeMessage();
    await handleEmail(m, e, ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    expect(e.ops.calls).toHaveLength(1);
    expect(m.rejects).toEqual([]);
    expect(m.forwards).toEqual([{ rcpt: 'copy@example.com', headers: { 'x-microns-inbound': SHA_OF_ID.slice(0, 16) } }]);
    expect(lines.at(-1)).toMatch(/ rfq [0-9a-f]{16} handover_failed\+copy \d+$/);
    const m2 = fakeMessage({ failForward: true });
    await handleEmail(m2, env({ MAIL_COPY_TO: 'copy@example.com' }), ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    expect(m2.rejects).toEqual([]);
    expect(lines.at(-1)).toMatch(/ started\+copy_failed \d+$/);
  });

  it('log lines never hold an address, a subject or a full hash', async () => {
    await handleEmail(fakeMessage(), env({ MAIL_COPY_TO: 'copy@example.com' }), ctx, { fetch: fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }]), sleep: noSleep });
    await handleEmail(fakeMessage({ to: 'x@rfq.example.com' }), env(), ctx, { fetch: fakeFetch([{ status: 201, body: [] }]), sleep: noSleep });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toMatch(/@/);
      expect(line).not.toContain('Anfrage');
      expect(line).not.toContain(SHA_OF_ID);
    }
  });

  it('the default export routes email() to the handler', async () => {
    expect(typeof worker.email).toBe('function');
    const m = fakeMessage({ to: 'nobody@rfq.example.com' });
    await worker.email?.(m, env(), ctx);
    expect(m.rejects).toEqual(['Unknown recipient']);
  });
});

describe('M3: bytes an inbound_emails row stands for are never replaced', () => {
  const OTHER = RAW.replace('Bitte um ein Angebot.', 'Other text under the same Message-ID.');
  const KEY = `email/${SHA_OF_ID}/raw.eml`;

  it('other bytes under the Message-ID of an existing row: raw.eml keeps the first bytes; duplicate_mismatch, no insert, no hand-over', async () => {
    const bucket = new FakeBucket();
    const ops = fakeOps();
    const e = env({ MAIL_COPY_TO: 'copy@example.com' }, ops, bucket);
    const f = fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }, { status: 200, body: [{ id: ROW_ID }] }]);
    await handleEmail(fakeMessage(), e, ctx, { fetch: f, sleep: noSleep });
    const second = fakeMessage({ raw: OTHER });
    await handleEmail(second, e, ctx, { fetch: f, sleep: noSleep });
    expect(bucket.objects.get(KEY)?.text).toBe(RAW);
    expect(bucket.puts.map((p) => p.key)).toEqual([KEY]);
    expect(f.requests.map((r) => r.init.method)).toEqual(['POST', 'GET']);
    expect(f.requests[1].url).toBe(`https://project.supabase.test/rest/v1/inbound_emails?select=id&tenant_id=eq.${TENANT}&message_id_sha256=eq.${SHA_OF_ID}&limit=1`);
    expect(ops.calls).toHaveLength(1);
    expect(second.forwards).toEqual([]);
    expect(second.rejects).toEqual([]);
    expect(lines.at(-1)).toMatch(new RegExp(` rfq ${SHA_OF_ID.slice(0, 16)} duplicate_mismatch \\d+$`));
  });

  it('a redelivery of the same bytes writes nothing and asks no row read; the insert answers duplicate', async () => {
    const bucket = new FakeBucket();
    const e = env({}, fakeOps(), bucket);
    const f = fakeFetch([{ status: 201, body: [{ id: ROW_ID }] }, { status: 201, body: [] }]);
    await handleEmail(fakeMessage(), e, ctx, { fetch: f, sleep: noSleep });
    await handleEmail(fakeMessage(), e, ctx, { fetch: f, sleep: noSleep });
    expect(bucket.puts).toHaveLength(1);
    expect(f.requests.map((r) => r.init.method)).toEqual(['POST', 'POST']);
    expect(lines.at(-1)).toMatch(/ duplicate \d+$/);
  });

  it('an earlier delivery stored raw.eml but got no row: a resend with other bytes replaces it and gets the row', async () => {
    const bucket = new FakeBucket();
    const ops = fakeOps();
    const e = env({}, ops, bucket);
    const first = fakeMessage();
    await handleEmail(first, e, ctx, { fetch: fakeFetch([{ status: 500 }]), sleep: noSleep });
    expect(first.rejects).toHaveLength(1);
    expect(bucket.objects.get(KEY)?.text).toBe(RAW);
    const f = fakeFetch([{ status: 200, body: [] }, { status: 201, body: [{ id: ROW_ID }] }]);
    await handleEmail(fakeMessage({ raw: OTHER }), e, ctx, { fetch: f, sleep: noSleep });
    expect(f.requests.map((r) => r.init.method)).toEqual(['GET', 'POST']);
    expect(bucket.objects.get(KEY)?.text).toBe(OTHER);
    expect(JSON.parse(String(f.requests[1].init.body)).raw_r2_key).toBe(KEY);
    expect(ops.calls).toEqual([{ method: 'startIntake', input: { v: 1, inbound_email_id: ROW_ID, message_id_sha256: SHA_OF_ID, tenant_id: TENANT } }]);
  });

  it('the row read is retried like the insert; when it keeps failing the mail falls back (M7) and raw.eml stays', async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(KEY, { text: RAW, customMetadata: { raw_sha256: 'f'.repeat(64) } });
    const e = env({ MAIL_FALLBACK_TO: 'fallback@example.com' }, fakeOps(), bucket);
    const m = fakeMessage({ raw: OTHER });
    const f = fakeFetch([{ status: 503 }]);
    await handleEmail(m, e, ctx, { fetch: f, sleep: noSleep });
    expect(f.requests.length).toBeGreaterThanOrEqual(3);
    expect(f.requests.every((r) => r.init.method === 'GET')).toBe(true);
    expect(bucket.puts).toEqual([]);
    expect(bucket.objects.get(KEY)?.text).toBe(RAW);
    expect(m.forwards).toEqual([{ rcpt: 'fallback@example.com', headers: {} }]);
  });

  it('storeRaw: new key -> stored; same bytes -> same; unknown checksum counts as other bytes; the row read is asked only then', async () => {
    const sha = 'c'.repeat(64);
    const key = `email/${sha}/raw.eml`;
    const raw = new TextEncoder().encode('new bytes');
    const o = { sha, raw: raw.buffer as ArrayBuffer, rawSha256: await hex(raw), mailbox: 'rfq', receivedAt: 't' };
    const asked: boolean[] = [];
    const rowExists = (answer: boolean) => async () => (asked.push(answer), answer);
    const bucket = new FakeBucket();
    expect(await storeRaw(bucket as unknown as R2Bucket, o, rowExists(true), noSleep)).toEqual({ key, outcome: 'stored' });
    expect(await storeRaw(bucket as unknown as R2Bucket, o, rowExists(true), noSleep)).toEqual({ key, outcome: 'same' });
    expect(asked).toEqual([]);
    bucket.objects.set(key, { text: 'older object' });
    expect(await storeRaw(bucket as unknown as R2Bucket, o, rowExists(true), noSleep)).toEqual({ key, outcome: 'kept' });
    expect(bucket.objects.get(key)?.text).toBe('older object');
    expect(await storeRaw(bucket as unknown as R2Bucket, o, rowExists(false), noSleep)).toEqual({ key, outcome: 'replaced' });
    expect(bucket.objects.get(key)?.text).toBe('new bytes');
    expect(asked).toEqual([true, false]);
  });
});

describe('module helpers', () => {
  it('storeRaw uses the same key on every attempt and rethrows the last error', async () => {
    const bucket = new FakeBucket();
    bucket.failures = 5;
    const sleep = vi.fn(async () => {});
    await expect(storeRaw(bucket as unknown as R2Bucket, { sha: 'a'.repeat(64), raw: new ArrayBuffer(1), rawSha256: 'x', mailbox: 'rfq', receivedAt: 't' }, async () => false, sleep)).rejects.toThrow('R2 unavailable');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('insertInboundEmail reports status and code only', async () => {
    const f = fakeFetch([{ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "x" detail (a@b)' } }]);
    const err = await insertInboundEmail({ supabaseUrl: 'https://p.example.com/', serviceRoleKey: 'k', row: {} as never }, f, noSleep).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('inbound_emails insert failed: 409 23505');
    expect(f.requests[0].url.startsWith('https://p.example.com/rest/v1/')).toBe(true);
  });

  it('handOver maps every RPC answer and never throws', async () => {
    const ids = { inbound_email_id: ROW_ID, message_id_sha256: 'a'.repeat(64), tenant_id: TENANT };
    for (const status of ['started', 'exists', 'flag_off', 'rejected'] as const) {
      const ops = { startIntake: async () => (status === 'rejected' ? { status, reason: 'bad_input' as const } : status === 'flag_off' ? { status } : { status, instance_id: 'x' }), ingestReply: async () => ({ status: 'queued' as const }) };
      expect(await handOver(ops, 'rfq', ids)).toBe(status);
    }
    expect(await handOver({ startIntake: async () => { throw new Error('x'); }, ingestReply: async () => ({ status: 'queued' as const }) }, 'replies', ids)).toBe('queued');
    expect(await handOver({ startIntake: async () => { throw new Error('x'); }, ingestReply: async () => { throw new Error('x'); } }, 'replies', ids)).toBe('handover_failed');
  });
});
