// Ports of the agent layer: every external effect (LLM, embeddings, Vectorize, CAD backend, browser, Resend,
// Telegram, Gmail, Supabase, R2, Analytics Engine, clock) sits behind one of these interfaces, with a production
// adapter, a T1 fake (test/helpers) and a T2 stub path.
//
// Rules
//   - makePorts(env) builds the production adapters unless the var AGENT_STUBS (generated T2 configs only) names a
//     port: tokens 'llm', 'embed', 'vector', 'cad', 'browser'. It throws when AGENT_STUBS is set while AI or
//     QUOTES_INDEX is bound (every production deploy binds both), so a production Worker is never half-stubbed.
//   - Resend, Telegram, Gmail and the Google token endpoint are stubbed only as HTTP endpoints of the T2 stub server
//     (RESEND_API_BASE, TELEGRAM_API_BASE, GMAIL_API_BASE, GOOGLE_TOKEN_URL); production uses the real base URLs.
//   - No adapter logs a request or response body, a token or an e-mail address.
//   - An unknown AGENT_STUBS token is refused (a typo never silently selects a production adapter).
//   - Adapters that belong to other modules are built on first use: the cad registry (src/cad/registry.ts), the
//     Resend mailer (src/mail-out/resend.ts) and the browser port, so a run that never needs them never depends on
//     their configuration.
// Adapter files: llm.ts (Anthropic through the AI Gateway), embed-vector.ts (Workers AI, Vectorize and the stub
// index), http-adapters.ts (Telegram, Gmail, R2, Analytics Engine).

import type { CardV1 } from '../agents/cards/index';
import type { AgentEventPoint } from '../agents/events';
import { stubTokens } from '../agents/gateway';
import type { PromptId } from '../agents/prompts/registry';
import { makeCadRegistry } from '../cad/registry';
import type { CadBackendRegistry } from '../cad/types';
import { PostgrestDb, type Db } from '../db/postgrest';
import type { OpsEnv } from '../env';
import { resendMailer } from '../mail-out/resend';
import { HashEmbed, MemoryVectorIndex, R2PersistedVectors, VectorizeVectors, WorkersAiEmbed } from './embed-vector';
import { AnalyticsEvents, BotTelegram, GmailApi, R2Blob } from './http-adapters';
import { AnthropicLlm } from './llm';

export type { Db } from '../db/postgrest';

// ----- LLM (structured output through the AI Gateway) -----

/** JSON Schema of a structured output: additionalProperties false on every object, every property required. */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
  [keyword: string]: unknown;
}

/** cf-aig-metadata without the prompt id (the call adds it from `prompt`). */
export interface LlmMeta {
  agent: string;
  run_id: string;
  tenant_id: string;
  step: string;
}

export interface LlmCall<S = unknown> {
  /** e.g. 'rfq_intake.extract@v1'. */
  prompt: PromptId;
  route: 'extract' | 'classify';
  /** Frozen prompt text from the prompt file. */
  system: string;
  /** Delimited untrusted data plus documents and images. */
  user: LlmContent[];
  schema: JsonSchemaObject;
  maxTokens: number;
  meta: LlmMeta;
}

export type LlmContent =
  | { type: 'text'; text: string }
  /** At most 5 pages after trimming. */
  | { type: 'pdf'; base64: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; base64: string };

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  model: string;
}

export interface LlmResult<T> {
  ok: true;
  value: T;
  usage: LlmUsage;
  model: string;
  stop: 'end_turn';
  /** cf-aig-log-id response header when present. */
  logId?: string;
}

export interface LlmFailure {
  ok: false;
  code: 'refusal' | 'max_tokens' | 'schema' | 'provider_4xx' | 'provider_5xx' | 'timeout' | 'budget';
  retryable: boolean;
  usage?: LlmUsage;
  message: string;
}

export interface LlmPort {
  call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure>;
}

// ----- Embeddings and vectors -----

export interface EmbedUsage {
  input_tokens: number;
  cost_usd: number;
}

/** 1,024-dimension vectors (bge-m3). */
export interface EmbedPort {
  embed(texts: string[], meta: LlmMeta): Promise<{ vectors: number[][]; usage: EmbedUsage }>;
}

