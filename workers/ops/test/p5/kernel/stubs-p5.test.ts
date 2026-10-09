// The Phase 5 stub modules of the T2 profile 'jobs' (workers/site/test/integration/stubs/), run on a local stub
// server (127.0.0.1 only) without workerd: PullPush, Algolia, Xometry, IndexNow, Google AI Studio, Storage and the CAD
// container, plus the Phase 5 additions to the Gmail (send), Telegram (raw body) and mini-PostgREST (Phase 5 tables,
// unique keys and article-queue RPCs) stubs. The production adapters of src/ports/p5.ts are pointed at it, so the
// request shapes the adapters send are the ones the stubs answer.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeP5Ports, type TextLlmMeta } from '../../../src/ports/p5';
import { opsEnv } from '../../helpers/ops';

interface StubServer {
  startStub(o: { modules: unknown[] }): Promise<{ url: string; close(): Promise<void> }>;
  agentStubModules(): Promise<unknown[]>;
  jobsStubModules(): Promise<unknown[]>;
}
const server = (await import(/* @vite-ignore */ new URL('../../../../site/test/integration/stub-server.mjs', import.meta.url).href)) as StubServer;

let stub: { url: string; close(): Promise<void> };
const META: TextLlmMeta = { agent: 'content_daily.translate', run_id: 'r1', tenant_id: 't1', step: 'translate', prompt: 'content_daily.translate@v1' };
const AUTH = { apikey: 't2', authorization: 'Bearer t2', 'content-type': 'application/json' };

beforeAll(async () => {
  stub = await server.startStub({ modules: [...(await server.agentStubModules()), ...(await server.jobsStubModules())] });
});
afterAll(async () => stub.close());
beforeEach(async () => {
  await fetch(`${stub.url}/__stub/reset`, { method: 'POST' });
});

