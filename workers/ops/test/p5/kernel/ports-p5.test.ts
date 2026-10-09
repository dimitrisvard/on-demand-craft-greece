// The production adapters of the Phase 5 ports (src/ports/p5.ts) against a recording fetch: the Anthropic text call
// through the gateway client (one user message, no system, no thinking, per-call timeouts, stop-reason and error
// mapping), the Gemini call through the gateway route google-ai-studio (no key header or parameter), the T2 base
// overrides, the Storage upload, the Gmail send, the container port and the plain Telegram text; makeP5Ports fails
// closed when a T2-only override is set while AI is bound (PHASE5_SPEC §5.4).

import { describe, expect, it } from 'vitest';
import type { OpsEnv } from '../../../src/env';
import { CAD_SLOT_HEADER, makeP5Ports, P5_T2_ONLY_VARS, SOURCE_BASES, setOverrideVars, type TextLlmMeta } from '../../../src/ports/p5';
import { agentBindings } from '../../helpers/agent-env';
import { opsEnv } from '../../helpers/ops';

const GATEWAY = 'https://gateway.ai.cloudflare.test/v1/account/microns';
const META: TextLlmMeta = { agent: 'content_daily', run_id: 'run-1', tenant_id: '00000000-0000-0000-0000-000000000001', step: 'generate-en', prompt: 'content_daily.generate_en@v1' };
const GATEWAY_TOKEN = ['aig', 'test', 'value'].join('-');

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function recorder(answer: (r: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const r = { url: req.url, method: req.method, headers, body: req.method === 'GET' ? '' : await req.text() };
    calls.push(r);
    return answer(r);
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

const fakeAi = { gateway: (id: string) => ({ getUrl: async (provider: string) => `${GATEWAY.replace('microns', id)}/${provider}` }) } as unknown as Ai;

function prodEnv(overrides: Partial<OpsEnv> = {}): OpsEnv {
  return opsEnv({ ...agentBindings(), AI: fakeAi, AI_GATEWAY_TOKEN: GATEWAY_TOKEN, ...overrides });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const anthropicMessage = (o: { stop_reason?: string; content?: unknown[]; model?: string } = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: o.model ?? 'claude-sonnet-5',
  content: o.content ?? [{ type: 'text', text: '{"title":"T"}' }],
  stop_reason: o.stop_reason ?? 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

describe('makeP5Ports: fail closed', () => {
  it('throws when any T2-only override var is set while AI is bound', () => {
    for (const name of P5_T2_ONLY_VARS) {
      expect(() => makeP5Ports(prodEnv({ [name]: 'http://127.0.0.1:9' } as Partial<OpsEnv>)), name).toThrow(/T2-only override vars are set while AI is bound/);
    }
  });

  it('accepts the overrides without AI (generated T2 configs) and a production env without overrides', () => {
    expect(() => makeP5Ports(opsEnv({ PULLPUSH_API_BASE: 'http://127.0.0.1:9/pullpush' }))).not.toThrow();
    expect(() => makeP5Ports(prodEnv())).not.toThrow();
    expect(setOverrideVars(opsEnv({ HN_API_BASE: '', CAD_CONTAINER_BASE_URL: 'http://x' }))).toEqual(['CAD_CONTAINER_BASE_URL']);
  });

  it('the override list is exactly the six base-URL names of §5.4 plus the content wait override', () => {
    expect([...P5_T2_ONLY_VARS]).toEqual(['PULLPUSH_API_BASE', 'HN_API_BASE', 'XOMETRY_API_BASE', 'INDEXNOW_API_BASE', 'AGENT_GEMINI_BASE_URL', 'CAD_CONTAINER_BASE_URL', 'CONTENT_WAIT_TIMEOUT_S']);
  });

  it('the content wait override is refused while AI is bound, like the base URLs', () => {
    expect(() => makeP5Ports(prodEnv({ CONTENT_WAIT_TIMEOUT_S: '5' } as Partial<OpsEnv>))).toThrow(/CONTENT_WAIT_TIMEOUT_S/);
    expect(() => makeP5Ports(opsEnv({ CONTENT_WAIT_TIMEOUT_S: '5' }))).not.toThrow();
  });
});

describe('textLlm.anthropic (production path through the gateway client)', () => {
  it('one user message, model and max_tokens only (no system, no thinking), gateway headers, per-call timeouts', async () => {
    const rec = recorder(() => json(anthropicMessage()));
    const p5 = makeP5Ports(prodEnv(), { fetch: rec.fetch });
    const result = await p5.textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 16384, userText: 'Write the article.', timeoutMs: 310_000, gatewayTimeoutMs: 300_000, meta: META });
    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0]!;
    expect(call.url).toBe(`${GATEWAY}/anthropic/v1/messages`);
    expect(JSON.parse(call.body)).toEqual({ model: 'claude-sonnet-5', max_tokens: 16384, messages: [{ role: 'user', content: 'Write the article.' }] });
    expect(call.headers['cf-aig-authorization']).toBe(`Bearer ${GATEWAY_TOKEN}`);
    expect(JSON.parse(call.headers['cf-aig-metadata'] ?? '{}')).toEqual(META);
    expect(call.headers['cf-aig-collect-log-payload']).toBe('false');
    expect(call.headers['cf-aig-request-timeout']).toBe('300000');
    expect(call.headers['x-api-key']).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      text: '{"title":"T"}',
      stop: 'end_turn',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: (1000 * 2 + 2000 * 10) / 1_000_000, model: 'claude-sonnet-5' },
    });
  });

  it('without gatewayTimeoutMs the gateway client default stays (150 s)', async () => {
    const rec = recorder(() => json(anthropicMessage()));
    await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 10, userText: 'x', timeoutMs: 5_000, meta: META });
    expect(rec.calls[0]?.headers['cf-aig-request-timeout']).toBe('150000');
  });

  it('stop reasons: max_tokens -> other (not retryable), refusal -> blocked, no text block -> empty; the first text block is the text', async () => {
    const cases: Array<[ReturnType<typeof anthropicMessage>, Record<string, unknown>]> = [
      [anthropicMessage({ stop_reason: 'max_tokens' }), { ok: false, code: 'other', retryable: false }],
      [anthropicMessage({ stop_reason: 'refusal' }), { ok: false, code: 'blocked', retryable: false }],
      [anthropicMessage({ content: [] }), { ok: false, code: 'empty' }],
      [anthropicMessage({ stop_reason: 'pause_turn' }), { ok: false, code: 'empty' }],
      [anthropicMessage({ content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }), { ok: true, text: 'first' }],
    ];
    for (const [answer, expected] of cases) {
      const rec = recorder(() => json(answer));
      const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 10, userText: 'x', timeoutMs: 5_000, meta: META });
      expect(result, JSON.stringify(answer.stop_reason)).toMatchObject(expected);
    }
  });

  it('an answer that stops at max_tokens, refuses or has no text keeps its billed token usage on the failure', async () => {
    const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: (1000 * 2 + 2000 * 10) / 1_000_000, model: 'claude-sonnet-5' };
    const ask = async (answer: ReturnType<typeof anthropicMessage>) =>
      makeP5Ports(prodEnv(), { fetch: recorder(() => json(answer)).fetch }).textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 16384, userText: 'x', timeoutMs: 5_000, meta: META });
    expect(await ask(anthropicMessage({ stop_reason: 'max_tokens' }))).toEqual({ ok: false, status: 200, code: 'other', retryable: false, message: 'anthropic: stopped at max_tokens', usage });
    expect(await ask(anthropicMessage({ stop_reason: 'refusal' }))).toMatchObject({ ok: false, code: 'blocked', usage });
    expect(await ask(anthropicMessage({ content: [] }))).toMatchObject({ ok: false, code: 'empty', usage });
    expect(await ask(anthropicMessage({ stop_reason: 'pause_turn' }))).toMatchObject({ ok: false, code: 'empty', usage });
    // The answer's model names the price row, as for a successful call.
    expect(await ask(anthropicMessage({ stop_reason: 'max_tokens', model: 'claude-haiku-4-5-20251001' }))).toMatchObject({
      usage: { model: 'claude-haiku-4-5-20251001', cost_usd: (1000 * 1 + 2000 * 5) / 1_000_000 },
    });
  });

  it('a provider error carries no usage (nothing was answered)', async () => {
    const rec = recorder(() => json({ type: 'error', error: { type: 'x', message: 'no' } }, 500));
    const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 10, userText: 'x', timeoutMs: 5_000, meta: META });
    expect(result).toMatchObject({ ok: false, code: 'server' });
    expect(result).not.toHaveProperty('usage');
  });

  it('provider errors: 404 not_found, 429 rate_limited, 500 and 529 server (retryable), 400 other; no retry by the client', async () => {
    const cases: Array<[number, Record<string, unknown>]> = [
      [404, { code: 'not_found', retryable: false, status: 404 }],
      [429, { code: 'rate_limited', retryable: true, status: 429 }],
      [500, { code: 'server', retryable: true, status: 500 }],
      [529, { code: 'server', retryable: true, status: 529 }],
      [400, { code: 'other', retryable: false, status: 400 }],
    ];
    for (const [status, expected] of cases) {
      const rec = recorder(() => json({ type: 'error', error: { type: 'x', message: 'no' } }, status));
      const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.anthropic({ model: 'claude-sonnet-5', maxTokens: 10, userText: 'x', timeoutMs: 5_000, meta: META });
      expect(result, String(status)).toMatchObject({ ok: false, ...expected });
      expect(rec.calls, String(status)).toHaveLength(1);
    }
  });

  it('missing gateway configuration throws ConfigMissingError (the caller closes config_missing)', async () => {
    const p5 = makeP5Ports(opsEnv(), { fetch: recorder(() => json({})).fetch });
    await expect(p5.textLlm.anthropic({ model: 'm', maxTokens: 1, userText: 'x', timeoutMs: 1_000, meta: META })).rejects.toMatchObject({ code: 'config_missing' });
  });
});