/** Metadata of one quote-line vector (index quotes-v1, namespace = tenant id, id '<quote_workflow_id>:<line_no>'). */
export interface QuoteVectorMeta {
  quote_workflow_id: string;
  rfq_id: string;
  line_no: number;
  process: 'sheet_metal' | 'cnc' | 'mixed' | 'other';
  material_family: string;
  material_grade: string;
  thickness_mm: number;
  qty: number;
  unit_price_eur: number;
  line_total_eur: number;
  outcome: 'open' | 'won' | 'lost' | 'counter_offer' | 'expired';
  sent_at_unix: number;
  rules_version: string;
}

export interface VectorPort {
  upsert(ns: string, items: Array<{ id: string; values: number[]; metadata: QuoteVectorMeta }>): Promise<void>;
  /** filter operators: $eq, $in, $gte, $lte. */
  query(ns: string, values: number[], o: { topK: number; filter?: Record<string, unknown> }): Promise<Array<{ id: string; score: number; metadata: QuoteVectorMeta }>>;
}

// ----- Mail (Resend) -----

export interface OutboundMail {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  text: string;
  html?: string;
  /** e.g. Message-ID, In-Reply-To, References. */
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content_base64: string; content_type?: string }>;
  tags?: Array<{ name: string; value: string }>;
  /** Resend Idempotency-Key (at most 256 characters, kept 24 h). */
  idempotency_key: string;
}

export interface MailerPort {
  send(m: OutboundMail): Promise<{ ok: true; provider_id: string } | { ok: false; status: number; retryable: boolean; message: string }>;
  /** GET /emails/{id} -> message_id. */
  fetchMessageId(providerId: string): Promise<string | null>;
}

// ----- Telegram (Bot API) -----

export interface TelegramPort {
  /** Sends a card; with a token the allowed verbs that have a code get callback buttons. */
  sendCard(c: CardV1, token?: string | null): Promise<{ message_id: number }>;
  /** Replaces a card's text and buttons (a decided card keeps the URL button only). */
  editCard(messageId: number, c: CardV1 | { text: string }): Promise<void>;
  /** A plain notice without buttons (e.g. the daily-cap notice). */
  sendText(text: string): Promise<{ message_id: number }>;
}

// ----- Gmail (read-only scope) -----

/** Fields of a marketing_sender_accounts row the poller uses. */
export interface SenderAccountRow {
  id: string;
  email: string;
  provider: string;
  is_active: boolean;
  provider_config: GmailProviderConfig | null;
}

export interface GmailProviderConfig {
  access_token?: string;
  refresh_token?: string;
  token_expiry?: string;
  [key: string]: unknown;
}

export interface GmailHeaders {
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from: string | null;
  subject: string | null;
  auto_submitted: string | null;
  /** Gmail's sizeEstimate of the whole message in bytes (null when the answer carries no usable number), so a
   *  caller can pass over a large message before reading it in full. */
  size_estimate?: number | null;
}

export interface GmailPort {
  /** Stored access token when valid for at least 5 more minutes, else a refresh in memory (never written back).
   *  rotated: true when the refresh answer carried a refresh token other than the stored one; that value is never
   *  returned, stored or logged (the caller recommends a reconnect instead). */
  accessToken(account: SenderAccountRow): Promise<{ token: string; rotated?: boolean } | { error: 'invalid_grant' | 'unavailable' }>;
  /** Ids of the messages added to INBOX after startHistoryId, over at most HISTORY_MAX_PAGES pages. historyId is the
   *  mailbox's current history id when every page was read; when the page cap stopped the listing (truncated: true)
   *  it is the id of the last history record read, so a listing started from it skips nothing. */
  history(token: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string; truncated?: boolean } | { error: 'stale_history' | 'unavailable' }>;
  listRecent(token: string, query: string, max: number): Promise<{ messageIds: string[] }>;
  profileHistoryId(token: string): Promise<string>;
  metadata(token: string, id: string): Promise<GmailHeaders>;
  raw(token: string, id: string): Promise<Uint8Array>;
}

// ----- R2 (microns-private) -----

