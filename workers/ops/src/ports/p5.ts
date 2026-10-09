// Phase 5 ports: every external effect of the consolidated jobs that the Phase 4 Ports (src/ports/index.ts) do not
// already cover. DB, Resend (mailer), Gmail access tokens (gmail.accessToken), the structured LLM, R2 (blob),
// Analytics Engine (events) and the clock come from makePorts(env); Phase 5 never re-implements them.
//
// Rules
//   - textLlm.anthropic: the Phase 4 gateway client anthropicFor(env, meta), one user message, no system prompt, no
//     thinking field, no fallbacks, maxRetries 0; per call the client timeout (timeoutMs) and, when given, the
//     gateway request timeout (header cf-aig-request-timeout = gatewayTimeoutMs). ok only for stop_reason end_turn
//     with a text block (text = the first text block); max_tokens -> code 'other', not retryable; refusal ->
//     'blocked'; any other stop or no text block -> 'empty'. Provider errors: 404 'not_found', 429 'rate_limited'
//     (retryable), 408 and client timeouts 'timeout' (retryable), 5xx and connection errors 'server' (retryable),
//     other 4xx 'other'.
//   - textLlm.gemini: POST <gateway google-ai-studio URL>/v1beta/models/<model>:generateContent (T2:
//     AGENT_GEMINI_BASE_URL instead of the gateway URL) with the Phase 4 gateway headers (gatewayHeaders(env, meta))
//     and content-type 'application/json; charset=utf-8'; body {contents: [{role: 'user', parts: [{text}]}],
//     generationConfig: {temperature, maxOutputTokens}} as the live translate-article. The provider key is stored
//     in the gateway, so no key header or query parameter is sent. ok when the first candidate has text (stop = its
//     finishReason, else 'UNKNOWN'; the caller judges MAX_TOKENS, as live); 404 'not_found', 429 'rate_limited',
//     5xx 'server' (status kept, so the caller can tell 500/503 from others), abort at timeoutMs 'timeout', no text
//     with a promptFeedback.blockReason or a withholding finishReason 'blocked', other empty answers 'empty',
//     anything else 'other'. The model of the result and
//     of the price is the answer's modelVersion when present (an alias such as gemini-flash-latest names its
//     target there), else the requested model.
//   - Usage: tokens of the answer priced with src/agents/prices.ts; a model without a price row costs 0 here
//     (closeRun then records price_missing when the run spent nothing priced).
//   - sources: global fetch with the production bases below; T2 points them at the stub through the *_API_BASE
//     vars.
//   - storage: POST {SUPABASE_URL}/storage/v1/object/sitemaps/<name> with the service role (authorization and
//     apikey), x-upsert 'true', content-type and cache-control 'max-age=<cacheControl>' (the header form storage-js
//     uses for a non-Blob body).
//   - gmailSend: POST <GMAIL_API_BASE, else https://gmail.googleapis.com/gmail/v1>/users/me/messages/send with
//     {raw: base64url(rawMime)} (the Phase 4 Gmail base, so T2 reaches the stub's /gmail/ prefix); 429, 5xx and
//     network errors are retryable, other 4xx are not.
//   - container: getContainer(env.CAD_CONTAINER, slot).fetch(req) and .destroy(); T2 (CAD_CONTAINER_BASE_URL): the
//     request is re-addressed to that base with header x-microns-cad-slot, and destroy() is a best-effort POST to
//     <base>/__stub/destroy?slot=<slot>.
//   - telegramText: POST <TELEGRAM_API_BASE, else https://api.telegram.org>/bot<token>/sendMessage with
//     {chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview} (the key order of the live collectors; the flag is
//     sent only when given) and no parse_mode; never throws (missing configuration and network errors answer
//     {ok: false, status: null}); the bot token never appears in a log line or an error text.
//   - Errors and log lines name the method and HTTP status only, never a URL with a token, a body or an address.
//   - Fail closed: makeP5Ports throws when a T2-only override var (P5_T2_ONLY_VARS) is set while env.AI is bound
//     (every production deploy binds AI).
//   - T1 tests build their fakes with makeTestP5Ports() from src/ports/p5-stub/.

