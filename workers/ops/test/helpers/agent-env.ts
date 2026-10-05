// Fakes for every Phase 4 field of OpsEnv (KV FLAGS, R2 PRIVATE_FILES, the two queues, the three Workflow and three
// Durable Object namespaces, Analytics Engine, the rate limiter) and the Phase 4 vars of wrangler.jsonc, to spread
// into the Phase 2 helper: opsEnv({ ...agentBindings() }). AI, QUOTES_INDEX and BROWSER are left out (as in the
// generated T2 configs); a test adds them to check the production-only paths.
//
// agentPorts() builds a full Ports set of fakes for T1: FakeLlm (fixtures replayed through the production SDK
// adapter), HashEmbed, MemoryVectorIndex, RecordingMailer, RecordingTelegram, MemoryDb, R2Blob over FakeR2Bucket,
// RecordingEvents, a settable clock; cad, gmail and browser refuse until a test supplies its own.
//
// FakeLlm fixtures: test/fixtures/llm/<prompt id>/<first 16 hex of the content hash>.json =
// {prompt, request_sha256, response} where request_sha256 is llmContentSha256(user) and response is a Messages API
// response body (content, usage, stop_reason, model). An unknown request answers a 'schema' failure.

import type { OpsEnv } from '../../src/env';
import type { CadBackendRegistry } from '../../src/cad/types';
import type { BrowserPort, ClockPort, GmailPort, LlmCall, LlmFailure, LlmPort, LlmResult, Ports } from '../../src/ports/index';
import { HashEmbed, MemoryVectorIndex } from '../../src/ports/embed-vector';
import { R2Blob } from '../../src/ports/http-adapters';
import { AnthropicLlm, llmContentSha256 } from '../../src/ports/llm';
import { fakeNamespace } from './fake-do';
import { MemoryDb } from './memory-db';
import { RecordingEvents, RecordingMailer, RecordingTelegram } from './recorders';

/** The Phase 4 vars with the values of the production wrangler.jsonc (no T2-only var). */
export const AGENT_VARS: Readonly<Pick<
  Required<OpsEnv>,
  | 'AI_GATEWAY_ID'
  | 'AGENT_TENANT_ID'
  | 'QUOTE_FROM'
  | 'QUOTE_REPLY_TO'
  | 'MESSAGE_ID_DOMAIN'
  | 'CAD_BACKEND_DEFAULT'
  | 'MCP_HOSTNAME'
  | 'MCP_ROUTE'
  | 'ACCESS_TEAM_DOMAIN'
  | 'MCP_ACCESS_AUD'
  | 'SCRAPER_USER_AGENT'
  | 'SCRAPER_PERMITTED_HOSTS'
>> = Object.freeze({
  AI_GATEWAY_ID: 'microns',
  AGENT_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  QUOTE_FROM: 'MicronsHub Quotations <info@micronshub.eu>',
  QUOTE_REPLY_TO: 'replies@rfq.micronshub.eu',
  MESSAGE_ID_DOMAIN: 'rfq.micronshub.eu',
  CAD_BACKEND_DEFAULT: 'vps',
  MCP_HOSTNAME: 'mcp.micronshub.eu',
  MCP_ROUTE: '/mcp',
  ACCESS_TEAM_DOMAIN: 'https://team.example.test',
  MCP_ACCESS_AUD: 't1-aud-mcp',
  SCRAPER_USER_AGENT: 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)',
  SCRAPER_PERMITTED_HOSTS: '{}',
});

/** Binding names agentBindings() fills. */
export type AgentBindingName =
  | 'FLAGS'
  | 'PRIVATE_FILES'
  | 'CAD_JOBS'
  | 'AGENT_EVENTS'
  | 'RFQ_INTAKE'
  | 'QUOTE'
  | 'POST_ORDER'
  | 'RFQ_THREAD'
  | 'MATERIAL_STOCK'
  | 'CAD_ROUTER'
  | 'EVENTS'
  | 'MCP_RATE_LIMIT';

export type AgentBindings = Required<Pick<OpsEnv, AgentBindingName>> & typeof AGENT_VARS;

// ----- KV -----

export class FakeKV {
  readonly store = new Map<string, string>();
  /** Options of every get(), for assertions on cacheTtl. */
  readonly gets: Array<{ key: string; options: unknown }> = [];
  /** When set, every get() throws this error. */
  failWith?: Error;

