// T1 fakes of the Phase 5 ports (src/ports/p5.ts), for vitest only: nothing in the production code imports this
// folder, so it never reaches the bundle (scripts/check-bundle.mjs).
//
//   FakeTextLlm            textLlm: answers from fixtures keyed by meta.prompt and the SHA-256 of the input text
//                          (userText for anthropic, prompt for gemini), or from a script; records every call
//   ScriptedSources        sources: base(name) = 'https://<name>.test'; fetch answers from scripted routes and
//                          records every request; an unscripted request answers 599
//   StorageRecorder        storage: records every upload (name, bytes, options); answers ok unless scripted
//   GmailSendRecorder      gmailSend: records every send; answers {ok: true, id: 'gmail-<n>'} unless scripted
//   ScriptedContainer      container: answers from a script; records requests per slot and destroyed slots
//   TelegramTextRecorder   telegramText: records every text byte for byte; answers {ok: true, status: 200}
//
//   okText / failText      builders of TextLlmResult values for fixtures and scripts
//   P5MemoryDb             MemoryDb with the Phase 5 tables' unique keys and the article-queue RPCs
//                          (memory-rpc-p5.ts, shared with the T2 mini-PostgREST)
//
// The Phase 4 half of the test ports is agentPorts() of test/helpers/agent-env.ts (FakeLlm, MemoryDb, recorders),
// re-exported here as makeTestPorts().

import type {
  ContainerPort,
  GmailSendPort,
  P5Ports,
  SitemapStoragePort,
  SourceName,
  SourcePort,
  TelegramTextPort,
  TextLlmMeta,
  TextLlmPort,
  TextLlmResult,
} from '../p5';
import type { LlmUsage } from '../index';
import { DbError, type InsertOptions, type Row } from '../../db/postgrest';
import { MemoryDb, type MemoryDbOptions, type MemoryRpc } from '../../../test/helpers/memory-db';
import { isP5Table, P5_MEMORY_RPCS, P5ConflictTargetError, P5UniqueViolation, p5WriteRow, type P5MemoryTables } from './memory-rpc-p5';

export { P5_MEMORY_RPCS, P5_UNIQUE_KEYS, p5WriteRow } from './memory-rpc-p5';

export interface TextLlmCall {
  provider: 'anthropic' | 'gemini';
  model: string;
  meta: TextLlmMeta;
  /** userText (anthropic) or prompt (gemini). */
  input: string;
  /** Lower-case hex SHA-256 of input. */
  inputSha256: string;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  /** anthropic only: the gateway request timeout, when given. */
  gatewayTimeoutMs?: number;
}

export type TextLlmScript = (call: TextLlmCall) => TextLlmResult | Promise<TextLlmResult>;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let out = '';
  for (const b of digest) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A successful text result (usage zero unless given; cost 0). */
export function okText(text: string, o: { model?: string; stop?: string; usage?: Partial<LlmUsage> } = {}): TextLlmResult {
  const model = o.model ?? 'fake-model';
  return {
    ok: true,
    text,
    stop: o.stop ?? 'end_turn',
    model,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0, model, ...o.usage },
  };
}

/** A failed text result; usage only when given (the failure of an answered call). */
export function failText(
  code: Extract<TextLlmResult, { ok: false }>['code'],
  o: { status?: number | null; retryable?: boolean; message?: string; usage?: LlmUsage } = {},
): TextLlmResult {
  const result: TextLlmResult = { ok: false, status: o.status ?? null, code, retryable: o.retryable ?? (code === 'rate_limited' || code === 'server' || code === 'timeout'), message: o.message ?? `fake ${code}` };
  return o.usage ? { ...result, usage: { ...o.usage } } : result;
}

export class FakeTextLlm implements TextLlmPort {
  readonly calls: TextLlmCall[] = [];
  private readonly fixtures = new Map<string, TextLlmResult>();
  private script?: TextLlmScript;

  /** fixtures: '<meta.prompt>:<inputSha256>' -> result; script: answers every call not found in fixtures. */
  constructor(o: { fixtures?: Record<string, TextLlmResult>; script?: TextLlmScript } = {}) {
    for (const [key, result] of Object.entries(o.fixtures ?? {})) this.fixtures.set(key, result);
    this.script = o.script;
  }

  /** The fixture key of a call: '<prompt>:<SHA-256 hex of input>'. */
  static async fixtureKey(prompt: string, input: string): Promise<string> {
    return `${prompt}:${await sha256Hex(input)}`;
  }

  /** Registers the answer for (prompt, input). */
  async add(prompt: string, input: string, result: TextLlmResult): Promise<void> {
    this.fixtures.set(await FakeTextLlm.fixtureKey(prompt, input), result);
  }

  /** Replaces the script (answers every call without a fixture). */
  setScript(script: TextLlmScript | undefined): void {
    this.script = script;
  }

