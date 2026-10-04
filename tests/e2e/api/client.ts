/**
 * Request helpers of tests/e2e/api.spec.ts. Credentials never travel to a host other than the Worker under test:
 *
 * | Helper        | Context                              | Rules                                                     |
 * |---------------|--------------------------------------|-----------------------------------------------------------|
 * | `ApiClient`   | `apiCtx` (BASE_URL, no default headers) | resolves the path against BASE_URL and throws when the result has another origin; adds one Cloudflare Access service-token pair to that single call; never follows a redirect (`maxRedirects: 0`) |
 * | `PlainClient` | `plainCtx` (no headers at all)       | absolute URLs only (presigned R2 / legacy S3 URLs, Supabase Auth, the Vercel side of compare mode); refuses the BASE_URL origin; never follows a redirect |
 *
 * No `extraHTTPHeaders` anywhere: playwright.config.ts stays as it is, and a header added for one call cannot leak
 * into another. Tracing is off whenever Access credentials are set (playwright.config.ts), so no trace stores them.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';

export type CredentialName = 'ci' | 'collector' | 'mcp';

export interface AccessPair {
  id: string;
  secret: string;
}

export type AccessCredentials = Partial<Record<CredentialName, AccessPair | null>>;

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  /** Raw request body (sent byte for byte). */
  body?: string | Buffer | Uint8Array;
  /** JSON body: serialised with JSON.stringify, Content-Type application/json unless set. */
  json?: unknown;
  /** Which Access service token goes with this call (default 'ci'; 'none' sends none). */
  access?: CredentialName | 'none';
  /** Per-request timeout in ms (default 30 s). */
  timeout?: number;
}

const ACCESS_HEADER_NAMES = new Set(['cf-access-client-id', 'cf-access-client-secret']);
const DEFAULT_TIMEOUT_MS = 30_000;

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

/** Calls to the Worker under test (BASE_URL origin only). */
export class ApiClient {
  readonly origin: string;

  constructor(
    private readonly ctx: APIRequestContext,
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
    const data = requestBody(init, headers);
    return this.ctx.fetch(url.href, {
      method: init.method ?? (data === undefined ? 'GET' : 'POST'),
      headers,
      data,
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: init.timeout ?? DEFAULT_TIMEOUT_MS,
    });
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
    const data = requestBody(init, headers);
    return this.ctx.fetch(url.href, {
      method: init.method ?? (data === undefined ? 'GET' : 'POST'),
      headers,
      data,
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: init.timeout ?? DEFAULT_TIMEOUT_MS,
    });
  }
}