import Anthropic from '@anthropic-ai/sdk';
import { getContainer } from '@cloudflare/containers';
import { isConfigMissing, need } from '../agents/config';
import { anthropicFor, gatewayHeaders } from '../agents/gateway';
import { llmCostUsd } from '../agents/prices';
import type { OpsEnv } from '../env';
import type { LlmUsage } from './index';

/** The five cf-aig-metadata keys of a text call. */
export interface TextLlmMeta {
  agent: string;
  run_id: string;
  tenant_id: string;
  step: string;
  prompt: string;
}

export type TextLlmResult =
  | { ok: true; text: string; stop: string; model: string; usage: LlmUsage }
  | {
      ok: false;
      status: number | null;
      code: 'not_found' | 'rate_limited' | 'server' | 'timeout' | 'blocked' | 'empty' | 'other';
      retryable: boolean;
      message: string;
    };

export interface TextLlmPort {
  anthropic(c: { model: string; maxTokens: number; userText: string; timeoutMs: number; gatewayTimeoutMs?: number; meta: TextLlmMeta }): Promise<TextLlmResult>;
  gemini(c: { model: string; prompt: string; temperature: number; maxOutputTokens: number; timeoutMs: number; meta: TextLlmMeta }): Promise<TextLlmResult>;
}

export type SourceName = 'pullpush' | 'hn' | 'xometry' | 'indexnow';

/** Production bases of the sources (T2 overrides: PULLPUSH_API_BASE, HN_API_BASE, XOMETRY_API_BASE, INDEXNOW_API_BASE). */
export const SOURCE_BASES: Readonly<Record<SourceName, string>> = Object.freeze({
  pullpush: 'https://api.pullpush.io',
  hn: 'https://hn.algolia.com/api/v1',
  xometry: 'https://api.xometry.eu',
  indexnow: 'https://www.bing.com',
});

export interface SourcePort {
  base(name: SourceName): string;
  fetch: typeof fetch;
}

export interface SitemapStoragePort {
  upload(
    name: 'sitemap-complete.xml',
    xml: string,
    o: { contentType: 'application/xml'; cacheControl: '3600' },
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }>;
}

export interface GmailSendPort {
  send(accessToken: string, rawMime: Uint8Array): Promise<{ ok: true; id: string } | { ok: false; status: number; retryable: boolean; message: string }>;
}

export interface ContainerPort {
  fetch(slot: string, req: Request): Promise<Response>;
  destroy(slot: string): Promise<void>;
}

/** Plain sendMessage, no parse_mode; never throws (the live jobs ignore Bot API errors). */
export interface TelegramTextPort {
  send(text: string, o?: { disableWebPagePreview?: boolean }): Promise<{ ok: boolean; status: number | null }>;
}

export interface P5Ports {
  textLlm: TextLlmPort;
  sources: SourcePort;
  storage: SitemapStoragePort;
  gmailSend: GmailSendPort;
  container: ContainerPort;
  telegramText: TelegramTextPort;
}

/** Var names that only generated T2 configs may set (Phase 5); never in the production wrangler.jsonc. */
export const P5_T2_ONLY_VARS = [
  'PULLPUSH_API_BASE',
  'HN_API_BASE',
  'XOMETRY_API_BASE',
  'INDEXNOW_API_BASE',
  'AGENT_GEMINI_BASE_URL',
  'CAD_CONTAINER_BASE_URL',
] as const satisfies ReadonlyArray<keyof OpsEnv>;

/** Default production endpoints of the HTTP adapters. */
export const GMAIL_SEND_BASE = 'https://gmail.googleapis.com/gmail/v1';
export const TELEGRAM_BASE = 'https://api.telegram.org';
/** Timeouts of the small HTTP adapters (the LLM calls take their own). */
const HTTP_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 60_000;