  async get(key: string, options?: unknown): Promise<unknown> {
    this.gets.push({ key, options });
    if (this.failWith) throw this.failWith;
    const value = this.store.get(key);
    if (value === undefined) return null;
    const type = typeof options === 'string' ? options : (options as { type?: string } | undefined)?.type;
    if (type === 'json') return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, String(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(o?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: true }> {
    return { keys: [...this.store.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).sort().map((name) => ({ name })), list_complete: true };
  }

  async getWithMetadata(key: string, options?: unknown): Promise<{ value: unknown; metadata: null }> {
    return { value: await this.get(key, options), metadata: null };
  }

  /** Stores a JSON value. */
  setJson(key: string, value: unknown): void {
    this.store.set(key, JSON.stringify(value));
  }
}

// ----- R2 -----

interface StoredObject {
  bytes: Uint8Array;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
  uploaded: Date;
}

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body === null || body === undefined) return new Uint8Array(0);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  if (body instanceof ReadableStream) return new Uint8Array(await new Response(body).arrayBuffer());
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error('FakeR2Bucket: unsupported body');
}

function objectOf(key: string, o: StoredObject, bytes: Uint8Array) {
  return {
    key,
    size: o.bytes.length,
    uploaded: o.uploaded,
    httpMetadata: { ...o.httpMetadata },
    customMetadata: { ...o.customMetadata },
    etag: `etag-${o.bytes.length}`,
    httpEtag: `"etag-${o.bytes.length}"`,
    checksums: {},
    get body() {
      return new Response(bytes).body as ReadableStream;
    },
    bodyUsed: false,
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    blob: async () => new Blob([bytes]),
    writeHttpMetadata: () => {},
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FakeR2Bucket {
  readonly objects = new Map<string, StoredObject>();
  /** Every get with its range option, for assertions on range reads. */
  readonly reads: Array<{ key: string; range?: { offset?: number; length?: number } }> = [];

  async put(key: string, body: unknown, options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; sha256?: string }) {
    const bytes = await toBytes(body);
    if (options?.sha256 && options.sha256 !== (await sha256Hex(bytes))) throw new Error('put: The SHA-256 checksum you specified did not match what we received.');
    const stored: StoredObject = { bytes, httpMetadata: options?.httpMetadata ?? {}, customMetadata: options?.customMetadata ?? {}, uploaded: new Date() };
    this.objects.set(key, stored);
    return objectOf(key, stored, bytes);
  }

  async get(key: string, options?: { range?: { offset?: number; length?: number } }) {
    this.reads.push({ key, range: options?.range });
    const o = this.objects.get(key);
    if (!o) return null;
    const start = options?.range?.offset ?? 0;
    const end = options?.range?.length !== undefined ? start + options.range.length : o.bytes.length;
    return objectOf(key, o, o.bytes.slice(start, end));
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? objectOf(key, o, new Uint8Array(0)) : null;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }

  async list(o?: { prefix?: string }) {
    const keys = [...this.objects.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).sort();
    return { objects: keys.map((k) => objectOf(k, this.objects.get(k) as StoredObject, new Uint8Array(0))), truncated: false, delimitedPrefixes: [] };
  }

  /** The stored bytes of a key as text (test convenience). */
  text(key: string): string | null {
    const o = this.objects.get(key);
    return o ? new TextDecoder().decode(o.bytes) : null;
  }
}

// ----- Queues -----

export class FakeQueue<T = unknown> {
  readonly sent: Array<{ body: T; options?: unknown }> = [];
  failWith?: Error;

  async send(body: T, options?: unknown): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ body: structuredClone(body), options });
  }

  async sendBatch(messages: Iterable<{ body: T }>): Promise<void> {
    for (const m of messages) await this.send(m.body);
  }

  async metrics() {
    return { backlogCount: 0, backlogBytes: 0 };
  }
}

// ----- Workflows -----

export interface FakeInstanceCall {
  method: 'sendEvent' | 'terminate' | 'restart' | 'pause' | 'resume' | 'status';
  args?: unknown;
}

export class FakeWorkflowInstance {
  readonly calls: FakeInstanceCall[] = [];
  status_: InstanceStatus['status'] = 'running';
  /** Error thrown by the next call of the named method. */
  failures = new Map<string, Error>();

  constructor(
    readonly id: string,
    readonly params: unknown,
  ) {}

  private record(method: FakeInstanceCall['method'], args?: unknown): void {
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
    this.calls.push(args === undefined ? { method } : { method, args: structuredClone(args) });
  }

  async sendEvent(e: { type: string; payload: unknown }): Promise<void> {
    this.record('sendEvent', e);
  }

