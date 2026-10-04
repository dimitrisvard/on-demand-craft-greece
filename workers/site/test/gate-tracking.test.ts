// MK-1 (tracking links): throttled repeat-hit answers are byte-identical to the handler's (compared with the real
// api/marketing.js run through the shared shim), the redirect-target rule of each case, report mode, and requests
// that the handler answers without database access pass through untouched.

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../shared/src/compat/vercel-node';
import { applyGate, type GateOutcome } from '../src/auth/gate';
import { UNSUBSCRIBE_HTML, isOwnHost, linkHosts, trackingPixel } from '../src/auth/tracking';
import { SITE_ORIGIN, SUPABASE_URL, apiCall, ctx, fakeLimiter, installUpstream, makeEnv, uuid, type Upstream } from './gate-support';

const HOME = `${SITE_ORIGIN}/`;
let up: Upstream;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  up = await installUpstream();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function track(query: string, o: { publicPath?: string; method?: string } = {}) {
  return apiCall({ endpoint: 'marketing', action: 'track', functionUrl: `/api/marketing?${query}`, publicPath: o.publicPath, method: o.method });
}

async function gateTrack(query: string, env = makeEnv(), o: { publicPath?: string; method?: string } = {}): Promise<GateOutcome> {
  const { r, request } = track(query, o);
  return applyGate(r, request, env, ctx);
}

function clickQuery(eid: string, cid: string, url: string): string {
  return `action=track&type=click&eid=${eid}&cid=${cid}&url=${encodeURIComponent(url)}`;
}

/** The url the handler will redirect to for this function URL (query parse, then decodeURIComponent). */
function handlerLocation(functionUrl: string): string {
  const raw = new URL(functionUrl, 'http://x').searchParams.get('url') ?? '';
  return decodeURIComponent(raw);
}

function allowed(outcome: GateOutcome) {
  expect(outcome.kind).toBe('allow');
  if (outcome.kind !== 'allow') throw new Error('not allowed');
  expect(outcome.principal).toEqual({ class: 'ANON' });
  return outcome;
}

function logLines(): string[] {
  return log.mock.calls.map((c: unknown[]) => String(c[0]));
}

describe('fixtures', () => {
  it('pixel and unsubscribe page match the handler bytes (fixture sizes and hashes)', () => {
    const px = trackingPixel();
    expect(px.length).toBe(70);
    expect(createHash('sha256').update(px).digest('hex')).toBe('497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581');
    const html = new TextEncoder().encode(UNSUBSCRIBE_HTML);
    expect(html.length).toBe(547);
    expect(createHash('sha256').update(html).digest('hex')).toBe('2c9b981f4b00465600eb652d7cb3bf19d1d31327b57293d626e6344411a5eb43');
  });
});