export interface MakeP5PortsOptions {
  /** fetch of the HTTP adapters (tests record requests with it); default the global fetch. */
  fetch?: typeof fetch;
}

/** T2-only override vars that are set (non-empty) in env. */
export function setOverrideVars(env: OpsEnv): string[] {
  return P5_T2_ONLY_VARS.filter((name) => typeof env[name] === 'string' && env[name] !== '');
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function count(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

function priced(model: string, counts: Omit<LlmUsage, 'cost_usd' | 'model'>): LlmUsage {
  return { ...counts, cost_usd: llmCostUsd(model, counts) ?? 0, model };
}

type TextLlmFailure = Extract<TextLlmResult, { ok: false }>;

function failure(code: TextLlmFailure['code'], status: number | null, retryable: boolean, message: string): TextLlmFailure {
  return { ok: false, status, code, retryable, message };
}

/** TextLlmResult of an HTTP status that is not 2xx. */
export function statusFailure(provider: string, status: number): TextLlmFailure {
  if (status === 404) return failure('not_found', status, false, `${provider}: not found (404)`);
  if (status === 429) return failure('rate_limited', status, true, `${provider}: rate limited (429)`);
  if (status === 408) return failure('timeout', status, true, `${provider}: timeout (408)`);
  if (status >= 500) return failure('server', status, true, `${provider}: server error (${status})`);
  return failure('other', status, false, `${provider}: refused (${status})`);
}

/** TextLlmResult of a thrown Anthropic SDK error, or null when the error is not a provider error. */
export function anthropicFailure(e: unknown): TextLlmFailure | null {
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return failure('timeout', null, true, 'anthropic: timeout');
  if (e instanceof Anthropic.APIConnectionError) return failure('server', null, true, 'anthropic: connection error');
  if (e instanceof Anthropic.APIError) return typeof e.status === 'number' ? statusFailure('anthropic', e.status) : failure('server', null, true, 'anthropic: provider error');
  return null;
}

/** finishReason values of a candidate withheld by the provider. */
const GEMINI_BLOCK_REASONS: ReadonlySet<string> = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

class GatewayTextLlm implements TextLlmPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly fetchImpl: typeof fetch | undefined,
  ) {}

  async anthropic(c: Parameters<TextLlmPort['anthropic']>[0]): Promise<TextLlmResult> {
    const client = await anthropicFor(this.env, c.meta, this.fetchImpl ? { fetch: this.fetchImpl } : {});
    let message: Anthropic.Message;
    try {
      message = await client.messages.create(
        { model: c.model, max_tokens: c.maxTokens, messages: [{ role: 'user', content: c.userText }] },
        { timeout: c.timeoutMs, ...(c.gatewayTimeoutMs !== undefined ? { headers: { 'cf-aig-request-timeout': String(c.gatewayTimeoutMs) } } : {}) },
      );
    } catch (e) {
      const mapped = anthropicFailure(e);
      if (mapped) return mapped;
      throw e;
    }
    const model = typeof message.model === 'string' && message.model !== '' ? message.model : c.model;
    const u = (message.usage ?? {}) as unknown as Record<string, unknown>;
    const usage = priced(model, {
      input_tokens: count(u.input_tokens),
      output_tokens: count(u.output_tokens),
      cache_read_input_tokens: count(u.cache_read_input_tokens),
      cache_creation_input_tokens: count(u.cache_creation_input_tokens),
    });
    const stop = String(message.stop_reason ?? '');
    if (stop === 'max_tokens') return failure('other', 200, false, 'anthropic: stopped at max_tokens');
    if (stop === 'refusal') return failure('blocked', 200, false, 'anthropic: refusal');
    const block = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (stop !== 'end_turn' || !block) return failure('empty', 200, false, `anthropic: no text (stop ${stop || 'none'})`);
    return { ok: true, text: block.text, stop, model, usage };
  }

  private async geminiBase(): Promise<string> {
    if (this.env.AGENT_GEMINI_BASE_URL) return trimBase(this.env.AGENT_GEMINI_BASE_URL);
    need(this.env, 'AI', 'AI_GATEWAY_ID');
    return trimBase(await this.env.AI.gateway(this.env.AI_GATEWAY_ID).getUrl('google-ai-studio'));
  }

  async gemini(c: Parameters<TextLlmPort['gemini']>[0]): Promise<TextLlmResult> {
    const headers = { ...gatewayHeaders(this.env, c.meta), 'content-type': 'application/json; charset=utf-8' };
    const url = `${await this.geminiBase()}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: c.prompt }] }],
      generationConfig: { temperature: c.temperature, maxOutputTokens: c.maxOutputTokens },
    });
    const fetchImpl = this.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    let response: Response;
    let data: Record<string, unknown>;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(c.timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return statusFailure('gemini', response.status);
      }
      data = (await response.json()) as Record<string, unknown>;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') return failure('timeout', null, true, `gemini: timeout (${Math.round(c.timeoutMs / 1000)} s)`);
      if (e instanceof SyntaxError) return failure('other', 200, false, 'gemini: answer is not JSON');
      return failure('server', null, true, 'gemini: network error');
    }
    const model = typeof data.modelVersion === 'string' && data.modelVersion !== '' ? data.modelVersion : c.model;
    const meta = (data.usageMetadata ?? {}) as Record<string, unknown>;
    const usage = priced(model, {
      input_tokens: count(meta.promptTokenCount),
      // Thinking tokens are billed as output.
      output_tokens: count(meta.candidatesTokenCount) + count(meta.thoughtsTokenCount),
      cache_read_input_tokens: count(meta.cachedContentTokenCount),
      cache_creation_input_tokens: 0,
    });
    if (data.error) return failure('other', 200, false, 'gemini: error in answer');
    const candidates = Array.isArray(data.candidates) ? (data.candidates as Array<Record<string, unknown>>) : [];
    const first = candidates[0];
    const parts = ((first?.content as { parts?: unknown } | undefined)?.parts ?? []) as Array<{ text?: unknown }>;
    const text = parts[0]?.text;
    if (typeof text !== 'string' || text === '') {
      const blocked = (data.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason || GEMINI_BLOCK_REASONS.has(String(first?.finishReason ?? ''));
      return blocked ? failure('blocked', 200, false, 'gemini: blocked') : failure('empty', 200, false, 'gemini: empty answer');
    }
    const stop = typeof first?.finishReason === 'string' && first.finishReason !== '' ? first.finishReason : 'UNKNOWN';
    return { ok: true, text, stop, model, usage };
  }
}

class HttpSources implements SourcePort {
  readonly fetch: typeof fetch;

  constructor(
    private readonly env: OpsEnv,
    fetchImpl: typeof fetch | undefined,
  ) {
    this.fetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  }

  base(name: SourceName): string {
    const override = { pullpush: this.env.PULLPUSH_API_BASE, hn: this.env.HN_API_BASE, xometry: this.env.XOMETRY_API_BASE, indexnow: this.env.INDEXNOW_API_BASE }[name];
    return trimBase(override || SOURCE_BASES[name]);
  }
}

class SupabaseSitemapStorage implements SitemapStoragePort {
  constructor(
    private readonly env: OpsEnv,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async upload(name: 'sitemap-complete.xml', xml: string, o: { contentType: 'application/xml'; cacheControl: '3600' }): ReturnType<SitemapStoragePort['upload']> {
    need(this.env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
    const url = `${trimBase(this.env.SUPABASE_URL)}/storage/v1/object/sitemaps/${encodeURIComponent(name)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
          'x-upsert': 'true',
          'content-type': o.contentType,
          'cache-control': `max-age=${o.cacheControl}`,
        },
        body: xml,
        signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 0, message: 'storage upload: network error' };
    }
    await response.body?.cancel().catch(() => {});
    return response.ok ? { ok: true } : { ok: false, status: response.status, message: `storage upload: ${response.status}` };
  }
}