  private async answer(call: Omit<TextLlmCall, 'inputSha256'>): Promise<TextLlmResult> {
    const inputSha256 = await sha256Hex(call.input);
    const recorded: TextLlmCall = { ...call, meta: { ...call.meta }, inputSha256 };
    this.calls.push(recorded);
    const fixture = this.fixtures.get(`${call.meta.prompt}:${inputSha256}`);
    if (fixture) return structuredClone(fixture);
    if (this.script) return this.script(recorded);
    return failText('other', { retryable: false, message: `no fixture for ${call.meta.prompt} ${inputSha256.slice(0, 16)}` });
  }

  anthropic(c: Parameters<TextLlmPort['anthropic']>[0]): Promise<TextLlmResult> {
    return this.answer({
      provider: 'anthropic',
      model: c.model,
      meta: c.meta,
      input: c.userText,
      maxTokens: c.maxTokens,
      timeoutMs: c.timeoutMs,
      ...(c.gatewayTimeoutMs !== undefined ? { gatewayTimeoutMs: c.gatewayTimeoutMs } : {}),
    });
  }

  gemini(c: Parameters<TextLlmPort['gemini']>[0]): Promise<TextLlmResult> {
    return this.answer({ provider: 'gemini', model: c.model, meta: c.meta, input: c.prompt, maxTokens: c.maxOutputTokens, timeoutMs: c.timeoutMs, temperature: c.temperature });
  }
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export type SourceRoute = {
  method?: string;
  /** A string matches the full URL or its prefix; a RegExp is tested against the full URL. */
  match: string | RegExp;
  respond: Response | ((req: Request) => Response | Promise<Response>);
};

async function record(req: Request): Promise<RecordedRequest> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.clone().text();
  return { method: req.method, url: req.url, headers, body };
}

function routeMatches(route: SourceRoute, req: Request): boolean {
  if (route.method && route.method.toUpperCase() !== req.method) return false;
  return typeof route.match === 'string' ? req.url === route.match || req.url.startsWith(route.match) : route.match.test(req.url);
}

/** Status of an answer to a request no test scripted. */
export const UNSCRIPTED_STATUS = 599;

export class ScriptedSources implements SourcePort {
  readonly requests: RecordedRequest[] = [];
  readonly fetch: typeof fetch;
  private readonly routes: SourceRoute[];
  private readonly bases: Partial<Record<SourceName, string>>;

  constructor(o: { routes?: SourceRoute[]; bases?: Partial<Record<SourceName, string>> } = {}) {
    this.routes = [...(o.routes ?? [])];
    this.bases = { ...o.bases };
    this.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      this.requests.push(await record(req));
      const route = this.routes.find((r) => routeMatches(r, req));
      if (!route) return new Response(`unscripted request ${req.method} ${req.url}`, { status: UNSCRIPTED_STATUS });
      return typeof route.respond === 'function' ? route.respond(req) : route.respond.clone();
    }) as typeof fetch;
  }

  base(name: SourceName): string {
    return this.bases[name] ?? `https://${name}.test`;
  }

  /** Adds a route (checked before the earlier ones). */
  route(r: SourceRoute): this {
    this.routes.unshift(r);
    return this;
  }
}

export interface StorageUpload {
  name: 'sitemap-complete.xml';
  xml: string;
  contentType: string;
  cacheControl: string;
}

export class StorageRecorder implements SitemapStoragePort {
  readonly uploads: StorageUpload[] = [];
  /** When set, every upload answers this failure (and is still recorded). */
  failWith: { status: number; message: string } | null = null;

  async upload(name: 'sitemap-complete.xml', xml: string, o: { contentType: 'application/xml'; cacheControl: '3600' }): ReturnType<SitemapStoragePort['upload']> {
    this.uploads.push({ name, xml, contentType: o.contentType, cacheControl: o.cacheControl });
    return this.failWith ? { ok: false, ...this.failWith } : { ok: true };
  }
}

export class GmailSendRecorder implements GmailSendPort {
  readonly sent: Array<{ accessToken: string; rawMime: Uint8Array }> = [];
  /** Answers each send in order; when empty, {ok: true, id: 'gmail-<n>'}. */
  readonly script: Array<Awaited<ReturnType<GmailSendPort['send']>>> = [];

  async send(accessToken: string, rawMime: Uint8Array): ReturnType<GmailSendPort['send']> {
    this.sent.push({ accessToken, rawMime: rawMime.slice() });
    return this.script.shift() ?? { ok: true, id: `gmail-${this.sent.length}` };
  }

  /** The raw MIME of the n-th send (0-based) as text. */
  mimeText(n: number): string {
    const item = this.sent[n];
    return item ? new TextDecoder().decode(item.rawMime) : '';
  }
}

