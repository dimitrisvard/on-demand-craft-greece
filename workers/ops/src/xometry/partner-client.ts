// Xometry partner client: the gshJobOffers scan of xometry-bot/xometry_bot/partner_client.py over fetch.
// Read-only toward Xometry: no file download, no counteroffer (submission stays in the xometry-review edge function).
//
// Rules
//   - POST <base>/partners/graphql with {operationName: 'gshJobOffers', query, variables: {filter, offsetAttributes:
//     {limit, offset}}}; headers accept and content-type application/json, the user-agent, authorization
//     'Bearer <token>' when a token is set and cookie when a cookie is set. Neither set: PartnerAuthError, no call.
//   - 30 s per request. 401/403 -> PartnerAuthError; any other non-2xx or a body that is not JSON ->
//     PartnerHttpError; a non-empty `errors` -> PartnerApiError (its JSON, at most 1,000 characters); an answer
//     without data.gshJobOffers -> PartnerApiError; a page that does not parse -> XometrySchemaError (the whole page);
//     timeouts and network failures -> PartnerNetworkError.
//   - Pages of `limit` (20) until metadata.hasMore is false, at most SCAN_MAX_PAGES (100); capHit is set when the
//     last allowed page still had more.
//   - Each offer carries the offer object of the answer as raw.
//   - No error text, log line or exception carries the token, the cookie or a request header.

import { GSH_JOB_OFFERS_QUERY, PARTNER_GRAPHQL_URL, SCAN_FILTER, SCAN_MAX_PAGES, SCAN_PAGE_LIMIT, USER_AGENT } from './config';
import { parseScanPage } from './models';
import type { JobOffer } from './types';

/** The partner API refused the credentials (401/403), or none is configured (status null). */
export class PartnerAuthError extends Error {
  readonly status: 401 | 403 | null;
  constructor(status: 401 | 403 | null, message: string) {
    super(message);
    this.name = 'PartnerAuthError';
    this.status = status;
  }
}

/** GraphQL errors or an answer of the wrong shape. */
export class PartnerApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

/** A non-2xx answer other than 401/403, or an answer that is not JSON. */
export class PartnerHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PartnerHttpError';
    this.status = status;
  }
}

/** No answer: the request timed out or the connection failed. */
export class PartnerNetworkError extends Error {
  readonly kind: 'timeout' | 'network';
  constructor(kind: 'timeout' | 'network') {
    super(kind === 'timeout' ? 'partner API did not answer in time' : 'partner API unreachable');
    this.name = 'PartnerNetworkError';
    this.kind = kind;
  }
}

export interface PartnerClientOptions {
  token?: string;
  cookie?: string;
  fetcher?: typeof fetch;
  /** GraphQL endpoint (default the production URL; tests and T2 pass <base>/partners/graphql). */
  url?: string;
  timeoutMs?: number;
  userAgent?: string;
}

export const PARTNER_TIMEOUT_MS = 30_000;

/** Python truthiness of a JSON value. */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object' && v !== null) return Object.keys(v).length > 0;
  return Boolean(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One signal that aborts when either does. */
function anySignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([a, b]);
  const controller = new AbortController();
  const abort = (s: AbortSignal) => () => controller.abort(s.reason);
  if (a.aborted || b.aborted) controller.abort();
  a.addEventListener('abort', abort(a), { once: true });
  b.addEventListener('abort', abort(b), { once: true });
  return controller.signal;
}

export class PartnerClient {
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof fetch;
  private readonly url: string;
  private readonly timeoutMs: number;
  private pages = 0;
  private okPages = 0;
  private cap = false;

  constructor(o: PartnerClientOptions) {
    if (!o.token && !o.cookie) {
      throw new PartnerAuthError(null, 'no partner auth configured: set XOMETRY_TOKEN and/or XOMETRY_COOKIE');
    }
    this.headers = { accept: 'application/json', 'content-type': 'application/json', 'user-agent': o.userAgent ?? USER_AGENT };
    if (o.token) this.headers.authorization = `Bearer ${o.token}`;
    if (o.cookie) this.headers.cookie = o.cookie;
    this.fetcher = o.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.url = o.url ?? PARTNER_GRAPHQL_URL;
    this.timeoutMs = o.timeoutMs ?? PARTNER_TIMEOUT_MS;
  }

  /** GraphQL calls that got an answer. */
  get pagesFetched(): number {
    return this.pages;
  }

  /** Answers with a 2xx status (the credentials were accepted at the HTTP level). */
  get okAnswers(): number {
    return this.okPages;
  }

  /** True when the scan stopped at SCAN_MAX_PAGES with more pages left. */
  get capHit(): boolean {
    return this.cap;
  }

  private async gql(query: string, variables: Record<string, unknown>, operationName: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ operationName, query, variables }),
        redirect: 'follow',
        signal: anySignal(AbortSignal.timeout(this.timeoutMs), signal),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new PartnerNetworkError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
    }
    this.pages += 1;
    if (response.status === 401 || response.status === 403) {
      // The body is never read; cancelling it is best effort and not awaited.
      void response.body?.cancel().catch(() => {});
      throw new PartnerAuthError(response.status, `partner API returned ${response.status}: session expired or wrong auth header`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new PartnerNetworkError('network');
    }
    if (!response.ok) throw new PartnerHttpError(response.status, `partner API returned ${response.status}`);
    this.okPages += 1;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new PartnerHttpError(response.status, `partner API answered ${response.status} with a body that is not JSON`);
    }
    if (!isObject(payload)) throw new PartnerApiError('partner API answer is not a JSON object');
    if (truthy(payload.errors)) throw new PartnerApiError(JSON.stringify(payload.errors).slice(0, 1000));
    const data = payload.data;
    if (!isObject(data)) throw new PartnerApiError('partner API answer has no data');
    return data;
  }

  private async scanPage(filter: Record<string, unknown>, limit: number, offset: number, signal?: AbortSignal): Promise<unknown> {
    const data = await this.gql(GSH_JOB_OFFERS_QUERY, { filter, offsetAttributes: { limit, offset } }, 'gshJobOffers', signal);
    if (!Object.prototype.hasOwnProperty.call(data, 'gshJobOffers')) throw new PartnerApiError('partner API answer has no gshJobOffers');
    return data.gshJobOffers;
  }

  /** The board, offer by offer, until metadata.hasMore is false (see the rules above). */
  async *scan(o: { filter?: Record<string, unknown>; limit?: number; signal?: AbortSignal } = {}): AsyncGenerator<JobOffer> {
    const filter = o.filter && Object.keys(o.filter).length > 0 ? o.filter : { ...SCAN_FILTER };
    const limit = o.limit ?? SCAN_PAGE_LIMIT;
    let offset = 0;
    for (let page = 0; page < SCAN_MAX_PAGES; page++) {
      const node = await this.scanPage(filter, limit, offset, o.signal);
      const parsed = parseScanPage(node);
      const raws = isObject(node) && Array.isArray(node.offers) ? (node.offers as unknown[]) : [];
      for (let i = 0; i < parsed.offers.length; i++) {
        const offer = parsed.offers[i];
        offer.raw = raws[i] as Record<string, unknown>;
        yield offer;
      }
      if (!parsed.metadata.has_more) return;
      offset += limit;
    }
    this.cap = true;
  }
}