describe('redirect target of a click (redirect=enforce)', () => {
  it('T14: a recorded sent event keeps an external url (no override)', async () => {
    const eid = uuid();
    const cid = uuid();
    up.seed.sentEvents.push({ id: eid, campaign_id: cid });
    const outcome = allowed(await gateTrack(clickQuery(eid, cid, 'https://example.org/offer?a=1&b=2')));
    expect(outcome.functionUrl).toBeUndefined();
  });

  it('T15: random UUIDs and an external url -> SITE_ORIGIN/', async () => {
    const query = clickQuery(uuid(), uuid(), 'https://example.org');
    const outcome = allowed(await gateTrack(query));
    expect(outcome.functionUrl).toBeDefined();
    expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
  });

  it('eid=x or cid=x -> SITE_ORIGIN/ without any lookup', async () => {
    for (const query of [clickQuery('x', uuid(), 'https://example.org'), clickQuery(uuid(), 'x', 'https://example.org')]) {
      const outcome = allowed(await gateTrack(query));
      expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
    }
    expect(up.calls).toEqual([]);
  });

  it('no sent event but the campaign body links the url host -> the url', async () => {
    const cid = uuid();
    up.seed.campaigns.push({ id: cid, body: '<p>Hi</p><a class="x" href="https://partner.example.com/landing?x=1&amp;y=2">Go</a>' });
    const outcome = allowed(await gateTrack(clickQuery(uuid(), cid, 'https://partner.example.com/other')));
    expect(outcome.functionUrl).toBeUndefined();
  });

  it('no sent event and a host the campaign does not link -> SITE_ORIGIN/', async () => {
    const cid = uuid();
    up.seed.campaigns.push({ id: cid, body: '<a href="https://partner.example.com/">x</a>' });
    const outcome = allowed(await gateTrack(clickQuery(uuid(), cid, 'https://partner.example.com.evil.net/')));
    expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
  });

  it('own hosts are kept without a sent event', async () => {
    for (const url of ['https://www.micronshub.eu/en/quote', 'https://micronshub.eu/', 'https://acme.micronshub.eu/x']) {
      expect(allowed(await gateTrack(clickQuery(uuid(), uuid(), url))).functionUrl).toBeUndefined();
    }
    expect(handlerLocation(allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://a.b.micronshub.eu/'))).functionUrl!)).toBe(HOME);
  });

  it('PostgREST 503 or a timeout -> the url is kept and "gate db_unavailable MK-1" is logged', async () => {
    up.failures.push({ match: /marketing_events/, failure: 503 });
    expect(allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'))).functionUrl).toBeUndefined();
    expect(logLines()).toContain('[microns-site] gate db_unavailable MK-1');

    up.failures.length = 0;
    up.failures.push({ match: /marketing_events/, failure: 'hang' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      const pending = gateTrack(clickQuery(uuid(), uuid(), 'https://example.org')).finally(() => { settled = true; });
      for (let i = 0; i < 40 && !settled; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(allowed(await pending).functionUrl).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a network failure on the campaign lookup keeps the url', async () => {
    up.failures.push({ match: /marketing_campaigns/, failure: 'network' });
    expect(allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'))).functionUrl).toBeUndefined();
  });

  it('PostgREST 400 (22P02) counts as not found -> SITE_ORIGIN/', async () => {
    up.failures.push({ match: /marketing_events/, failure: 400 });
    expect(handlerLocation(allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'))).functionUrl!)).toBe(HOME);
  });

  it('a recorded event with a non-http url -> SITE_ORIGIN/', async () => {
    const eid = uuid();
    const cid = uuid();
    up.seed.sentEvents.push({ id: eid, campaign_id: cid });
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative/path']) {
      expect(handlerLocation(allowed(await gateTrack(clickQuery(eid, cid, url))).functionUrl!)).toBe(HOME);
    }
  });

  it('an url that cannot be percent-decoded -> SITE_ORIGIN/', async () => {
    const outcome = allowed(await gateTrack(`action=track&type=click&eid=${uuid()}&cid=${uuid()}&url=%25E0%25A4%25A`));
    expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
    expect(up.calls).toEqual([]);
  });

  it('the override keeps every other parameter byte for byte and replaces repeated url parameters', async () => {
    const eid = uuid();
    const cid = uuid();
    const outcome = allowed(await gateTrack(`type=click&eid=${eid}&url=https%3A%2F%2Fa.example&cid=${cid}&x=a+b%2B&url=https%3A%2F%2Fb.example&action=track`));
    expect(outcome.functionUrl).toBe(`/api/marketing?type=click&eid=${eid}&url=${encodeURIComponent(HOME)}&cid=${cid}&x=a+b%2B&action=track`);
  });

  it('/api/track (rewritten) is gated the same way', async () => {
    const outcome = allowed(await gateTrack(`type=click&eid=${uuid()}&cid=${uuid()}&url=${encodeURIComponent('https://example.org')}&action=track`, makeEnv(), { publicPath: '/api/track' }));
    expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
  });

  it('OPTIONS is gated like GET', async () => {
    const outcome = allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'), makeEnv(), { method: 'OPTIONS' }));
    expect(handlerLocation(outcome.functionUrl!)).toBe(HOME);
  });
});

describe('redirect=report', () => {
  it('never overrides and logs "gate would deny MK-1 redirect_not_allowed"', async () => {
    const outcome = allowed(await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'), makeEnv({ API_GATES_MODE: 'redirect=report' })));
    expect(outcome.functionUrl).toBeUndefined();
    expect(logLines()).toContain('[microns-site] gate would deny MK-1 redirect_not_allowed');
  });

  it('stays silent for a link that belongs to the site', async () => {
    const eid = uuid();
    const cid = uuid();
    up.seed.sentEvents.push({ id: eid, campaign_id: cid });
    await gateTrack(clickQuery(eid, cid, 'https://example.org'), makeEnv({ API_GATES_MODE: 'redirect=report' }));
    expect(logLines().some((l) => l.includes('redirect_not_allowed'))).toBe(false);
  });
});

describe('requests the handler answers without database access pass through', () => {
  it.each([
    ['T1 open without ids', 'action=track&type=open'],
    ['T2 no type, no ids', 'action=track'],
    ['T5 click without url', `action=track&type=click&eid=${'a'.repeat(8)}&cid=y`],
    ['T10 other type', `action=track&type=bogus&eid=1&cid=2`],
    ['type given twice', `action=track&type=open&type=open&eid=1&cid=2`],
  ])('%s', async (_name, query) => {
    const env = makeEnv();
    const outcome = allowed(await gateTrack(query, env));
    expect(outcome.functionUrl).toBeUndefined();
    expect(up.calls).toEqual([]);
    expect((env.API_RATE_LIMIT as unknown as ReturnType<typeof fakeLimiter>).counts.size).toBe(0);
  });

  it('first and repeat hits below the limit run the handler (its first-hit headers are kept)', async () => {
    const eid = uuid();
    for (const type of ['open', 'unsubscribe']) {
      const outcome = allowed(await gateTrack(`action=track&type=${type}&eid=${eid}&cid=${uuid()}`));
      expect(outcome.functionUrl).toBeUndefined();
    }
  });
});

describe('throttled side effects (trk:<eid>)', () => {
  it('31 clicks within 60 s on one random eid -> SITE_ORIGIN/ on all 31; the 31st is answered by the gate', async () => {
    const env = makeEnv();
    const eid = uuid();
    const cid = uuid();
    const query = clickQuery(eid, cid, 'https://example.org');
    for (let i = 0; i < 30; i++) expect(handlerLocation(allowed(await gateTrack(query, env)).functionUrl!)).toBe(HOME);
    const throttled = await gateTrack(query, env);
    expect(throttled.kind).toBe('respond');
    if (throttled.kind !== 'respond') return;
    expect(throttled.response.status).toBe(302);
    expect(throttled.response.headers.get('Location')).toBe(HOME);
    expect(throttled.response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('a throttled genuine click still goes to its url (the lookups run, no write)', async () => {
    const env = makeEnv({ API_RATE_LIMIT: fakeLimiter(0) });
    const eid = uuid();
    const cid = uuid();
    up.seed.sentEvents.push({ id: eid, campaign_id: cid });
    const outcome = await gateTrack(clickQuery(eid, cid, 'https://example.org/x'), env);
    expect(outcome.kind === 'respond' && outcome.response.headers.get('Location')).toBe('https://example.org/x');
    expect(up.calls.every((c) => c.startsWith('GET '))).toBe(true);
    expect(up.calls.length).toBeLessThanOrEqual(2);
  });

  it('rate=report: logged and the handler runs', async () => {
    const env = makeEnv({ API_RATE_LIMIT: fakeLimiter(0), API_GATES_MODE: 'rate=report' });
    allowed(await gateTrack(`action=track&type=open&eid=${uuid()}&cid=${uuid()}`, env));
    expect(logLines()).toContain('[microns-site] gate would deny MK-1 rate_limited');
  });

  it('redirect=report with an undecodable url: the handler runs (it fails before any database access)', async () => {
    const env = makeEnv({ API_RATE_LIMIT: fakeLimiter(0), API_GATES_MODE: 'redirect=report' });
    allowed(await gateTrack(`action=track&type=click&eid=${uuid()}&cid=${uuid()}&url=%25E0%25A4%25A`, env));
  });

  it('without SUPABASE_SERVICE_ROLE_KEY a click answers 500; an open is still served', async () => {
    const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    const click = await gateTrack(clickQuery(uuid(), uuid(), 'https://example.org'), env);
    expect(click.kind === 'deny' && click.response.status).toBe(500);
    allowed(await gateTrack(`action=track&type=open&eid=${uuid()}&cid=${uuid()}`, env));
  });
});

describe('throttled answers are byte-identical to the handler run through the shim', () => {
  // PostgREST fake for the handler's supabase-js client: a sent event exists and so does the earlier
  // opened/clicked event, i.e. a repeat hit.
  function handlerFetch(calls: string[]) {
    return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.origin !== SUPABASE_URL) return new Response('unexpected', { status: 599 });
      const single = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object');
      let rows: unknown[] = [];
      if (url.pathname === '/rest/v1/marketing_events' && request.method === 'GET') {
        const type = url.searchParams.get('event_type');
        if (type === 'eq.sent') rows = [{ subscriber_id: 's-1', campaign_id: 'c-1' }];
        if (type === 'eq.opened' || type === 'eq.clicked') rows = [{ id: 'earlier' }];
      }
      if (request.method !== 'GET') return new Response(null, { status: 204 });
      const body = single ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows);
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  async function handlerAnswer(functionUrl: string): Promise<{ response: Response; calls: string[] }> {
    vi.stubEnv('SUPABASE_URL', SUPABASE_URL);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-value');
    const calls: string[] = [];
    vi.stubGlobal('fetch', handlerFetch(calls));
    vi.resetModules();
    // @ts-ignore -- api/*.js is plain JavaScript; its default export is a Vercel (req, res) handler
    const mod = (await import('../../../api/marketing.js')) as { default: VercelHandler };
    const response = await runNodeHandler(mod.default, {
      request: new Request(`https://www.micronshub.eu${functionUrl}`),
      functionUrl,
      body: null,
      logPrefix: '[microns-site]',
    });
    return { response, calls };
  }

  async function same(gateResponse: Response, handler: Response): Promise<void> {
    expect(gateResponse.status).toBe(handler.status);
    expect([...gateResponse.headers.entries()]).toEqual([...handler.headers.entries()]);
    expect(new Uint8Array(await gateResponse.arrayBuffer())).toEqual(new Uint8Array(await handler.arrayBuffer()));
  }

  async function throttledGate(functionUrl: string): Promise<Response> {
    const { r, request } = apiCall({ endpoint: 'marketing', action: 'track', functionUrl });
    const outcome = await applyGate(r, request, makeEnv({ API_RATE_LIMIT: fakeLimiter(0), API_GATES_MODE: 'redirect=report' }), ctx);
    expect(outcome.kind).toBe('respond');
    if (outcome.kind !== 'respond') throw new Error('not throttled');
    return outcome.response;
  }

  it('open', async () => {
    const url = `/api/marketing?action=track&type=open&eid=${uuid()}&cid=${uuid()}`;
    const gateResponse = await throttledGate(url);
    const { response } = await handlerAnswer(url);
    await same(gateResponse, response);
  });

  it('click', async () => {
    const url = `/api/marketing?${clickQuery(uuid(), uuid(), 'https://example.org/a?b=1')}`;
    const gateResponse = await throttledGate(url);
    const { response } = await handlerAnswer(url);
    await same(gateResponse, response);
  });

  it('unsubscribe (the handler writes; the gate answers the same bytes without writing)', async () => {
    const url = `/api/marketing?action=track&type=unsubscribe&eid=${uuid()}&cid=${uuid()}`;
    const gateResponse = await throttledGate(url);
    const { response, calls } = await handlerAnswer(url);
    await same(gateResponse, response);
    expect(calls.some((c) => !c.startsWith('GET'))).toBe(true);
  });
});

describe('helpers', () => {
  it('isOwnHost', () => {
    const env = makeEnv();
    expect(isOwnHost('www.micronshub.eu', env)).toBe(true);
    expect(isOwnHost('micronshub.eu', env)).toBe(true);
    expect(isOwnHost('t-1.micronshub.eu', env)).toBe(true);
    expect(isOwnHost('a.b.micronshub.eu', env)).toBe(false);
    expect(isOwnHost('micronshub.eu.evil.net', env)).toBe(false);
    expect(isOwnHost('evilmicronshub.eu', env)).toBe(false);
  });

  it('linkHosts reads quoted and unquoted absolute links only', () => {
    expect([...linkHosts('<a href="https://A.example/x">a</a> <a href=\'http://b.example\'>b</a> <a href=https://c.example/>c</a> <a href="/rel">d</a> <a href="mailto:x@y.z">e</a> <a href="{{unsubscribe_url}}">f</a>')].sort())
      .toEqual(['a.example', 'b.example', 'c.example']);
  });
});