export type ContainerScript = (slot: string, req: Request) => Response | Promise<Response>;

export class ScriptedContainer implements ContainerPort {
  readonly requests: Array<{ slot: string } & RecordedRequest> = [];
  readonly destroyed: string[] = [];
  private script?: ContainerScript;

  /** Without a script every request answers 599 (unscripted). */
  constructor(script?: ContainerScript) {
    this.script = script;
  }

  /** Replaces the script. */
  setScript(script: ContainerScript | undefined): void {
    this.script = script;
  }

  async fetch(slot: string, req: Request): Promise<Response> {
    this.requests.push({ slot, ...(await record(req)) });
    if (!this.script) return new Response('unscripted container request', { status: UNSCRIPTED_STATUS });
    return this.script(slot, req);
  }

  async destroy(slot: string): Promise<void> {
    this.destroyed.push(slot);
  }
}

export class TelegramTextRecorder implements TelegramTextPort {
  readonly messages: Array<{ text: string; disableWebPagePreview?: boolean }> = [];
  /** Answer of every send (default {ok: true, status: 200}). */
  answer: { ok: boolean; status: number | null } = { ok: true, status: 200 };

  async send(text: string, o?: { disableWebPagePreview?: boolean }): Promise<{ ok: boolean; status: number | null }> {
    this.messages.push(o?.disableWebPagePreview !== undefined ? { text, disableWebPagePreview: o.disableWebPagePreview } : { text });
    return { ...this.answer };
  }

  /** The recorded texts in order. */
  texts(): string[] {
    return this.messages.map((m) => m.text);
  }
}

export interface TestP5Ports extends P5Ports {
  textLlm: FakeTextLlm;
  sources: ScriptedSources;
  storage: StorageRecorder;
  gmailSend: GmailSendRecorder;
  container: ScriptedContainer;
  telegramText: TelegramTextRecorder;
}

/** A full set of Phase 5 fakes; a test replaces or scripts the ones it needs. */
export function makeTestP5Ports(o: Partial<TestP5Ports> = {}): TestP5Ports {
  return {
    textLlm: o.textLlm ?? new FakeTextLlm(),
    sources: o.sources ?? new ScriptedSources(),
    storage: o.storage ?? new StorageRecorder(),
    gmailSend: o.gmailSend ?? new GmailSendRecorder(),
    container: o.container ?? new ScriptedContainer(),
    telegramText: o.telegramText ?? new TelegramTextRecorder(),
  };
}

/** The Phase 4 test ports (FakeLlm, MemoryDb, recorders; test/helpers/agent-env.ts agentPorts), under the name the
 *  Phase 5 spec uses. */
export { agentPorts as makeTestPorts } from '../../../test/helpers/agent-env';

// ----- MemoryDb with the Phase 5 tables and RPCs -----

/**
 * MemoryDb (test/helpers/memory-db.ts) plus the Phase 5 business tables: inserts and upserts into a table of
 * P5_UNIQUE_KEYS enforce its unique keys (23505, ignore- and merge-duplicates on those keys, 42P10 for another
 * target) and fill the live time defaults; the article-queue RPCs of P5_MEMORY_RPCS are registered. Every other
 * table and RPC behaves exactly as MemoryDb.
 */
export class P5MemoryDb extends MemoryDb {
  private readonly p5Clock: () => Date;

  constructor(o: MemoryDbOptions = {}) {
    super({ ...o, rpc: { ...(P5_MEMORY_RPCS as Record<string, MemoryRpc>), ...o.rpc } });
    this.p5Clock = o.clock ?? (() => new Date());
  }

  override async insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o: InsertOptions = {}): Promise<T[]> {
    if (!isP5Table(table)) return super.insert<T>(table, rows, o);
    const list = Array.isArray(rows) ? (rows as readonly Row[]) : [rows as Row];
    this.calls.push({ method: 'insert', target: table });
    const now = this.p5Clock();
    const tables = this.tables as P5MemoryTables;
    const before = structuredClone(tables[table] ?? []);
    const written: Row[] = [];
    try {
      for (const row of list) {
        const r = p5WriteRow(tables, table, row, now, { onConflict: o.onConflict, merge: o.ignoreDuplicates === false });
        if (r) written.push(r);
      }
    } catch (e) {
      tables[table] = before; // one statement: all or nothing
      if (e instanceof P5UniqueViolation || e instanceof P5ConflictTargetError) throw new DbError(e.status, e.code, `memory ${e.code}: ${e.message}`);
      throw e;
    }
    if (o.returning === undefined || o.returning === false) return [];
    const cols = typeof o.returning === 'string' ? o.returning : '*';
    return written.map((r) => {
      const copy = structuredClone(r);
      if (cols.trim() === '*') return copy as T;
      const out: Row = {};
      for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = copy[c] ?? null;
      return out as T;
    });
  }
}