describe('textLlm.gemini', () => {
  const geminiAnswer = (o: Record<string, unknown> = {}) => ({
    candidates: [{ content: { role: 'model', parts: [{ text: 'Übersetzt' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 3000, thoughtsTokenCount: 500 },
    modelVersion: 'gemini-2.5-flash-lite',
    ...o,
  });

  it('POST <gateway google-ai-studio>/v1beta/models/<model>:generateContent with the live body, gateway headers, no key', async () => {
    const rec = recorder(() => json(geminiAnswer()));
    const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.gemini({ model: 'gemini-2.5-flash-lite', prompt: 'Translate', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    const call = rec.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${GATEWAY}/google-ai-studio/v1beta/models/gemini-2.5-flash-lite:generateContent`);
    expect(call.body).toBe(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Translate' }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192 } }));
    expect(call.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(call.headers['cf-aig-authorization']).toBe(`Bearer ${GATEWAY_TOKEN}`);
    expect(JSON.parse(call.headers['cf-aig-metadata'] ?? '{}')).toEqual(META);
    expect(call.headers['x-goog-api-key']).toBeUndefined();
    expect(new URL(call.url).searchParams.has('key')).toBe(false);
    expect(result).toEqual({
      ok: true,
      text: 'Übersetzt',
      stop: 'STOP',
      model: 'gemini-2.5-flash-lite',
      usage: { input_tokens: 1000, output_tokens: 3500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: (1000 * 0.1 + 3500 * 0.4) / 1_000_000, model: 'gemini-2.5-flash-lite' },
    });
  });

  it('T2: AGENT_GEMINI_BASE_URL replaces the gateway URL (AI not bound)', async () => {
    const rec = recorder(() => json(geminiAnswer()));
    const env = opsEnv({ ...agentBindings(), AI_GATEWAY_TOKEN: GATEWAY_TOKEN, AGENT_GEMINI_BASE_URL: 'http://127.0.0.1:9/google-ai-studio/' });
    await makeP5Ports(env, { fetch: rec.fetch }).textLlm.gemini({ model: 'gemini-2.0-flash', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(rec.calls[0]?.url).toBe('http://127.0.0.1:9/google-ai-studio/v1beta/models/gemini-2.0-flash:generateContent');
  });

  it('MAX_TOKENS with text is ok (the caller judges it, as live); an alias is priced by modelVersion; a model without a row costs 0', async () => {
    const p = (answer: unknown) => makeP5Ports(prodEnv(), { fetch: recorder(() => json(answer)).fetch }).textLlm.gemini({ model: 'gemini-flash-latest', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(await p(geminiAnswer({ candidates: [{ content: { parts: [{ text: 'half' }] }, finishReason: 'MAX_TOKENS' }], modelVersion: 'gemini-2.5-flash' }))).toMatchObject({ ok: true, stop: 'MAX_TOKENS', model: 'gemini-2.5-flash', usage: { cost_usd: (1000 * 0.3 + 3500 * 2.5) / 1_000_000 } });
    expect(await p(geminiAnswer({ modelVersion: undefined }))).toMatchObject({ ok: true, model: 'gemini-flash-latest', usage: { cost_usd: 0, input_tokens: 1000 } });
    expect(await p(geminiAnswer({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }))).toMatchObject({ ok: true, stop: 'UNKNOWN' });
  });

  it('cached prompt tokens are counted once: input = promptTokenCount - cachedContentTokenCount, cache read = cachedContentTokenCount', async () => {
    // promptTokenCount is the whole effective prompt and already includes the cached part (generateContent
    // UsageMetadata), while the Phase 4 LlmUsage keeps uncached input and cache reads apart.
    const rec = recorder(() =>
      json(geminiAnswer({ usageMetadata: { promptTokenCount: 10_000, cachedContentTokenCount: 8_000, candidatesTokenCount: 1_000 } })),
    );
    const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).textLlm.gemini({ model: 'gemini-2.5-flash-lite', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.usage).toEqual({
      input_tokens: 2_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 8_000,
      cache_creation_input_tokens: 0,
      cost_usd: (2_000 * 0.1 + 1_000 * 0.4 + 8_000 * 0.01) / 1_000_000,
      model: 'gemini-2.5-flash-lite',
    });
    // A cached count above the prompt count (malformed answer) never yields negative input.
    const odd = await makeP5Ports(prodEnv(), { fetch: recorder(() => json(geminiAnswer({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 300, candidatesTokenCount: 1 } }))).fetch })
      .textLlm.gemini({ model: 'gemini-2.5-flash-lite', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(odd).toMatchObject({ ok: true, usage: { input_tokens: 0, cache_read_input_tokens: 300 } });
  });

  it('a 200 answer without text keeps its token usage on the failure (empty, blocked, error in answer); non-2xx and network failures carry none', async () => {
    const env = prodEnv();
    const usageMetadata = { promptTokenCount: 1000, candidatesTokenCount: 40, thoughtsTokenCount: 10 };
    const expectedUsage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: (1000 * 0.3 + 50 * 2.5) / 1_000_000, model: 'gemini-2.5-flash' };
    const run = async (answer: () => Response | Promise<Response>) =>
      makeP5Ports(env, { fetch: recorder(answer).fetch }).textLlm.gemini({ model: 'gemini-2.5-flash', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(await run(() => json({ candidates: [], usageMetadata }))).toEqual({ ok: false, status: 200, code: 'empty', retryable: false, message: 'gemini: empty answer', usage: expectedUsage });
    expect(await run(() => json({ candidates: [{ finishReason: 'SAFETY' }], usageMetadata }))).toMatchObject({ ok: false, code: 'blocked', usage: expectedUsage });
    expect(await run(() => json({ error: { message: 'bad' }, usageMetadata }))).toMatchObject({ ok: false, code: 'other', usage: expectedUsage });
    // An answer without usageMetadata spent nothing that can be recorded: no usage field.
    expect(await run(() => json({ candidates: [] }))).not.toHaveProperty('usage');
    expect(await run(() => json({}, 503))).not.toHaveProperty('usage');
    expect(await run(() => Promise.reject(new TypeError('fetch failed')))).not.toHaveProperty('usage');
  });

  it('error mapping: 404 not_found, 429 rate_limited, 500/503 server with status, 403 other; empty, blocked, timeout, network', async () => {
    const env = prodEnv();
    const run = async (answer: () => Response | Promise<Response>, timeoutMs = 90_000) =>
      makeP5Ports(env, { fetch: recorder(answer).fetch }).textLlm.gemini({ model: 'gemini-2.5-flash', prompt: 'p', temperature: 0.3, maxOutputTokens: 8192, timeoutMs, meta: META });
    expect(await run(() => json({ error: { code: 404 } }, 404))).toMatchObject({ ok: false, code: 'not_found', status: 404 });
    expect(await run(() => json({}, 429))).toMatchObject({ ok: false, code: 'rate_limited', status: 429, retryable: true });
    expect(await run(() => json({}, 503))).toMatchObject({ ok: false, code: 'server', status: 503, retryable: true });
    expect(await run(() => json({}, 500))).toMatchObject({ ok: false, code: 'server', status: 500 });
    expect(await run(() => json({}, 403))).toMatchObject({ ok: false, code: 'other', status: 403, retryable: false });
    expect(await run(() => json({ candidates: [] }))).toMatchObject({ ok: false, code: 'empty' });
    expect(await run(() => json({ candidates: [{ finishReason: 'SAFETY' }] }))).toMatchObject({ ok: false, code: 'blocked' });
    expect(await run(() => json({ promptFeedback: { blockReason: 'OTHER' } }))).toMatchObject({ ok: false, code: 'blocked' });
    expect(await run(() => json({ error: { message: 'bad' } }))).toMatchObject({ ok: false, code: 'other' });
    expect(await run(() => new Response('not json', { status: 200 }))).toMatchObject({ ok: false, code: 'other' });
    expect(await run(() => Promise.reject(new TypeError('fetch failed')))).toMatchObject({ ok: false, code: 'server', status: null, retryable: true });
    const slow = () => new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 5));
    expect(await run(slow, 1)).toMatchObject({ ok: false, code: 'timeout', retryable: true });
  });
});

describe('sources', () => {
  it('production bases, T2 overrides (trailing slash trimmed), and the fetch used', async () => {
    const prod = makeP5Ports(prodEnv());
    expect(['pullpush', 'hn', 'xometry', 'indexnow'].map((n) => prod.sources.base(n as 'hn'))).toEqual([SOURCE_BASES.pullpush, SOURCE_BASES.hn, SOURCE_BASES.xometry, SOURCE_BASES.indexnow]);
    expect(SOURCE_BASES).toEqual({ pullpush: 'https://api.pullpush.io', hn: 'https://hn.algolia.com/api/v1', xometry: 'https://api.xometry.eu', indexnow: 'https://www.bing.com' });
    const stub = 'http://127.0.0.1:9';
    const rec = recorder(() => new Response('ok'));
    const t2 = makeP5Ports(opsEnv({ PULLPUSH_API_BASE: `${stub}/pullpush/`, HN_API_BASE: `${stub}/hn`, XOMETRY_API_BASE: `${stub}/xometry`, INDEXNOW_API_BASE: `${stub}/indexnow` }), { fetch: rec.fetch });
    expect(['pullpush', 'hn', 'xometry', 'indexnow'].map((n) => t2.sources.base(n as 'hn'))).toEqual([`${stub}/pullpush`, `${stub}/hn`, `${stub}/xometry`, `${stub}/indexnow`]);
    await t2.sources.fetch(`${t2.sources.base('hn')}/search_by_date?query=x`);
    expect(rec.calls[0]?.url).toBe(`${stub}/hn/search_by_date?query=x`);
  });
});

describe('storage', () => {
  it('POST {SUPABASE_URL}/storage/v1/object/sitemaps/<name> with the service role, x-upsert, content-type and cache-control', async () => {
    const rec = recorder(() => json({ Key: 'sitemaps/sitemap-complete.xml' }));
    const env = prodEnv();
    const result = await makeP5Ports(env, { fetch: rec.fetch }).storage.upload('sitemap-complete.xml', '<urlset/>', { contentType: 'application/xml', cacheControl: '3600' });
    expect(result).toEqual({ ok: true });
    const call = rec.calls[0]!;
    expect(call.url).toBe(`${env.SUPABASE_URL}/storage/v1/object/sitemaps/sitemap-complete.xml`);
    expect(call.method).toBe('POST');
    expect(call.body).toBe('<urlset/>');
    expect(call.headers).toMatchObject({
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'x-upsert': 'true',
      'content-type': 'application/xml',
      'cache-control': 'max-age=3600',
    });
  });

  it('a non-2xx answer or a network error is a failure with the status only', async () => {
    const env = prodEnv();
    expect(await makeP5Ports(env, { fetch: recorder(() => json({ message: 'secret detail' }, 413)).fetch }).storage.upload('sitemap-complete.xml', 'x', { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: false, status: 413, message: 'storage upload: 413' });
    expect(await makeP5Ports(env, { fetch: recorder(() => Promise.reject(new Error('down'))).fetch }).storage.upload('sitemap-complete.xml', 'x', { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: false, status: 0, message: 'storage upload: network error' });
  });
});

describe('gmailSend', () => {
  const mime = new TextEncoder().encode('From: A <a@example.com>\r\nSubject: =?UTF-8?B?w4Q=?=\r\n\r\n<p>Hi ÿ</p>');

  it('POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send with {raw: base64url} and the bearer token', async () => {
    const rec = recorder(() => json({ id: '18c0ffee', threadId: 't' }));
    const token = ['ya29', 'test'].join('.');
    const result = await makeP5Ports(prodEnv(), { fetch: rec.fetch }).gmailSend.send(token, mime);
    expect(result).toEqual({ ok: true, id: '18c0ffee' });
    const call = rec.calls[0]!;
    expect(call.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(call.headers.authorization).toBe(`Bearer ${token}`);
    const raw = (JSON.parse(call.body) as { raw: string }).raw;
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, 'base64url')).toEqual(Buffer.from(mime));
  });

  it('T2: GMAIL_API_BASE (the Phase 4 base) replaces the Gmail base', async () => {
    const rec = recorder(() => json({ id: 'g1' }));
    await makeP5Ports(opsEnv({ GMAIL_API_BASE: 'http://127.0.0.1:9/gmail' }), { fetch: rec.fetch }).gmailSend.send('t', mime);
    expect(rec.calls[0]?.url).toBe('http://127.0.0.1:9/gmail/users/me/messages/send');
  });

  it('429, 5xx and network errors are retryable; other 4xx are not; an answer without id fails', async () => {
    const send = (answer: () => Response | Promise<Response>) => makeP5Ports(prodEnv(), { fetch: recorder(answer).fetch }).gmailSend.send('t', mime);
    expect(await send(() => json({}, 429))).toEqual({ ok: false, status: 429, retryable: true, message: 'gmail send: 429' });
    expect(await send(() => json({}, 503))).toMatchObject({ ok: false, status: 503, retryable: true });
    expect(await send(() => json({}, 400))).toMatchObject({ ok: false, status: 400, retryable: false });
    expect(await send(() => Promise.reject(new Error('reset')))).toEqual({ ok: false, status: 0, retryable: true, message: 'gmail send: network error' });
    expect(await send(() => json({}))).toMatchObject({ ok: false, retryable: false });
  });
});

describe('container', () => {
  it('production: getContainer(env.CAD_CONTAINER, slot).fetch(req) and .destroy()', async () => {
    const seen: string[] = [];
    const ns = {
      idFromName: (name: string) => ({ name }),
      get: (id: { name: string }) => ({
        fetch: async (req: Request) => {
          seen.push(`fetch ${id.name} ${req.method} ${new URL(req.url).pathname}`);
          return new Response('dxf', { status: 200 });
        },
        destroy: async () => void seen.push(`destroy ${id.name}`),
      }),
    } as unknown as OpsEnv['CAD_CONTAINER'];
    const p5 = makeP5Ports(prodEnv({ CAD_CONTAINER: ns }));
    const res = await p5.container.fetch('cad-1', new Request('http://cad/flat-pattern', { method: 'POST', body: '{}' }));
    expect(await res.text()).toBe('dxf');
    await p5.container.destroy('cad-1');
    expect(seen).toEqual(['fetch cad-1 POST /flat-pattern', 'destroy cad-1']);
  });

  it('production without the binding: ConfigMissingError', async () => {
    await expect(makeP5Ports(prodEnv()).container.fetch('cad-0', new Request('http://cad/health'))).rejects.toMatchObject({ code: 'config_missing' });
  });

  it('T2: CAD_CONTAINER_BASE_URL re-addresses the request (path, query, method, body) with the slot header; destroy is best effort', async () => {
    const rec = recorder((r) => (r.url.includes('/__stub/') ? Promise.reject(new Error('no stub')) : json({ ok: true })));
    const p5 = makeP5Ports(opsEnv({ CAD_CONTAINER_BASE_URL: 'http://127.0.0.1:9/cad-container/' }), { fetch: rec.fetch });
    await p5.container.fetch('cad-2', new Request('http://cad/flat-pattern?x=1', { method: 'POST', headers: { 'X-API-Key': 'k', 'content-type': 'application/json' }, body: '{"file_name":"a.step"}' }));
    expect(rec.calls[0]).toMatchObject({ url: 'http://127.0.0.1:9/cad-container/flat-pattern?x=1', method: 'POST', body: '{"file_name":"a.step"}' });
    expect(rec.calls[0]?.headers[CAD_SLOT_HEADER]).toBe('cad-2');
    expect(rec.calls[0]?.headers['x-api-key']).toBe('k');
    await expect(p5.container.destroy('cad-2')).resolves.toBeUndefined();
    expect(rec.calls[1]).toMatchObject({ url: 'http://127.0.0.1:9/cad-container/__stub/destroy?slot=cad-2', method: 'POST' });
  });
});

describe('telegramText', () => {
  const token = ['123456', 'TEST'].join(':');

  it('plain sendMessage: body {chat_id, text, disable_web_page_preview} in the live key order, no parse_mode', async () => {
    const rec = recorder(() => json({ ok: true, result: { message_id: 1 } }));
    const env = prodEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: '-100200' });
    const text = '\u{1F534} HIGH LEAD\n\nr/x · 5m ago · u/y';
    const result = await makeP5Ports(env, { fetch: rec.fetch }).telegramText.send(text, { disableWebPagePreview: true });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(rec.calls[0]?.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(rec.calls[0]?.body).toBe(JSON.stringify({ chat_id: '-100200', text, disable_web_page_preview: true }));
    expect(rec.calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('without the option the flag is not sent; T2 base override; Bot API errors answered, never thrown', async () => {
    const rec = recorder(() => json({ ok: false }, 400));
    const env = opsEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_API_BASE: 'http://127.0.0.1:9/telegram' });
    const result = await makeP5Ports(env, { fetch: rec.fetch }).telegramText.send('plain');
    expect(result).toEqual({ ok: false, status: 400 });
    expect(rec.calls[0]?.url).toBe(`http://127.0.0.1:9/telegram/bot${token}/sendMessage`);
    expect(JSON.parse(rec.calls[0]?.body ?? '{}')).toEqual({ chat_id: env.TELEGRAM_CHAT_ID, text: 'plain' });
  });

  it('network errors and missing configuration answer {ok: false, status: null}; missing configuration sends nothing', async () => {
    const failing = recorder(() => Promise.reject(new Error(`connect failed bot${token}`)));
    expect(await makeP5Ports(prodEnv({ TELEGRAM_BOT_TOKEN: token }), { fetch: failing.fetch }).telegramText.send('x')).toEqual({ ok: false, status: null });
    const none = recorder(() => json({ ok: true }));
    expect(await makeP5Ports(prodEnv({ TELEGRAM_BOT_TOKEN: '' }), { fetch: none.fetch }).telegramText.send('x')).toEqual({ ok: false, status: null });
    expect(none.calls).toEqual([]);
  });
});