/** RFC 4648 base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class GmailSend implements GmailSendPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(accessToken: string, rawMime: Uint8Array): ReturnType<GmailSendPort['send']> {
    const url = `${trimBase(this.env.GMAIL_API_BASE || GMAIL_SEND_BASE)}/users/me/messages/send`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: base64Url(rawMime) }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 0, retryable: true, message: 'gmail send: network error' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status, retryable: response.status === 429 || response.status >= 500, message: `gmail send: ${response.status}` };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: unknown };
    if (typeof data.id !== 'string' || data.id === '') return { ok: false, status: response.status, retryable: false, message: 'gmail send: answer without id' };
    return { ok: true, id: data.id };
  }
}

/** Header that names the slot of a re-addressed T2 container request. */
export const CAD_SLOT_HEADER = 'x-microns-cad-slot';

class CadContainerPort implements ContainerPort {
  constructor(private readonly env: OpsEnv) {}

  async fetch(slot: string, req: Request): Promise<Response> {
    need(this.env, 'CAD_CONTAINER');
    return getContainer(this.env.CAD_CONTAINER, slot).fetch(req);
  }

  async destroy(slot: string): Promise<void> {
    need(this.env, 'CAD_CONTAINER');
    await getContainer(this.env.CAD_CONTAINER, slot).destroy();
  }
}

