// K-2 ports: makePorts refuses AGENT_STUBS while AI or QUOTES_INDEX is bound and unknown stub tokens, and selects the
// stub adapters by token; PostgrestDb request shapes (filters, Prefer, on_conflict, errors without body text);
// Telegram Bot API calls (errors never carry the bot URL); Gmail token rule (no write-back); R2 blob; HashEmbed and
// MemoryVectorIndex.

import { describe, expect, it } from 'vitest';
import { renderTelegram } from '../../src/agents/cards/index';
import { testCard } from '../../src/agents/cards/test';
import { DbError, PostgrestDb, escapeLike, filterExpression, queryString } from '../../src/db/postgrest';
import type { OpsEnv } from '../../src/env';
import { HashEmbed, MemoryVectorIndex, R2PersistedVectors, VectorizeVectors, WorkersAiEmbed, hashVector, matchesFilter } from '../../src/ports/embed-vector';
import { BotTelegram, GmailApi, R2Blob } from '../../src/ports/http-adapters';
import { makePorts, parseStubTokens, type QuoteVectorMeta, type SenderAccountRow } from '../../src/ports/index';
import { FakeR2Bucket, agentBindings } from '../helpers/agent-env';
import { opsEnv } from '../helpers/ops';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fetchRecorder(answer: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const req = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : null };
    seen.push(req);
    return answer(req);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('makePorts', () => {
  it('throws when AGENT_STUBS is set while AI or QUOTES_INDEX is bound', () => {
    expect(() => makePorts(opsEnv({ ...agentBindings(), AGENT_STUBS: 'llm', AI: {} as Ai }))).toThrow(/AGENT_STUBS is set while AI or QUOTES_INDEX is bound/);
    expect(() => makePorts(opsEnv({ ...agentBindings(), AGENT_STUBS: 'vector', QUOTES_INDEX: {} as VectorizeIndex }))).toThrow(/AGENT_STUBS/);
  });

  it('refuses an unknown stub token', () => {
    expect(() => parseStubTokens({ AGENT_STUBS: 'llm,emebd' })).toThrow(/unknown AGENT_STUBS token: emebd/);
    expect([...parseStubTokens({ AGENT_STUBS: ' llm , embed,vector,cad,browser ' })]).toEqual(['llm', 'embed', 'vector', 'cad', 'browser']);
    expect(parseStubTokens({}).size).toBe(0);
  });

  it('production adapters without stub tokens; stub adapters by token; no adapter is built that the run does not use', () => {
    const prod = makePorts(opsEnv({ ...agentBindings(), AI: {} as Ai, QUOTES_INDEX: {} as VectorizeIndex }));
    expect(prod.embed).toBeInstanceOf(WorkersAiEmbed);
    expect(prod.vector).toBeInstanceOf(VectorizeVectors);
    expect(prod.db).toBeInstanceOf(PostgrestDb);
    expect(prod.telegram).toBeInstanceOf(BotTelegram);
    expect(prod.blob).toBeInstanceOf(R2Blob);
    const stubbed = makePorts(opsEnv({ ...agentBindings(), AGENT_STUBS: 'llm,embed,vector,browser' }));
    expect(stubbed.embed).toBeInstanceOf(HashEmbed);
    expect(stubbed.vector).toBeInstanceOf(R2PersistedVectors);
    expect(makePorts(opsEnv({ AGENT_STUBS: 'vector' })).vector).toBeInstanceOf(MemoryVectorIndex);
    // The cad registry and the mailer belong to other modules and are built on first use only.
    expect(() => makePorts(opsEnv({}))).not.toThrow();
  });

  it('the browser port refuses until a browser module is passed in', async () => {
    await expect(makePorts(opsEnv({})).browser.render('https://example.com', { timeoutMs: 1, userAgent: 'x' })).rejects.toThrow(/not available/);
    const browser = { render: async () => ({ status: 200, html: '<p>ok</p>' }) };
    expect(await makePorts(opsEnv({}), { browser }).browser.render('https://example.com', { timeoutMs: 1, userAgent: 'x' })).toEqual({ status: 200, html: '<p>ok</p>' });
  });
});

