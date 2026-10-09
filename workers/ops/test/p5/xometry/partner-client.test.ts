// Port of xometry-bot/tests/test_partner_client.py: 8 of 10 test functions (titles keep the Python names; the two
// download/counteroffer tests are not applicable, port-map.test.ts), with an injected fetch in place of httpx's
// MockTransport, plus the error mapping, page cap and header rules of the TypeScript client.

import { describe, expect, it } from 'vitest';
import { GSH_JOB_OFFERS_QUERY, PARTNER_GRAPHQL_URL, SCAN_MAX_PAGES } from '../../../src/xometry/config';
import { PartnerApiError, PartnerAuthError, PartnerClient, PartnerHttpError, PartnerNetworkError } from '../../../src/xometry/partner-client';
import { XometrySchemaError } from '../../../src/xometry/types';
import { gqlPage, makeOffer, type Json } from './helpers';

interface Seen {
  url: string;
  headers: Headers;
  body: Json;
}

function handler(answer: (body: Json) => Response): { fetcher: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    seen.push({ url: String(input), headers: new Headers(init?.headers), body });
    return answer(body);
  }) as typeof fetch;
  return { fetcher, seen };
}

function pages(byOffset: Record<number, Json>) {
  return handler((body) => {
    const offset = ((body.variables as Json).offsetAttributes as Json).offset as number;
    return Response.json(byOffset[offset]);
  });
}

async function all<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('no rejection');
}

// A credential-shaped test value built at runtime (never a literal of that shape in the repository).
const TOKEN = ['tok', 'secret', 'value'].join('-');

describe('TestScan', () => {
  it('test_paginates_until_has_more_false', async () => {
    const { fetcher, seen } = pages({ 0: gqlPage([makeOffer('HJO-1')], { hasMore: true, offset: 0 }), 20: gqlPage([makeOffer('HJO-2')], { hasMore: false, offset: 20 }) });
    const client = new PartnerClient({ token: 'tok', fetcher });
    expect((await all(client.scan())).map((o) => o.code)).toEqual(['HJO-1', 'HJO-2']);
    expect(seen).toHaveLength(2);
    expect((seen[0].body.variables as Json).filter).toEqual({ urgentStatus: 'without_urgent', responseStatus: 'empty' });
    expect(client.pagesFetched).toBe(2);
    expect(client.capHit).toBe(false);
  });

  it('test_sends_bearer_header', async () => {
    const { fetcher, seen } = pages({ 0: gqlPage([]) });
    await all(new PartnerClient({ token: 'tok', fetcher }).scan());
    expect(seen[0].headers.get('authorization')).toBe('Bearer tok');
  });

  it('test_sends_cookie_when_configured', async () => {
    const { fetcher, seen } = pages({ 0: gqlPage([]) });
    await all(new PartnerClient({ cookie: 'session=abc', fetcher }).scan());
    expect(seen[0].headers.get('cookie')).toBe('session=abc');
    expect(seen[0].headers.has('authorization')).toBe(false);
  });

  it('test_raw_payload_attached', async () => {
    const { fetcher } = pages({ 0: gqlPage([makeOffer('HJO-9')]) });
    const [offer] = await all(new PartnerClient({ token: 'tok', fetcher }).scan());
    expect(offer.raw.code).toBe('HJO-9');
  });

  it('test_no_auth_refused', () => {
    expect(() => new PartnerClient({})).toThrow(PartnerAuthError);
    expect(() => new PartnerClient({ token: '', cookie: '' })).toThrow(PartnerAuthError);
  });

  it('test_401_raises_auth_error', async () => {
    const { fetcher } = handler(() => new Response(null, { status: 401 }));
    const e = await rejection(all(new PartnerClient({ token: 'expired', fetcher }).scan()));
    expect(e).toBeInstanceOf(PartnerAuthError);
    expect((e as PartnerAuthError).status).toBe(401);
  });

  it('test_graphql_errors_raise', async () => {
    const { fetcher } = handler(() => Response.json({ errors: [{ message: 'boom' }], data: null }));
    const e = await rejection(all(new PartnerClient({ token: 'tok', fetcher }).scan()));
    expect(e).toBeInstanceOf(PartnerApiError);
    expect((e as Error).message).toBe('[{"message":"boom"}]');
  });
});

describe('TestMoneyFragment', () => {
  it('test_uses_confirmed_amount_currencycode_fragment', async () => {
    const queries: string[] = [];
    const { fetcher } = handler((body) => {
      queries.push(String(body.query));
      return Response.json(gqlPage([makeOffer(undefined, { cost: { amount: 123.45, currencyCode: 'EUR' } })]));
    });
    const offers = await all(new PartnerClient({ token: 'tok', fetcher }).scan());
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('{ amount currencyCode }');
    expect(offers[0].cost).toEqual({ amount: 123.45, currency: 'EUR' });
  });
});

