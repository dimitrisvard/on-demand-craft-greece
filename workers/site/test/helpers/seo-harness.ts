// Offline harness that runs middleware.ts (Vercel) and the Worker SEO handler on identical inputs: the same shell
// (test/fixtures/seo/shell.html, a copy of dist/index.html) and the same recorded Supabase REST responses
// (test/fixtures/seo/rest.json, written by test/fixtures/seo/record.mjs).
//
// middleware.ts is loaded through a computed path so the Worker's tsconfig never typechecks it (it has strict
// errors), with vi.resetModules() before each load so its isolate Map caches start empty.

import { vi } from 'vitest';
import casesFile from '../fixtures/seo/cases.json';
import restRaw from '../fixtures/seo/rest.json?raw';
import shellHtml from '../fixtures/seo/shell.html?raw';
import type { Env } from '../../src/env';
import { createSeoHandler, type SeoHandler } from '../../src/seo/handler';
import { MemoryKV, TestContext } from './kv';

export const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
export const REST_PREFIX = `${SUPABASE_URL}/rest/v1/`;
export const DUMMY_KEY = 'test-anon-key';
export const ORIGIN: string = casesFile.origin;
export const SHELL: string = shellHtml;
export const SHELL_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  etag: '"shell-etag"',
  'cache-control': 'public, max-age=0, must-revalidate',
};

export interface Override {
  match: string;
  body?: unknown;
  patchRows?: Record<string, unknown>;
  status?: number;
}

export interface ParityCase {
  name: string;
  path: string;
  expect: 'document' | 'null';
  overrides?: Override[];
}

export const CASES: ParityCase[] = casesFile.cases as unknown as ParityCase[];

interface Recorded {
  status: number;
  body: unknown;
}
const REST: Record<string, Recorded> = JSON.parse(restRaw) as Record<string, Recorded>;

export type FailureMode = 'status500' | 'throw' | 'hang';
export interface Failure {
  match: string;
  mode: FailureMode;
}

export interface FixtureOptions {
  overrides?: Override[];
  failures?: Failure[];
  // When false, the fetch stub refuses the shell URL (the Worker must use env.ASSETS, never a self-fetch).
  allowShellFetch?: boolean;
  // Soft-404 tests only: an unrecorded REST URL answers 200 [] (an authoritative "no row") instead of throwing.
  emptyForUnknown?: boolean;
}

// globalThis.fetch replacement: shell for <origin>/index.html, recorded REST responses, nothing else. An unknown
// URL throws AND is listed in `unknown` (both implementations catch fetch errors, so a throw alone would hide it).
export class FixtureFetch {
  readonly calls: string[] = [];
  readonly unknown: string[] = [];
  readonly shellFetches: string[] = [];