  async terminate(): Promise<void> {
    this.record('terminate');
    this.status_ = 'terminated';
  }

  async restart(options?: unknown): Promise<void> {
    this.record('restart', options);
    this.status_ = 'running';
  }

  async pause(): Promise<void> {
    this.record('pause');
  }

  async resume(): Promise<void> {
    this.record('resume');
  }

  async status(): Promise<InstanceStatus> {
    return { status: this.status_ } as InstanceStatus;
  }
}

export class FakeWorkflow<P = unknown> {
  readonly instances = new Map<string, FakeWorkflowInstance>();
  readonly created: Array<{ id: string; params: P }> = [];

  async create(o?: { id?: string; params?: P }): Promise<FakeWorkflowInstance> {
    const id = o?.id ?? crypto.randomUUID();
    if (this.instances.has(id)) throw new Error(`(instance.already_exists) Workflow instance with id "${id}" already exists`);
    const instance = new FakeWorkflowInstance(id, o?.params);
    this.instances.set(id, instance);
    this.created.push({ id, params: structuredClone(o?.params) as P });
    return instance;
  }

  async get(id: string): Promise<FakeWorkflowInstance> {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`(instance.not_found) Workflow instance not found`);
    return instance;
  }

  async createBatch(batch: Array<{ id?: string; params?: P }>): Promise<FakeWorkflowInstance[]> {
    return Promise.all(batch.map((b) => this.create(b)));
  }

  /** The instance with this id, creating it when missing (for tests of decisions on existing runs). */
  ensure(id: string): FakeWorkflowInstance {
    let instance = this.instances.get(id);
    if (!instance) {
      instance = new FakeWorkflowInstance(id, undefined);
      this.instances.set(id, instance);
    }
    return instance;
  }
}

// ----- Durable Objects, Analytics Engine, rate limiter -----

/** A namespace whose objects record every method call and resolve undefined (tests swap in the real class). */
export function recordingDoNamespace(): DurableObjectNamespace & { calls: Array<{ name: string; method: string; args: unknown[] }> } {
  const calls: Array<{ name: string; method: string; args: unknown[] }> = [];
  const ns = fakeNamespace((state) => new Proxy({}, { get: (_target, prop) => (prop === 'then' ? undefined : async (...args: unknown[]) => void calls.push({ name: state.id.name, method: String(prop), args })) }));
  return Object.assign(ns, { calls });
}

export class FakeDataset {
  readonly points: AnalyticsEngineDataPoint[] = [];
  writeDataPoint(p: AnalyticsEngineDataPoint): void {
    this.points.push(structuredClone(p));
  }
}

export function agentBindings(overrides: Partial<OpsEnv> = {}): AgentBindings & Partial<OpsEnv> {
  return {
    ...AGENT_VARS,
    FLAGS: new FakeKV() as unknown as KVNamespace,
    PRIVATE_FILES: new FakeR2Bucket() as unknown as R2Bucket,
    CAD_JOBS: new FakeQueue() as unknown as AgentBindings['CAD_JOBS'],
    AGENT_EVENTS: new FakeQueue() as unknown as AgentBindings['AGENT_EVENTS'],
    RFQ_INTAKE: new FakeWorkflow() as unknown as AgentBindings['RFQ_INTAKE'],
    QUOTE: new FakeWorkflow() as unknown as AgentBindings['QUOTE'],
    POST_ORDER: new FakeWorkflow() as unknown as AgentBindings['POST_ORDER'],
    RFQ_THREAD: recordingDoNamespace() as unknown as AgentBindings['RFQ_THREAD'],
    MATERIAL_STOCK: recordingDoNamespace() as unknown as AgentBindings['MATERIAL_STOCK'],
    CAD_ROUTER: recordingDoNamespace() as unknown as AgentBindings['CAD_ROUTER'],
    EVENTS: new FakeDataset() as unknown as AnalyticsEngineDataset,
    MCP_RATE_LIMIT: { limit: async () => ({ success: true }) } as unknown as RateLimit,
    ...overrides,
  } as AgentBindings & Partial<OpsEnv>;
}

// ----- Ports -----