describe('PostgrestDb', () => {
  const base = 'https://project.supabase.test';

  it('filter expressions: lists quoted, ilike escaped, is/eq/gte/lt plain', () => {
    expect(filterExpression(['status', 'eq', 'waiting_human'])).toBe('eq.waiting_human');
    expect(filterExpression(['id', 'in', ['a', 'b"c', 'd,e']])).toBe('in.("a","b\\"c","d,e")');
    expect(filterExpression(['outbound_message_ids', 'ov', ['<q.1.0@rfq.micronshub.eu>']])).toBe('ov.{"<q.1.0@rfq.micronshub.eu>"}');
    expect(filterExpression(['tags', 'cs', [1, 2]])).toBe('cs.{1,2}');
    expect(filterExpression(['contact_email', 'ilike', 'a_b%c\\d@example.com'])).toBe('ilike.a\\_b\\%c\\\\d@example.com');
    expect(escapeLike('100%_')).toBe('100\\%\\_');
    expect(filterExpression(['parked_reason', 'is', null])).toBe('is.null');
    expect(filterExpression(['started_at', 'gte', '2026-10-05T00:00:00.000Z'])).toBe('gte.2026-10-05T00:00:00.000Z');
    expect(queryString({ filters: [['a', 'eq', 'x y&z']], select: 'id,status', order: [{ column: 'created_at', ascending: false }], limit: 5 })).toBe(
      '?select=id%2Cstatus&a=eq.x+y%26z&order=created_at.desc&limit=5',
    );
    expect(() => queryString({ filters: [['a;drop', 'eq', 1]] })).toThrow(/invalid filter column/);
  });

  it('select, insert with on_conflict, update and rpc send the service role and the PostgREST Prefer forms', async () => {
    const { seen, fetchImpl } = fetchRecorder((req) => (req.method === 'GET' ? json([{ id: '1' }]) : req.url.includes('/rpc/') ? json([{ run_id: 'r', created: true, run_status: 'running' }]) : json([{ id: '2' }], 201)));
    const db = new PostgrestDb({ url: `${base}/`, serviceRoleKey: 'service-test-value', fetch: fetchImpl });
    expect(await db.select('agent_runs', { columns: 'id', filters: [['status', 'eq', 'waiting_human']], limit: 2 })).toEqual([{ id: '1' }]);
    await db.insert('inbound_emails', { a: 1 }, { onConflict: ['tenant_id', 'message_id_sha256'], returning: true });
    await db.insert('quote_workflows', [{ a: 1 }], { onConflict: ['rfq_id', 'quote_version'], ignoreDuplicates: false, returning: 'id' });
    await db.update('agent_runs', { status: 'succeeded' }, { filters: [['id', 'eq', 'x']] });
    await db.rpc('agent_run_begin', { p_agent: 'eval' });
    expect(seen.map((s) => `${s.method} ${s.url.replace(base, '')} ${s.headers.prefer ?? '-'}`)).toEqual([
      'GET /rest/v1/agent_runs?select=id&status=eq.waiting_human&limit=2 -',
      'POST /rest/v1/inbound_emails?on_conflict=tenant_id%2Cmessage_id_sha256 resolution=ignore-duplicates,return=representation',
      'POST /rest/v1/quote_workflows?select=id&on_conflict=rfq_id%2Cquote_version resolution=merge-duplicates,return=representation',
      'PATCH /rest/v1/agent_runs?id=eq.x return=minimal',
      'POST /rest/v1/rpc/agent_run_begin -',
    ]);
    for (const s of seen) {
      expect(s.headers.apikey).toBe('service-test-value');
      expect(s.headers.authorization).toBe('Bearer service-test-value');
    }
    expect(JSON.parse(seen[4].body as string)).toEqual({ p_agent: 'eval' });
  });

  it('errors carry status and SQLSTATE only; ilike with * matches nothing without a request; update needs a filter', async () => {
    const { seen, fetchImpl } = fetchRecorder(() => json({ code: '23505', message: 'duplicate key', details: 'Key (email)=(a@example.com) already exists.' }, 409));
    const db = new PostgrestDb({ url: base, serviceRoleKey: 'k', fetch: fetchImpl });
    const error = await db.insert('customers', { email: 'a@example.com' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 409, code: '23505' });
    expect((error as Error).message).not.toContain('example.com');
    expect(await db.select('rfqs', { filters: [['contact_email', 'ilike', 'a*@example.com']] })).toEqual([]);
    expect(seen).toHaveLength(1);
    await expect(db.update('agent_runs', {}, { filters: [] as never })).rejects.toThrow(/filter/);
    const down = new PostgrestDb({ url: base, serviceRoleKey: 'k', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(down.select('agent_runs')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});

describe('BotTelegram', () => {
  const env = opsEnv({ TELEGRAM_BOT_TOKEN: '123456:test-bot-value', TELEGRAM_CHAT_ID: '4242' });

  it('sendCard posts the rendered card to sendMessage with HTML parse mode; editCard replaces text and buttons', async () => {
    const { seen, fetchImpl } = fetchRecorder(() => json({ ok: true, result: { message_id: 77 } }));
    const telegram = new BotTelegram(env, fetchImpl);
    const card = testCard({ run_id: 'r1', site_origin: 'https://www.micronshub.eu' });
    expect(await telegram.sendCard(card, 'ABCDEFGHIJKLMNOPQRSTUVWX27')).toEqual({ message_id: 77 });
    await telegram.editCard(77, { ...card, allowed_verbs: [] });
    await telegram.editCard(77, { text: 'plain' });
    await telegram.sendText('notice');
    expect(seen.map((s) => s.url)).toEqual([
      'https://api.telegram.org/bot123456:test-bot-value/sendMessage',
      'https://api.telegram.org/bot123456:test-bot-value/editMessageText',
      'https://api.telegram.org/bot123456:test-bot-value/editMessageText',
      'https://api.telegram.org/bot123456:test-bot-value/sendMessage',
    ]);
    const sent = JSON.parse(seen[0].body as string);
    expect(sent).toMatchObject({ chat_id: '4242', parse_mode: 'HTML', ...renderTelegram(card, 'ABCDEFGHIJKLMNOPQRSTUVWX27') });
    expect(JSON.parse(seen[1].body as string).reply_markup).toEqual({ inline_keyboard: [[{ text: 'Open', url: card.open_url }]] });
    expect(JSON.parse(seen[2].body as string)).toMatchObject({ text: 'plain', reply_markup: { inline_keyboard: [] } });
    expect(JSON.parse(seen[3].body as string)).not.toHaveProperty('parse_mode');
  });

  it('a failed call names the method and status, never the URL or the bot token; TELEGRAM_API_BASE overrides the host', async () => {
    const { fetchImpl } = fetchRecorder(() => json({ ok: false, description: 'Bad Request' }, 400));
    const error = await new BotTelegram(env, fetchImpl).sendText('x').catch((e: Error) => e);
    expect((error as Error).message).toBe('telegram sendMessage: 400');
    const notModified = fetchRecorder(() => json({ ok: false, description: 'Bad Request: message is not modified' }, 400));
    await expect(new BotTelegram(env, notModified.fetchImpl).editCard(1, { text: 'same' })).resolves.toBeUndefined();
    const stub = fetchRecorder(() => json({ ok: true, result: { message_id: 1 } }));
    await new BotTelegram(opsEnv({ ...env, TELEGRAM_API_BASE: 'http://127.0.0.1:9/telegram' }), stub.fetchImpl).sendText('x');
    expect(stub.seen[0].url).toBe('http://127.0.0.1:9/telegram/bot123456:test-bot-value/sendMessage');
  });
});

describe('GmailApi', () => {
  const account = (config: SenderAccountRow['provider_config']): SenderAccountRow => ({ id: 'acc-1', email: 'sales@example.com', provider: 'google_workspace', is_active: true, provider_config: config });
  const now = new Date('2026-10-05T09:00:00Z');

  it('a stored token valid for 5+ minutes is used without a refresh', async () => {
    const { seen, fetchImpl } = fetchRecorder(() => json({}));
    const gmail = new GmailApi(opsEnv({}), { fetch: fetchImpl, now: () => now });
    expect(await gmail.accessToken(account({ access_token: 'stored-value', refresh_token: 'r', token_expiry: '2026-10-05T09:10:00Z' }))).toEqual({ token: 'stored-value' });
    expect(seen).toHaveLength(0);
  });

  it('otherwise refreshes in memory (form post, no write-back); invalid_grant is reported as such', async () => {
    const { seen, fetchImpl } = fetchRecorder(() => json({ access_token: 'fresh-value', expires_in: 3599 }));
    const gmail = new GmailApi(opsEnv({ GOOGLE_TOKEN_URL: 'http://127.0.0.1:9/oauth2/token' }), { fetch: fetchImpl, now: () => now });
    expect(await gmail.accessToken(account({ access_token: 'old', refresh_token: 'refresh-value', token_expiry: '2026-10-05T09:04:00Z' }))).toEqual({ token: 'fresh-value' });
    expect(seen[0].url).toBe('http://127.0.0.1:9/oauth2/token');
    expect(seen[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(seen[0].body as string).get('grant_type')).toBe('refresh_token');
    const bad = fetchRecorder(() => json({ error: 'invalid_grant' }, 400));
    expect(await new GmailApi(opsEnv({}), { fetch: bad.fetchImpl, now: () => now }).accessToken(account({ refresh_token: 'r' }))).toEqual({ error: 'invalid_grant' });
    expect(await new GmailApi(opsEnv({}), { fetch: bad.fetchImpl }).accessToken(account(null))).toEqual({ error: 'unavailable' });
  });

  it('history: messageAdded ids over pages; 404 -> stale_history; metadata and raw decode', async () => {
    let page = 0;
    const { seen, fetchImpl } = fetchRecorder((req) => {
      if (req.url.includes('/history')) {
        page++;
        return page === 1 ? json({ history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], nextPageToken: 'p2', historyId: '10' }) : json({ history: [{ messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm1' } }] }], historyId: '12' });
      }
      if (req.url.includes('format=raw')) return json({ raw: btoa('From: a\r\n\r\nhi').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
      return json({ payload: { headers: [{ name: 'Message-ID', value: '<x@example.com>' }, { name: 'References', value: '<a@x> <b@x>' }, { name: 'Subject', value: 'Re: quote' }] } });
    });
    const gmail = new GmailApi(opsEnv({ GMAIL_API_BASE: 'http://127.0.0.1:9/gmail' }), { fetch: fetchImpl });
    expect(await gmail.history('tok', '5')).toEqual({ messageIds: ['m1', 'm2'], historyId: '12' });
    expect(seen[0].url).toBe('http://127.0.0.1:9/gmail/users/me/history?startHistoryId=5&historyTypes=messageAdded&labelId=INBOX');
    expect(seen[0].headers.authorization).toBe('Bearer tok');
    expect(await gmail.metadata('tok', 'm1')).toEqual({ message_id: '<x@example.com>', in_reply_to: null, references: ['<a@x>', '<b@x>'], from: null, subject: 'Re: quote', auto_submitted: null });
    expect(new TextDecoder().decode(await gmail.raw('tok', 'm1'))).toBe('From: a\r\n\r\nhi');
    const stale = fetchRecorder(() => json({}, 404));
    expect(await new GmailApi(opsEnv({}), { fetch: stale.fetchImpl }).history('tok', '1')).toEqual({ error: 'stale_history' });
  });
});

describe('R2Blob', () => {
  it('put with sha256 (checked and kept as metadata), get, range read, head, copy', async () => {
    const bucket = new FakeR2Bucket();
    const blob = new R2Blob({ PRIVATE_FILES: bucket as unknown as R2Bucket } as OpsEnv);
    const bytes = new TextEncoder().encode('0123456789').buffer as ArrayBuffer;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await blob.put('email/x/raw.eml', bytes, { contentType: 'message/rfc822', sha256: digest, meta: { n: '1' } });
    await expect(blob.put('email/y/raw.eml', bytes, { contentType: 'message/rfc822', sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/);
    expect(await blob.head('email/x/raw.eml')).toEqual({ size: 10, sha256: digest });
    const got = await blob.get('email/x/raw.eml');
    expect(got?.contentType).toBe('message/rfc822');
    expect(await new Response(got?.body).text()).toBe('0123456789');
    expect(await new Response(await blob.getRange('email/x/raw.eml', 3, 4)).text()).toBe('3456');
    expect(bucket.reads.at(-1)).toEqual({ key: 'email/x/raw.eml', range: { offset: 3, length: 4 } });
    await blob.copy('email/x/raw.eml', 'rfq/r/f-raw.eml');
    expect(bucket.text('rfq/r/f-raw.eml')).toBe('0123456789');
    expect(await blob.get('missing')).toBeNull();
    await expect(new R2Blob(opsEnv({})).head('x')).rejects.toThrow(/config_missing: PRIVATE_FILES/);
  });
});

describe('embeddings and vectors', () => {
  const meta = (over: Partial<QuoteVectorMeta> = {}): QuoteVectorMeta => ({ quote_workflow_id: 'q', rfq_id: 'r', line_no: 1, process: 'sheet_metal', material_family: 'steel', material_grade: 'S235', thickness_mm: 2, qty: 10, unit_price_eur: 5, line_total_eur: 50, outcome: 'won', sent_at_unix: 1, rules_version: 'v1', ...over });

  it('HashEmbed: deterministic unit vectors of 1,024 dimensions; usage priced like bge-m3', async () => {
    const embed = new HashEmbed();
    const { vectors, usage } = await embed.embed(['Bracket S235 2 mm', 'Bracket S235 2 mm', ''], { agent: 'quote', run_id: 'r', tenant_id: 't', step: 's' });
    expect(vectors[0]).toHaveLength(1024);
    expect(vectors[0]).toEqual(vectors[1]);
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 9);
    expect(Math.hypot(...vectors[2])).toBeCloseTo(1, 9);
    expect(usage.input_tokens).toBe(10);
    expect(usage.cost_usd).toBeGreaterThan(0);
  });

  it('MemoryVectorIndex: cosine ranking per namespace with $eq, $in, $gte, $lte filters', async () => {
    const index = new MemoryVectorIndex();
    await index.upsert('t1', [
      { id: 'a:1', values: hashVector('bracket steel 2mm'), metadata: meta({ thickness_mm: 2 }) },
      { id: 'b:1', values: hashVector('flange aluminium'), metadata: meta({ material_family: 'aluminium', thickness_mm: 5, outcome: 'lost' }) },
    ]);
    await index.upsert('t2', [{ id: 'c:1', values: hashVector('bracket steel 2mm'), metadata: meta() }]);
    const top = await index.query('t1', hashVector('bracket steel 2mm'), { topK: 2 });
    expect(top.map((m) => m.id)).toEqual(['a:1', 'b:1']);
    expect(top[0].score).toBeCloseTo(1, 9);
    expect((await index.query('t1', hashVector('x'), { topK: 5, filter: { material_family: { $in: ['aluminium'] } } })).map((m) => m.id)).toEqual(['b:1']);
    expect((await index.query('t1', hashVector('x'), { topK: 5, filter: { thickness_mm: { $gte: 3, $lte: 6 }, outcome: 'lost' } })).map((m) => m.id)).toEqual(['b:1']);
    expect(matchesFilter({ a: 1 }, { a: { $eq: 1 } })).toBe(true);
    expect(() => matchesFilter({ a: 1 }, { a: { $ne: 1 } })).toThrow(/unsupported/);
    await expect(index.upsert('t1', [{ id: 'bad', values: [1, 2], metadata: meta() }])).rejects.toThrow(/dimensions/);
  });

  it('R2PersistedVectors keeps the index between instances in __stub/vectors/<ns>.json', async () => {
    const bucket = new FakeR2Bucket();
    await new R2PersistedVectors(bucket as unknown as R2Bucket).upsert('tenant', [{ id: 'a:1', values: hashVector('a'), metadata: meta() }]);
    expect([...bucket.objects.keys()]).toEqual(['__stub/vectors/tenant.json']);
    expect((await new R2PersistedVectors(bucket as unknown as R2Bucket).query('tenant', hashVector('a'), { topK: 1 }))[0].id).toBe('a:1');
  });
});