const get = async <T>(path: string): Promise<T> => (await (await fetch(`${stub.url}${path}`)).json()) as T;
const post = (path: string, body: unknown) => fetch(`${stub.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function t2Env() {
  return opsEnv({
    SUPABASE_URL: stub.url,
    AI_GATEWAY_TOKEN: ['t2', 'gateway'].join('-'),
    PULLPUSH_API_BASE: `${stub.url}/pullpush`,
    HN_API_BASE: `${stub.url}/hn`,
    XOMETRY_API_BASE: `${stub.url}/xometry`,
    INDEXNOW_API_BASE: `${stub.url}/indexnow`,
    AGENT_GEMINI_BASE_URL: `${stub.url}/google-ai-studio`,
    CAD_CONTAINER_BASE_URL: `${stub.url}/cad-container`,
    TELEGRAM_API_BASE: `${stub.url}/telegram`,
    GMAIL_API_BASE: `${stub.url}/gmail`,
  });
}

describe('collector sources', () => {
  it('PullPush: scripted posts per subreddit, the User-Agent recorded; unscripted subreddit answers no posts', async () => {
    await post('/__stub/pullpush/script', { subreddits: { manufacturing: { posts: [{ id: 'p1', title: 'Need CNC quote' }] }, down: { status: 503 } } });
    const p5 = makeP5Ports(t2Env());
    const url = `${p5.sources.base('pullpush')}/reddit/search/submission?subreddit=manufacturing&sort=new&size=100`;
    const res = await p5.sources.fetch(url, { headers: { 'User-Agent': 'MicronsHubLeadMonitor/1.0' } });
    expect(await res.json()).toEqual({ data: [{ id: 'p1', title: 'Need CNC quote' }] });
    expect((await p5.sources.fetch(`${p5.sources.base('pullpush')}/reddit/search/submission?subreddit=down`)).status).toBe(503);
    expect(await (await p5.sources.fetch(`${p5.sources.base('pullpush')}/reddit/search/submission?subreddit=other`)).json()).toEqual({ data: [] });
    const calls = await get<Array<{ subreddit: string; user_agent: string | null }>>('/__stub/pullpush/calls');
    expect(calls.map((c) => c.subreddit)).toEqual(['manufacturing', 'down', 'other']);
    expect(calls[0]?.user_agent).toBe('MicronsHubLeadMonitor/1.0');
  });

  it('Algolia: hits per query and for Show HN', async () => {
    await post('/__stub/hn/script', { queries: { 'sheet metal': { hits: [{ objectID: '1' }] }, show_hn: { hits: [{ objectID: '2' }] } } });
    const base = makeP5Ports(t2Env()).sources.base('hn');
    expect(await (await fetch(`${base}/search_by_date?query=sheet%20metal&tags=story&numericFilters=created_at_i%3E1&hitsPerPage=50`)).json()).toMatchObject({ hits: [{ objectID: '1' }] });
    expect(await (await fetch(`${base}/search_by_date?tags=show_hn&numericFilters=created_at_i%3E1&hitsPerPage=50`)).json()).toMatchObject({ hits: [{ objectID: '2' }] });
    expect(await (await fetch(`${base}/search_by_date?query=none&tags=story`)).json()).toMatchObject({ hits: [] });
    expect((await get<Array<{ query: string | null; tags: string }>>('/__stub/hn/calls')).map((c) => [c.query, c.tags])).toEqual([['sheet metal', 'story'], [null, 'show_hn'], ['none', 'story']]);
  });

  it('Xometry: scripted answers in order (401 first), credential presence recorded, never values', async () => {
    await post('/__stub/xometry/script', { responses: [{ status: 401, body: { errors: [{ message: 'Unauthorized' }] } }], default: { status: 200, body: { data: { offers: [] } } } });
    const base = makeP5Ports(t2Env()).sources.base('xometry');
    const send = () => fetch(`${base}/partners/graphql`, { method: 'POST', headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'Offers', variables: { page: 1 } }) });
    expect((await send()).status).toBe(401);
    expect(await (await send()).json()).toEqual({ data: { offers: [] } });
    expect(await get('/__stub/xometry/calls')).toEqual([
      { method: 'POST', operationName: 'Offers', variables: { page: 1 }, headers: { authorization: true, cookie: false, 'x-auth-token': false } },
      { method: 'POST', operationName: 'Offers', variables: { page: 1 }, headers: { authorization: true, cookie: false, 'x-auth-token': false } },
    ]);
  });

  it('IndexNow: the body is recorded and 202 answered (scripted status otherwise)', async () => {
    const base = makeP5Ports(t2Env()).sources.base('indexnow');
    const body = { host: 'www.micronshub.eu', key: 'k', keyLocation: 'https://www.micronshub.eu/indexnow_key.txt', urlList: ['https://www.micronshub.eu/de/blog/x'] };
    expect((await fetch(`${base}/indexnow`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })).status).toBe(202);
    await post('/__stub/indexnow/script', { status: 429 });
    expect((await fetch(`${base}/indexnow`, { method: 'POST', body: '{}' })).status).toBe(429);
    expect((await get<Array<{ body: unknown }>>('/__stub/indexnow/calls'))[0]?.body).toEqual(body);
  });
});

describe('Gemini through the stub (the port as in T2)', () => {
  it('per-model answers: 429 then 404 then text; calls record the model, the prompt hash and that no key was sent', async () => {
    await post('/__stub/google-ai-studio/script', { models: { 'gemini-2.5-flash-lite': [{ status: 429, body: { error: { code: 429 } } }], 'gemini-2.5-flash': [{ status: 404, body: { error: { code: 404 } } }], 'gemini-2.0-flash': [{ text: 'Hallo Welt' }] } });
    const llm = makeP5Ports(t2Env()).textLlm;
    const ask = (model: string) => llm.gemini({ model, prompt: 'Hello world', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 5_000, meta: META });
    expect(await ask('gemini-2.5-flash-lite')).toMatchObject({ ok: false, code: 'rate_limited', status: 429 });
    expect(await ask('gemini-2.5-flash')).toMatchObject({ ok: false, code: 'not_found', status: 404 });
    expect(await ask('gemini-2.0-flash')).toMatchObject({ ok: true, text: 'Hallo Welt', stop: 'STOP', model: 'gemini-2.0-flash', usage: { input_tokens: 100, output_tokens: 200 } });
    expect(await ask('gemini-2.0-flash')).toMatchObject({ ok: false, code: 'not_found' }); // unscripted: loud 404
    const calls = await get<Array<Record<string, unknown>>>('/__stub/google-ai-studio/calls');
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ model: 'gemini-2.5-flash-lite', temperature: 0.3, maxOutputTokens: 8192, cf_aig_metadata_keys: ['agent', 'run_id', 'tenant_id', 'step', 'prompt'], provider_key_sent: false });
    expect(calls[0]?.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a request without the gateway authorization is refused (401)', async () => {
    const res = await fetch(`${stub.url}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });
});