export interface BlobPort {
  put(key: string, body: ArrayBuffer | ReadableStream, o: { contentType: string; sha256?: string; meta?: Record<string, string> }): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; size: number; contentType?: string } | null>;
  /** R2 get with {range: {offset, length}}; null when the object is missing. */
  getRange(key: string, offset: number, length: number): Promise<ReadableStream | null>;
  /** get + put (objects up to 25 MiB). */
  copy(from: string, to: string): Promise<void>;
  head(key: string): Promise<{ size: number; sha256?: string } | null>;
}

// ----- Analytics Engine, clock, browser -----

export interface EventsPort {
  point(p: AgentEventPoint): void;
}

export interface ClockPort {
  now(): Date;
}

export interface BrowserPort {
  render(url: string, o: { timeoutMs: number; userAgent: string }): Promise<{ status: number; html: string }>;
}

export interface Ports {
  llm: LlmPort;
  embed: EmbedPort;
  vector: VectorPort;
  cad: CadBackendRegistry;
  mailer: MailerPort;
  telegram: TelegramPort;
  gmail: GmailPort;
  db: Db;
  blob: BlobPort;
  events: EventsPort;
  clock: ClockPort;
  browser: BrowserPort;
}

/** Tokens of the AGENT_STUBS var (comma list). */
export type StubToken = 'llm' | 'embed' | 'vector' | 'cad' | 'browser';

export const STUB_TOKENS: readonly StubToken[] = ['llm', 'embed', 'vector', 'cad', 'browser'];

export const systemClock: ClockPort = { now: () => new Date() };

/** Overrides for tests and for adapters that other modules provide. */
export interface MakePortsOptions {
  /** fetch of the HTTP adapters (LLM, Telegram, Gmail, PostgREST, Resend). */
  fetch?: typeof fetch;
  /** The browser port (default: one that refuses until a browser module is wired). */
  browser?: BrowserPort;
}

/** The parsed AGENT_STUBS tokens; throws on an unknown token. */
export function parseStubTokens(env: Pick<OpsEnv, 'AGENT_STUBS'>): Set<StubToken> {
  const tokens = stubTokens(env);
  for (const token of tokens) if (!(STUB_TOKENS as readonly string[]).includes(token)) throw new Error(`unknown AGENT_STUBS token: ${token}`);
  return tokens as Set<StubToken>;
}

/** A MailerPort whose adapter is built on the first call. */
function lazyMailer(build: () => MailerPort): MailerPort {
  let mailer: MailerPort | undefined;
  const get = () => (mailer ??= build());
  return {
    send: (m) => get().send(m),
    fetchMessageId: (id) => get().fetchMessageId(id),
  };
}

const UNWIRED_BROWSER: BrowserPort = {
  render: async () => {
    throw new Error('browser port is not available in this context');
  },
};

/** The production adapters, or the stub adapters named by AGENT_STUBS (see the rules above). */
export function makePorts(env: OpsEnv, o: MakePortsOptions = {}): Ports {
  const stubs = parseStubTokens(env);
  if (stubs.size > 0 && (env.AI || env.QUOTES_INDEX)) {
    throw new Error('AGENT_STUBS is set while AI or QUOTES_INDEX is bound: stub adapters are for generated test configs only');
  }
  const fetchImpl = o.fetch;
  const events = new AnalyticsEvents(env.EVENTS);
  const clock = systemClock;
  let cad: CadBackendRegistry | undefined;
  return {
    llm: new AnthropicLlm(env, { events, clock, fetch: fetchImpl }),
    embed: stubs.has('embed') ? new HashEmbed() : new WorkersAiEmbed(env, events),
    vector: stubs.has('vector') ? (env.PRIVATE_FILES ? new R2PersistedVectors(env.PRIVATE_FILES) : new MemoryVectorIndex()) : new VectorizeVectors(env),
    get cad(): CadBackendRegistry {
      return (cad ??= makeCadRegistry(env));
    },
    mailer: lazyMailer(() => resendMailer({ apiKey: env.RESEND_API_KEY, baseUrl: env.RESEND_API_BASE, fetch: fetchImpl })),
    telegram: new BotTelegram(env, fetchImpl),
    gmail: new GmailApi(env, { fetch: fetchImpl }),
    db: new PostgrestDb({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, fetch: fetchImpl }),
    blob: new R2Blob(env),
    events,
    clock,
    browser: o.browser ?? UNWIRED_BROWSER,
  };
}