export class FakeClock implements ClockPort {
  constructor(private t: number = Date.UTC(2026, 9, 5, 9, 0, 0)) {}
  now(): Date {
    return new Date(this.t);
  }
  set(d: Date | number): void {
    this.t = typeof d === 'number' ? d : d.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const NODE_FS: string = 'node:fs';
export const LLM_FIXTURE_DIR = new URL('../fixtures/llm/', import.meta.url).pathname;

export interface LlmFixture {
  prompt: string;
  request_sha256: string;
  /** Messages API response body. */
  response: Record<string, unknown>;
  /** Optional HTTP status (default 200) for error cases. */
  status?: number;
}

/**
 * LlmPort for T1: the fixture of (prompt, content hash) is served as the HTTP answer of the production adapter
 * (AnthropicLlm with the stub base URL), so parsing, schema checks, stop reasons and pricing run the real code.
 */
export class FakeLlm implements LlmPort {
  readonly calls: Array<{ prompt: string; sha256: string; route: string; step: string }> = [];
  /** Fixtures registered in memory (prompt -> content hash -> fixture); they win over files. */
  readonly memory = new Map<string, LlmFixture>();
  /** Request bodies the adapter sent (parsed JSON) and their headers. */
  readonly requests: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];

  constructor(private readonly o: { dir?: string; events?: RecordingEvents; clock?: ClockPort } = {}) {}

  /** Registers a response for a call's user content. */
  async add(prompt: string, user: LlmCall['user'], response: Record<string, unknown>, status = 200): Promise<void> {
    const sha = await llmContentSha256(user);
    this.memory.set(`${prompt}/${sha}`, { prompt, request_sha256: sha, response, status });
  }

  private async fixture(prompt: string, sha: string): Promise<LlmFixture | null> {
    const inMemory = this.memory.get(`${prompt}/${sha}`);
    if (inMemory) return inMemory;
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as { existsSync(p: string): boolean; readFileSync(p: string, e: 'utf8'): string };
    const file = `${this.o.dir ?? LLM_FIXTURE_DIR}${prompt}/${sha.slice(0, 16)}.json`;
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LlmFixture;
  }

  async call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    const sha = await llmContentSha256(c.user);
    this.calls.push({ prompt: c.prompt, sha256: sha, route: c.route, step: c.meta.step });
    const fixture = await this.fixture(c.prompt, sha);
    if (!fixture) return { ok: false, code: 'schema', retryable: false, message: `no LLM fixture for ${c.prompt} ${sha.slice(0, 16)}` };
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        headers[k] = v;
      });
      this.requests.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, headers });
      return new Response(JSON.stringify(fixture.response), { status: fixture.status ?? 200, headers: { 'content-type': 'application/json', 'cf-aig-log-id': 'fixture-log' } });
    }) as typeof fetch;
    const env = { AGENT_STUBS: 'llm', AGENT_LLM_BASE_URL: 'https://llm.fixture.test/anthropic', AI_GATEWAY_TOKEN: 't1-gateway-value' } as OpsEnv;
    const adapter = new AnthropicLlm(env, { fetch: fetchImpl, events: this.o.events, clock: this.o.clock });
    return adapter.call(c);
  }
}

function refusing<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      return () => {
        throw new Error(`${name} port is not set in this test (agentPorts({ ${name}: ... }))`);
      };
    },
  });
}

export interface AgentTestPorts extends Ports {
  llm: FakeLlm;
  embed: HashEmbed;
  vector: MemoryVectorIndex;
  mailer: RecordingMailer;
  telegram: RecordingTelegram;
  db: MemoryDb;
  events: RecordingEvents;
  clock: FakeClock;
  /** The bucket behind `blob`. */
  bucket: FakeR2Bucket;
}

/** Fakes for every port; overrides replace single ports (e.g. { cad: myRegistry }). */
export function agentPorts(overrides: Partial<Ports> & { bucket?: FakeR2Bucket } = {}): AgentTestPorts {
  const clock = (overrides.clock as FakeClock | undefined) ?? new FakeClock();
  const events = (overrides.events as RecordingEvents | undefined) ?? new RecordingEvents();
  const bucket = overrides.bucket ?? new FakeR2Bucket();
  const db = (overrides.db as MemoryDb | undefined) ?? new MemoryDb({ clock: () => clock.now() });
  const ports = {
    llm: new FakeLlm({ events, clock }),
    embed: new HashEmbed(),
    vector: new MemoryVectorIndex(),
    cad: refusing<CadBackendRegistry>('cad'),
    mailer: new RecordingMailer(),
    telegram: new RecordingTelegram(),
    gmail: refusing<GmailPort>('gmail'),
    db,
    blob: new R2Blob({ PRIVATE_FILES: bucket as unknown as R2Bucket } as OpsEnv),
    events,
    clock,
    browser: refusing<BrowserPort>('browser'),
    bucket,
    ...overrides,
  };
  return ports as AgentTestPorts;
}