  constructor(private readonly options: FixtureOptions = {}) {}

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ORIGIN}/index.html`) {
      this.shellFetches.push(url);
      if (this.options.allowShellFetch === false) throw new Error(`self-fetch of the shell: ${url}`);
      return new Response(SHELL, { status: 200, headers: SHELL_HEADERS });
    }
    if (!url.startsWith(REST_PREFIX)) {
      this.unknown.push(url);
      throw new Error(`unexpected fetch: ${url}`);
    }
    const headers = new Headers(init?.headers);
    this.calls.push(`${url} | apikey=${headers.get('apikey')} | authorization=${headers.get('authorization')}`);

    const failure = this.options.failures?.find((f) => url.includes(f.match));
    if (failure?.mode === 'status500') return new Response('{"message":"boom"}', { status: 500 });
    if (failure?.mode === 'throw') throw new TypeError('network error (test)');
    if (failure?.mode === 'hang') return new Promise<Response>(() => {});

    const recorded = REST[url];
    if (!recorded && this.options.emptyForUnknown) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (!recorded) {
      this.unknown.push(url);
      throw new Error(`unrecorded REST URL (run test/fixtures/seo/record.mjs): ${url}`);
    }
    let body = recorded.body;
    let status = recorded.status;
    const ov = this.options.overrides?.find((o) => url.includes(o.match));
    if (ov) {
      if ('body' in ov) body = ov.body;
      if (ov.patchRows && Array.isArray(body)) body = body.map((r: Record<string, unknown>) => ({ ...r, ...ov.patchRows }));
      if (ov.status !== undefined) status = ov.status;
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

export interface Outcome {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

export async function outcomeOf(res: Response): Promise<Outcome> {
  return {
    status: res.status,
    headers: [...res.headers].sort((a, b) => a[0].localeCompare(b[0])),
    body: await res.text(),
  };
}

// Index and context of the first difference of two strings, for readable failures on 100 kB documents.
export function firstDiff(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return `first difference at ${i} (lengths ${a.length} vs ${b.length}):\n  a: ${JSON.stringify(a.slice(Math.max(0, i - 80), i + 80))}\n  b: ${JSON.stringify(b.slice(Math.max(0, i - 80), i + 80))}`;
}

// ─── middleware.ts ────────────────────────────────────────────────────────────

const processEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
// Computed so tsc does not follow it (middleware.ts is not strict-clean): <repo>/middleware.ts as an absolute path.
const MIDDLEWARE_SPEC = new URL(['..', '..', '..', '..', 'middleware.ts'].join('/'), (import.meta as unknown as { url: string }).url).pathname;

type MiddlewareFn = (request: Request) => Promise<Response | undefined>;

export async function loadMiddleware(): Promise<MiddlewareFn> {
  vi.resetModules();
  const mod = (await import(/* @vite-ignore */ MIDDLEWARE_SPEC)) as { default: MiddlewareFn };
  return mod.default;
}

export interface MiddlewareRun {
  outcome: Outcome | null;
  fixture: FixtureFetch;
}

// Starts middleware.ts on `path`; `advance` lets a fake-timer test move the clock before awaiting.
export async function runMiddleware(
  path: string,
  options: FixtureOptions & { anonKey?: string | null; advance?: () => Promise<void> } = {},
): Promise<MiddlewareRun> {
  const fixture = new FixtureFetch(options);
  const middleware = await loadMiddleware();
  const saved = { key: processEnv.SUPABASE_ANON_KEY, vite: processEnv.VITE_SUPABASE_ANON_KEY };
  if (options.anonKey === null) delete processEnv.SUPABASE_ANON_KEY;
  else processEnv.SUPABASE_ANON_KEY = options.anonKey ?? DUMMY_KEY;
  delete processEnv.VITE_SUPABASE_ANON_KEY;
  vi.stubGlobal('fetch', fixture.fetch);
  try {
    const pending = middleware(new Request(ORIGIN + path));
    if (options.advance) await options.advance();
    const res = await pending;
    return { outcome: res ? await outcomeOf(res) : null, fixture };
  } finally {
    vi.unstubAllGlobals();
    if (saved.key === undefined) delete processEnv.SUPABASE_ANON_KEY;
    else processEnv.SUPABASE_ANON_KEY = saved.key;
    if (saved.vite !== undefined) processEnv.VITE_SUPABASE_ANON_KEY = saved.vite;
  }
}

// ─── Worker SEO handler ───────────────────────────────────────────────────────

export interface AssetsOptions {
  // Paths (pathname) served as real files with their own ETag; everything else is the SPA shell.
  files?: Record<string, string>;
  // Status for /index.html (shell failure tests), or 'throw'.
  shell?: number | 'throw';
}

export class AssetsStub {
  readonly requests: Array<{ method: string; url: string }> = [];

  constructor(private readonly options: AssetsOptions = {}) {}

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    this.requests.push({ method: request.method, url: request.url });
    const head = request.method === 'HEAD';
    if (url.pathname === '/index.html') {
      if (this.options.shell === 'throw') throw new Error('assets unavailable (test)');
      if (typeof this.options.shell === 'number') return new Response('error', { status: this.options.shell });
    }
    const file = this.options.files?.[url.pathname];
    if (file !== undefined) {
      return new Response(head ? null : file, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', etag: `"${url.pathname}"` } });
    }
    return new Response(head ? null : SHELL, { status: 200, headers: SHELL_HEADERS });
  };

  asBinding(): Fetcher {
    return { fetch: this.fetch, connect: () => { throw new Error('not supported'); } } as unknown as Fetcher;
  }
}

export interface WorkerSetup {
  handler?: SeoHandler;
  seoCache?: MemoryKV;
  flags?: MemoryKV;
  assets?: AssetsStub;
  env?: Partial<Env>;
}

export interface WorkerRun {
  result: Response | null;
  outcome: Outcome | null;
  fixture: FixtureFetch;
  handler: SeoHandler;
  seoCache: MemoryKV;
  flags: MemoryKV;
  assets: AssetsStub;
  ctx: TestContext;
}

export function makeEnv(setup: { seoCache: MemoryKV; flags: MemoryKV; assets: AssetsStub; env?: Partial<Env> }): Env {
  return {
    ASSETS: setup.assets.asBinding(),
    SEO_CACHE: setup.seoCache.asBinding(),
    FLAGS: setup.flags.asBinding(),
    SUPABASE_URL,
    SUPABASE_ANON_KEY: DUMMY_KEY,
    SITE_ORIGIN: 'https://www.micronshub.eu',
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: 'https://www.micronshub.eu',
    DIRECTORY_INDEX_EMULATION: 'true',
    ...setup.env,
  };
}

export async function runWorker(
  path: string,
  options: FixtureOptions & WorkerSetup & { advance?: () => Promise<void>; method?: string } = {},
): Promise<WorkerRun> {
  const fixture = new FixtureFetch({ allowShellFetch: false, ...options });
  const handler = options.handler ?? createSeoHandler();
  const seoCache = options.seoCache ?? new MemoryKV();
  const flags = options.flags ?? new MemoryKV();
  const assets = options.assets ?? new AssetsStub();
  const ctx = new TestContext();
  const env = makeEnv({ seoCache, flags, assets, env: options.env });
  // Production path: the handler uses the global fetch (no injected fetch).
  vi.stubGlobal('fetch', fixture.fetch);
  try {
    const pending = handler.handleSeo(new Request(ORIGIN + path, { method: options.method ?? 'GET' }), env, ctx.asContext());
    if (options.advance) await options.advance();
    const result = await pending;
    const outcome = result ? await outcomeOf(result.clone()) : null;
    await ctx.settle();
    return { result, outcome, fixture, handler, seoCache, flags, assets, ctx };
  } finally {
    vi.unstubAllGlobals();
  }
}