class StubContainerPort implements ContainerPort {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async fetch(slot: string, req: Request): Promise<Response> {
    const original = new URL(req.url);
    const target = `${this.base}${original.pathname}${original.search}`;
    const headers = new Headers(req.headers);
    headers.set(CAD_SLOT_HEADER, slot);
    const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers, redirect: 'manual', signal: req.signal };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body;
      init.duplex = 'half';
    }
    return this.fetchImpl(target, init);
  }

  async destroy(slot: string): Promise<void> {
    try {
      const response = await this.fetchImpl(`${this.base}/__stub/destroy?slot=${encodeURIComponent(slot)}`, { method: 'POST', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      await response.body?.cancel().catch(() => {});
    } catch {
      // best effort in T2
    }
  }
}

class BotTelegramText implements TelegramTextPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(text: string, o?: { disableWebPagePreview?: boolean }): Promise<{ ok: boolean; status: number | null }> {
    try {
      need(this.env, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID');
    } catch (e) {
      if (isConfigMissing(e)) return { ok: false, status: null };
      throw e;
    }
    const base = trimBase(this.env.TELEGRAM_API_BASE || TELEGRAM_BASE);
    const body: Record<string, unknown> = { chat_id: this.env.TELEGRAM_CHAT_ID, text };
    if (o?.disableWebPagePreview !== undefined) body.disable_web_page_preview = o.disableWebPagePreview;
    try {
      const response = await this.fetchImpl(`${base}/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => {});
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: null };
    }
  }
}

/** The production adapters, or the T2 base-URL overrides (see the rules above). */
export function makeP5Ports(env: OpsEnv, o: MakeP5PortsOptions = {}): P5Ports {
  const overrides = setOverrideVars(env);
  if (overrides.length > 0 && env.AI) {
    throw new Error(`T2-only override vars are set while AI is bound: ${overrides.join(', ')}`);
  }
  const fetchImpl = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    textLlm: new GatewayTextLlm(env, o.fetch),
    sources: new HttpSources(env, o.fetch),
    storage: new SupabaseSitemapStorage(env, fetchImpl),
    gmailSend: new GmailSend(env, fetchImpl),
    container: env.CAD_CONTAINER_BASE_URL ? new StubContainerPort(trimBase(env.CAD_CONTAINER_BASE_URL), fetchImpl) : new CadContainerPort(env),
    telegramText: new BotTelegramText(env, fetchImpl),
  };
}
