/**
 * Request helpers of tests/e2e/api.spec.ts. Credentials never travel to a host other than the Worker under test:
 *
 * | Helper        | Context                              | Rules                                                     |
 * |---------------|--------------------------------------|-----------------------------------------------------------|
 * | `ApiClient`   | one context per Access identity (`ci`, `collector`, `mcp`, `none`), each with `baseURL` = BASE_URL and no default headers | resolves the path against BASE_URL and throws when the result has another origin; adds the identity's Cloudflare Access service-token pair to that single call; never follows a redirect (`maxRedirects: 0`) |
 * | `PlainClient` | `plainCtx` (no headers at all)       | absolute URLs only (presigned R2 / legacy S3 URLs, Supabase Auth, the Vercel side of compare mode); refuses the BASE_URL origin; never follows a redirect |
 *
 * | Rule | Detail |
 * |---|---|
 * | Headers | No `extraHTTPHeaders` anywhere: playwright.config.ts stays as it is, and a header added for one call cannot leak into another |
 * | Cookies | A request context keeps the cookies its answers set (Access answers a service-token request with a `CF_Authorization` session cookie). Each Access identity therefore has its own context, so a call made for one identity never carries another identity's session |
 * | Errors | A call that fails before an answer arrives (timeout, refused or reset connection) throws an error with the method, the URL (`plain()`: without its query) and the first line of the reason, with every credential value masked; the original error is not attached |
 * | Traces and reports | Traces are off whenever Access credentials are set (playwright.config.ts). Playwright's HTML report records each request's headers like a trace does, so a run with credentials uses the default list/dot reporter (`npm run cf:e2e:api`), and its `playwright-report/` and `test-results/` are never shared |
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';

export type CredentialName = 'ci' | 'collector' | 'mcp';
export type AccessIdentity = CredentialName | 'none';

export interface AccessPair {
  id: string;
  secret: string;
}

export type AccessCredentials = Partial<Record<CredentialName, AccessPair | null>>;

/** Creates one request context (`playwright.request.newContext`); called once per Access identity. */
export type ContextFactory = () => Promise<APIRequestContext>;

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  /** Raw request body (sent byte for byte). */
  body?: string | Buffer | Uint8Array;
  /** JSON body: serialised with JSON.stringify, Content-Type application/json unless set. */
  json?: unknown;
  /** Which Access service token goes with this call (default 'ci'; 'none' sends none). */
  access?: AccessIdentity;
  /** Per-request timeout in ms (default 30 s). */
  timeout?: number;
}

const ACCESS_HEADER_NAMES = new Set(['cf-access-client-id', 'cf-access-client-secret']);
/** Headers whose values are credentials: they never appear in an error message. */
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'apikey',
  'cookie',
  'cf-access-client-id',
  'cf-access-client-secret',
  'cf-access-jwt-assertion',
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MASK = '<redacted>';

/** CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (the CI token) when both are set. */
export function ciCredentialsFromEnv(env: Record<string, string | undefined> = process.env): AccessPair | null {
  const id = env.CF_ACCESS_CLIENT_ID ?? '';
  const secret = env.CF_ACCESS_CLIENT_SECRET ?? '';
  return id !== '' && secret !== '' ? { id, secret } : null;
}

function withoutAccessHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!ACCESS_HEADER_NAMES.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function requestBody(init: CallInit, headers: Record<string, string>): Buffer | undefined {
  if (init.json !== undefined) {
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    return Buffer.from(JSON.stringify(init.json), 'utf8');
  }
  if (init.body === undefined) return undefined;
  return typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : Buffer.from(init.body);
}

/** Values of the credential headers of a request, plus the token of `<scheme> <token>`; longest first. */
function credentialValues(headers: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADER_NAMES.has(name.toLowerCase()) || value.trim() === '') continue;
    values.add(value);
    const token = /^\s*\S+\s+(\S.*?)\s*$/.exec(value)?.[1];
    if (token) values.add(token);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/**
 * The error a failed call throws: method, URL and the first line of the reason, with every credential header value
 * (and `hidden` strings, e.g. a URL query) masked. The original error is not attached as `cause`.
 */