describe('Storage, Gmail send, Telegram text, CAD container', () => {
  it('the sitemap upload is stored byte for byte with its headers; a scripted failure is answered', async () => {
    const p5 = makeP5Ports(t2Env());
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>ä</urlset>';
    expect(await p5.storage.upload('sitemap-complete.xml', xml, { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: true });
    expect(await p5.storage.upload('sitemap-complete.xml', xml, { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: true });
    const objects = await get<Array<Record<string, unknown>>>('/__stub/storage/objects');
    expect(objects).toEqual([{ bucket: 'sitemaps', name: 'sitemap-complete.xml', content_type: 'application/xml', cache_control: 'max-age=3600', upsert: true, size: Buffer.byteLength(xml), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(await (await fetch(`${stub.url}/__stub/storage/object/sitemaps/sitemap-complete.xml`)).text()).toBe(xml);
    await post('/__stub/storage/script', { status: 500 });
    expect(await p5.storage.upload('sitemap-complete.xml', xml, { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: false, status: 500, message: 'storage upload: 500' });
  });

  it('Gmail send: the raw MIME is decoded and recorded, ids answered in order; a scripted 429 is retryable', async () => {
    const p5 = makeP5Ports(t2Env());
    const mime = 'From: Sales <sales@example.com>\r\nSubject: Offer\r\n\r\n<p>Grüße</p>';
    expect(await p5.gmailSend.send('t', new TextEncoder().encode(mime))).toEqual({ ok: true, id: 'gmail-sent-1' });
    await post('/__stub/gmail/script', { send: [{ status: 429 }] });
    expect(await p5.gmailSend.send('t', new TextEncoder().encode(mime))).toMatchObject({ ok: false, status: 429, retryable: true });
    const sent = await get<Array<{ mime: string; id: string | null; status: number }>>('/__stub/gmail/sent');
    expect(sent).toEqual([{ mime, id: 'gmail-sent-1', status: 200 }, { mime, id: null, status: 429 }]);
    expect((await fetch(`${stub.url}/gmail/v1/users/me/messages/send`, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('Telegram: the plain sendMessage body is recorded byte for byte (raw) next to the parsed body', async () => {
    const env = { ...t2Env(), TELEGRAM_BOT_TOKEN: ['42', 'T2'].join(':') };
    const text = '\u{1F534} HIGH LEAD\n\nr/x · 5m ago';
    expect(await makeP5Ports(env).telegramText.send(text, { disableWebPagePreview: true })).toEqual({ ok: true, status: 200 });
    const calls = await get<Array<{ method: string; body: Record<string, unknown>; raw: string }>>('/__stub/telegram/calls');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.raw).toBe(JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }));
    expect(calls[0]?.body).toEqual({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true });
    expect(calls[0]?.body.parse_mode).toBeUndefined();
  });

  it('CAD container: re-addressed requests reach the scripted route with the slot; health default; destroy recorded', async () => {
    await post('/__stub/cad-container/script', { routes: [{ method: 'POST', path: '/flat-pattern', status: 200, text: '0\nSECTION', content_type: 'application/dxf', once: true }] });
    const p5 = makeP5Ports(t2Env());
    const flat = await p5.container.fetch('cad-1', new Request('http://cad/flat-pattern', { method: 'POST', headers: { 'X-API-Key': 'k', 'content-type': 'application/json' }, body: JSON.stringify({ file_url: 'http://cad-input.internal/u/abc', file_name: 'a.step' }) }));
    expect([flat.status, flat.headers.get('content-type'), await flat.text()]).toEqual([200, 'application/dxf', '0\nSECTION']);
    expect((await p5.container.fetch('cad-1', new Request('http://cad/flat-pattern', { method: 'POST', body: '{}' }))).status).toBe(503);
    expect(await (await p5.container.fetch('cad-0', new Request('http://cad/health'))).json()).toEqual({ status: 'healthy' });
    await p5.container.destroy('cad-1');
    const calls = await get<Array<Record<string, unknown>>>('/__stub/cad-container/calls');
    expect(calls[0]).toEqual({ method: 'POST', path: '/flat-pattern', slot: 'cad-1', api_key: true, content_type: 'application/json', body: { file_url: 'http://cad-input.internal/u/abc', file_name: 'a.step' } });
    expect(await get('/__stub/cad-container/destroyed')).toEqual(['cad-1']);
  });
});

describe('mini-PostgREST: Phase 5 tables and RPCs', () => {
  it('serves the Phase 5 tables before any seed; leads ignore-duplicates; articles 23505; the queue RPCs', async () => {
    expect(await (await fetch(`${stub.url}/rest/v1/xometry_offers?select=code`, { headers: AUTH })).json()).toEqual([]);
    const lead = () => fetch(`${stub.url}/rest/v1/leads?on_conflict=source,external_id`, { method: 'POST', headers: { ...AUTH, prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ source: 'hackernews', external_id: '7', title: 'x' }]) });
    expect(await (await lead()).json()).toHaveLength(1);
    expect(await (await lead()).json()).toEqual([]);
    const article = () => fetch(`${stub.url}/rest/v1/articles`, { method: 'POST', headers: { ...AUTH, prefer: 'return=representation' }, body: JSON.stringify({ slug: 's', language: 'en', title: 't' }) });
    expect((await article()).status).toBe(201);
    const dup = await article();
    expect([dup.status, ((await dup.json()) as { code: string }).code]).toEqual([409, '23505']);
    await post('/__stub/seed', { tables: { article_titles: [{ id: 't1', title: 'T', processed: false, created_at: '2026-10-01T00:00:00Z' }] } });
    const rpc = (name: string, args: unknown = {}) => fetch(`${stub.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: AUTH, body: JSON.stringify(args) });
    const queueId = (await (await rpc('enqueue_next_article')).json()) as string;
    expect(queueId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await rpc('get_next_queue_job')).json()).toMatchObject([{ queue_id: queueId, title_id: 't1', title: 'T' }]);
    expect((await rpc('mark_queue_job_completed', { queue_job_id: queueId, article_id: 'a' })).status).toBe(200);
    expect((await get<Array<Record<string, unknown>>>('/__stub/rows/article_titles'))[0]).toMatchObject({ processed: true });
    expect((await rpc('no_such_function')).status).toBe(404);
  });
});