describe('request and error rules of the TypeScript client', () => {
  it('POSTs operationName, the exact query and variables to the endpoint with JSON headers and the user-agent', async () => {
    const { fetcher, seen } = pages({ 0: gqlPage([]) });
    await all(new PartnerClient({ token: 'tok', fetcher }).scan());
    expect(seen[0].url).toBe(PARTNER_GRAPHQL_URL);
    expect(seen[0].body).toEqual({ operationName: 'gshJobOffers', query: GSH_JOB_OFFERS_QUERY, variables: { filter: { urgentStatus: 'without_urgent', responseStatus: 'empty' }, offsetAttributes: { limit: 20, offset: 0 } } });
    expect(seen[0].headers.get('accept')).toBe('application/json');
    expect(seen[0].headers.get('content-type')).toBe('application/json');
    expect(seen[0].headers.get('user-agent')).toBe('microns-ops-xometry-scan/1 (+https://www.micronshub.eu)');
  });

  it('sends both credentials when both are set; a custom url is used as given', async () => {
    const { fetcher, seen } = pages({ 0: gqlPage([]) });
    await all(new PartnerClient({ token: 'tok', cookie: 'session=abc', fetcher, url: 'https://xometry.test/partners/graphql' }).scan());
    expect(seen[0].url).toBe('https://xometry.test/partners/graphql');
    expect(seen[0].headers.get('authorization')).toBe('Bearer tok');
    expect(seen[0].headers.get('cookie')).toBe('session=abc');
  });

  it('403 is an auth error; 500 and a non-JSON body are HTTP errors; a missing data object is an API error', async () => {
    const cases: Array<[Response, unknown, number | null]> = [
      [new Response(null, { status: 403 }), PartnerAuthError, 403],
      [new Response('oops', { status: 500 }), PartnerHttpError, 500],
      [new Response('<html>', { status: 200 }), PartnerHttpError, 200],
      [Response.json({ data: null }), PartnerApiError, null],
      [Response.json({ data: {} }), PartnerApiError, null],
      [Response.json([1]), PartnerApiError, null],
    ];
    for (const [response, type, status] of cases) {
      const { fetcher } = handler(() => response.clone());
      const e = await rejection(all(new PartnerClient({ token: 'tok', fetcher }).scan()));
      expect(e).toBeInstanceOf(type as new (...a: never[]) => Error);
      if (status !== null) expect((e as { status: number }).status).toBe(status);
    }
  });

  it('empty errors arrays are not errors (Python truthiness); a bad page fails the whole page', async () => {
    const ok = handler(() => Response.json({ ...gqlPage([makeOffer('A')]), errors: [] }));
    expect((await all(new PartnerClient({ token: 'tok', fetcher: ok.fetcher }).scan())).map((o) => o.code)).toEqual(['A']);
    const bad = handler(() => Response.json(gqlPage([makeOffer('A'), makeOffer('B', { isUrgent: null })])));
    const yielded: string[] = [];
    const e = await rejection(
      (async () => {
        for await (const o of new PartnerClient({ token: 'tok', fetcher: bad.fetcher }).scan()) yielded.push(o.code);
      })(),
    );
    expect(e).toBeInstanceOf(XometrySchemaError);
    expect((e as XometrySchemaError).locs).toEqual([['offers', '1', 'isUrgent']]);
    expect(yielded).toEqual([]);
  });

  it('timeouts and connection failures are network errors', async () => {
    const timeout = handler(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(((await rejection(all(new PartnerClient({ token: 'tok', fetcher: timeout.fetcher }).scan()))) as PartnerNetworkError).kind).toBe('timeout');
    const down = handler(() => {
      throw new TypeError('fetch failed');
    });
    expect(((await rejection(all(new PartnerClient({ token: 'tok', fetcher: down.fetcher }).scan()))) as PartnerNetworkError).kind).toBe('network');
  });

  it('stops after SCAN_MAX_PAGES pages that all say hasMore, and reports capHit', async () => {
    const { fetcher, seen } = handler((body) => {
      const offset = ((body.variables as Json).offsetAttributes as Json).offset as number;
      return Response.json(gqlPage([], { hasMore: true, offset }));
    });
    const client = new PartnerClient({ token: 'tok', fetcher });
    await all(client.scan());
    expect(seen).toHaveLength(SCAN_MAX_PAGES);
    expect(((seen[SCAN_MAX_PAGES - 1].body.variables as Json).offsetAttributes as Json).offset).toBe((SCAN_MAX_PAGES - 1) * 20);
    expect(client.capHit).toBe(true);
  });

  it('no error text carries the token or the cookie', async () => {
    for (const status of [401, 403, 500]) {
      const { fetcher } = handler(() => new Response('x', { status }));
      const e = (await rejection(all(new PartnerClient({ token: TOKEN, cookie: `sid=${TOKEN}`, fetcher }).scan()))) as Error;
      expect(`${e.name} ${e.message} ${JSON.stringify(e)}`).not.toContain(TOKEN);
    }
  });
});