export function callError(
  label: 'api()' | 'plain()',
  method: string,
  shownUrl: string,
  headers: Record<string, string>,
  err: unknown,
  hidden: readonly string[] = [],
): Error {
  let reason = (err instanceof Error ? err.message : String(err)).split('\n', 1)[0];
  for (const value of [...credentialValues(headers), ...hidden.filter((h) => h !== '')]) {
    reason = reason.split(value).join(MASK);
  }
  return new Error(`${label} ${method} ${shownUrl} failed: ${reason}`);
}

async function send(
  ctx: APIRequestContext,
  label: 'api()' | 'plain()',
  url: URL,
  shownUrl: string,
  init: CallInit,
  headers: Record<string, string>,
  hidden: readonly string[],
): Promise<APIResponse> {
  const data = requestBody(init, headers);
  const method = init.method ?? (data === undefined ? 'GET' : 'POST');
  try {
    return await ctx.fetch(url.href, {
      method,
      headers,
      data,
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: init.timeout ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    throw callError(label, method, shownUrl, headers, err, hidden);
  }
}

/** Calls to the Worker under test (BASE_URL origin only); one request context per Access identity. */
export class ApiClient {
  readonly origin: string;
  private readonly contexts = new Map<AccessIdentity, Promise<APIRequestContext>>();

  constructor(
    private readonly newContext: ContextFactory,
    baseURL: string,
    private readonly credentials: AccessCredentials = {},
  ) {
    this.origin = new URL(baseURL).origin;
  }

  /** Absolute URL of `path` on BASE_URL; throws for anything that resolves to another origin. */
  url(path: string): URL {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) {
      throw new Error(`api(): ${url.origin} is not the BASE_URL origin; use PlainClient for other hosts`);
    }
    return url;
  }

  /** The request context of one Access identity (created on first use, kept until dispose()). */
  private contextFor(identity: AccessIdentity): Promise<APIRequestContext> {
    let ctx = this.contexts.get(identity);
    if (!ctx) {
      ctx = this.newContext();
      this.contexts.set(identity, ctx);
    }
    return ctx;
  }

  async fetch(path: string, init: CallInit = {}): Promise<APIResponse> {
    const url = this.url(path);
    const headers = withoutAccessHeaders(init.headers);
    const access = init.access ?? 'ci';
    if (access !== 'none') {
      const pair = this.credentials[access] ?? null;
      if (!pair && access !== 'ci') throw new Error(`api(): no Access credentials for "${access}" in the fixtures`);
      if (pair) {
        headers['CF-Access-Client-Id'] = pair.id;
        headers['CF-Access-Client-Secret'] = pair.secret;
      }
    }
    const ctx = await this.contextFor(access);
    return send(ctx, 'api()', url, url.href, init, headers, []);
  }

  /** Disposes every context this client created. */
  async dispose(): Promise<void> {
    const pending = [...this.contexts.values()];
    this.contexts.clear();
    await Promise.allSettled(pending.map(async (ctx) => (await ctx).dispose()));
  }
}

/** Calls to absolute URLs of other hosts; never carries an Access credential. */
export class PlainClient {
  private readonly refusedOrigin: string;

  constructor(
    private readonly ctx: APIRequestContext,
    baseURL: string,
  ) {
    this.refusedOrigin = new URL(baseURL).origin;
  }

  async fetch(absoluteUrl: string, init: Omit<CallInit, 'access'> = {}): Promise<APIResponse> {
    let url: URL;
    try {
      url = new URL(absoluteUrl);
    } catch {
      throw new Error(`plain(): ${absoluteUrl} is not an absolute URL`);
    }
    if (url.origin === this.refusedOrigin) throw new Error('plain(): BASE_URL requests go through api()');
    const headers = withoutAccessHeaders(init.headers);
    // Presigned URLs carry their signature in the query: an error names the URL without it.
    return send(this.ctx, 'plain()', url, `${url.origin}${url.pathname}`, init, headers, [url.search.slice(1)]);
  }
}
