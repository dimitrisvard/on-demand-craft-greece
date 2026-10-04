// Endpoint catalogue and action resolution (src/api/resolve.ts): every row of the resolution table, and a parity
// check that each sentinel is answered by the unchanged handler itself (OPTIONS / 405 / 400 / 500) without any
// outbound call, so dispatching sentinels ungated has no side effect.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../shared/src/compat/vercel-node';
import { CATALOGUE_PATHS, actionForLog, endpointOfPath, isSentinel, resolveApi, type ResolvedApi } from '../src/api/resolve';

const ORIGIN = 'https://microns-site.example.workers.dev';
const JSON_TYPE = 'application/json';

interface Init {
  body?: string | Uint8Array;
  type?: string | null;
}

function request(method: string, path: string, init: Init = {}): { request: Request; bytes: Uint8Array } {
  const headers = new Headers();
  const hasBody = method !== 'GET' && method !== 'HEAD' && init.body !== undefined;
  if (init.type !== undefined && init.type !== null) headers.set('content-type', init.type);
  else if (init.type === undefined && hasBody) headers.set('content-type', JSON_TYPE);
  const bytes = !hasBody ? new Uint8Array(0) : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body!;
  return { request: new Request(new URL(path, ORIGIN), { method, headers, body: hasBody ? bytes : undefined }), bytes };
}

function resolve(method: string, path: string, init: Init = {}): ResolvedApi {
  const { request: req, bytes } = request(method, path, init);
  return resolveApi(req, bytes);
}

function json(value: unknown): Init {
  return { body: JSON.stringify(value) };
}

describe('endpointOfPath', () => {
  it('maps the 14 public paths of the catalogue', () => {
    expect(Object.fromEntries(CATALOGUE_PATHS.map((p) => [p, endpointOfPath(p)]))).toEqual({
      '/api/emails': 'emails',
      '/api/s3': 's3',
      '/api/marketing': 'marketing',
      '/api/track': 'marketing',
      '/api/notifications': 'notifications',
      '/api/gsc': 'gsc',
      '/api/tenders': 'tenders',
      '/api/connector-status': 'tenders',
      '/api/tender-scan': 'tender-scan',
      '/api/funded-startups': 'funded-startups',
      '/api/scrape-website': 'scrape-website',
      '/api/scrape-company-profile': 'scrape-company-profile',
      '/api/scan-directory': 'scan-directory',
    });
    expect(CATALOGUE_PATHS).toHaveLength(13);
  });

  it('every other path is null (forwarded with the body unread): exact match only', () => {
    for (const path of ['/api/sitemap', '/api/x', '/api/emails/', '/api/Emails', '/api/emails.js', '/api/em%61ils', '/api', '/api/', '/api/tenders-export', '/emails']) {
      expect(endpointOfPath(path), path).toBeNull();
    }
  });

  it('resolveApi refuses a path outside the catalogue', () => {
    expect(() => resolve('GET', '/api/x')).toThrow(/not an \/api endpoint/);
  });
});

describe('isSentinel and actionForLog', () => {
  it('only the five sentinels', () => {
    for (const s of ['#options', '#method', '#unknown', '#unknown-step', '#throws']) expect(isSentinel(s), s).toBe(true);
    for (const s of ['track', 'email', '#other', 'options', '', '#']) expect(isSentinel(s), s).toBe(false);
  });

  it('logs sentinels and short [a-z0-9-] actions only', () => {
    expect(actionForLog('#unknown-step')).toBe('#unknown-step');
    expect(actionForLog('inv-label')).toBe('inv-label');
    expect(actionForLog('inv-a@b.example')).toBe('invalid');
    expect(actionForLog(`inv-${'x'.repeat(60)}`)).toBe('invalid');
  });
});

describe('common fields', () => {
  it('publicPath, functionUrl, upper-case method, query from the function URL, body view and bytes', () => {
    const r = resolve('post', '/api/emails?action=contact&a=1&a=2', json({ name: 'n' }));
    expect(r.endpoint).toBe('emails');
    expect(r.publicPath).toBe('/api/emails');
    expect(r.functionUrl).toBe('/api/emails?action=contact&a=1&a=2');
    expect(r.method).toBe('POST');
    expect(r.query).toEqual({ action: 'contact', a: ['1', '2'] });
    expect(r.body).toEqual({ ok: true, value: { name: 'n' } });
    expect(new TextDecoder().decode(r.bodyBytes)).toBe('{"name":"n"}');
  });

  it('GET and HEAD carry no body bytes even when some are passed', () => {
    const req = new Request(new URL('/api/tenders', ORIGIN));
    const r = resolveApi(req, new TextEncoder().encode('ignored'));
    expect(r.bodyBytes.byteLength).toBe(0);
    expect(r.body).toEqual({ ok: true, value: '' });
  });
});

describe('/api/emails', () => {
  it('OPTIONS -> #options, any method but POST -> #method (before the body is read)', () => {
    expect(resolve('OPTIONS', '/api/emails').action).toBe('#options');
    for (const m of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) expect(resolve(m, '/api/emails', { body: '{bad' }).action, m).toBe('#method');
  });

  it('body.action, then ?action=, then email; contact / rfq / rfq-pdf, every other value is email', () => {
    expect(resolve('POST', '/api/emails', json({ action: 'contact' }))).toMatchObject({ action: 'contact', rawAction: 'contact' });
    expect(resolve('POST', '/api/emails', json({ action: 'rfq' })).action).toBe('rfq');
    expect(resolve('POST', '/api/emails', json({ action: 'rfq-pdf' })).action).toBe('rfq-pdf');
    expect(resolve('POST', '/api/emails', json({ action: 'bogus' }))).toMatchObject({ action: 'email', rawAction: 'bogus' });
    expect(resolve('POST', '/api/emails', json({ action: 5 }))).toMatchObject({ action: 'email', rawAction: 5 });
    expect(resolve('POST', '/api/emails', json({}))).toMatchObject({ action: 'email', rawAction: 'email' });
    expect(resolve('POST', '/api/emails?action=contact', json({})).action).toBe('contact');
    expect(resolve('POST', '/api/emails?action=contact', json({ action: 'rfq' })).action).toBe('rfq');
    expect(resolve('POST', '/api/emails?action=rfq-pdf', json({ action: '' })).action).toBe('rfq-pdf');
  });

  it('non-JSON bodies are read as @vercel/node reads them', () => {
    expect(resolve('POST', '/api/emails?action=contact', { body: 'action=rfq', type: 'text/plain' }).action).toBe('contact');
    expect(resolve('POST', '/api/emails', { body: 'action=rfq', type: 'application/x-www-form-urlencoded' }).action).toBe('rfq');
    expect(resolve('POST', '/api/emails?action=rfq', { body: 'x', type: null }).action).toBe('rfq');
    expect(resolve('POST', '/api/emails?action=rfq', { body: '--b', type: 'multipart/form-data; boundary=b' }).action).toBe('rfq');
  });

  it('a body getter that throws (invalid JSON, malformed Content-Type) -> #throws', () => {
    expect(resolve('POST', '/api/emails', { body: '{not json' }).action).toBe('#throws');
    expect(resolve('POST', '/api/emails?action=contact', { body: '{}', type: 'text/plain; charset' }).action).toBe('#throws');
  });
});

describe('/api/s3', () => {
  it('OPTIONS -> #options; no method check otherwise', () => {
    expect(resolve('OPTIONS', '/api/s3?action=list').action).toBe('#options');
    expect(resolve('GET', '/api/s3?action=list')).toMatchObject({ action: 'list', scope: 'rfq' });
    expect(resolve('DELETE', '/api/s3?action=delete', json({ key: 'k' })).action).toBe('delete');
  });

  it('the five actions; anything else (missing, repeated, unknown) -> #unknown with the raw value', () => {
    for (const a of ['presign-upload', 'presign-download', 'delete', 'delete-folder', 'list']) {
      expect(resolve('POST', `/api/s3?action=${a}`, json({})).action, a).toBe(a);
    }
    expect(resolve('POST', '/api/s3', json({}))).toMatchObject({ action: '#unknown', rawAction: undefined });
    expect(resolve('POST', '/api/s3?action=list&action=delete', json({}))).toMatchObject({ action: '#unknown', rawAction: ['list', 'delete'] });
    expect(resolve('POST', '/api/s3?action=bogus', json({}))).toMatchObject({ action: '#unknown', rawAction: 'bogus' });
    expect(resolve('POST', '/api/s3', json({ action: 'list' })).action).toBe('#unknown');
  });

  it("scope: body.scope || ?scope= || 'rfq'; 'articles' only on an exact match", () => {
    expect(resolve('POST', '/api/s3?action=list', json({ scope: 'articles' })).scope).toBe('articles');
    expect(resolve('POST', '/api/s3?action=list&scope=articles', json({})).scope).toBe('articles');
    expect(resolve('POST', '/api/s3?action=list&scope=articles', json({ scope: 'x' })).scope).toBe('rfq');
    expect(resolve('POST', '/api/s3?action=list&scope=articles&scope=rfq', json({})).scope).toBe('rfq');
    expect(resolve('POST', '/api/s3?action=list', { body: '{"scope":"articles"}', type: 'text/plain' }).scope).toBe('articles');
    expect(resolve('POST', '/api/s3?action=list', { body: 'not json', type: 'text/plain' }).scope).toBe('rfq');
    expect(resolve('POST', '/api/s3?action=list', json(null)).scope).toBe('rfq');
  });

  it('invalid JSON, or a text body that parses to null -> #throws, before the action is checked', () => {
    expect(resolve('POST', '/api/s3?action=list', { body: '{bad' }).action).toBe('#throws');
    expect(resolve('POST', '/api/s3?action=bogus', { body: '{bad' }).action).toBe('#throws');
    expect(resolve('POST', '/api/s3?action=list', { body: 'null', type: 'text/plain' }).action).toBe('#throws');
  });
});

describe('/api/marketing and /api/track', () => {
  it('track and webhook have no method check: OPTIONS resolves like GET', () => {
    expect(resolve('GET', '/api/marketing?action=track&type=open').action).toBe('track');
    expect(resolve('OPTIONS', '/api/marketing?action=track&type=open').action).toBe('track');
    expect(resolve('POST', '/api/marketing?action=webhook', json({})).action).toBe('webhook');
    expect(resolve('OPTIONS', '/api/marketing?action=webhook').action).toBe('webhook');
  });

  it('google-auth: ?error= first (step error), then step authorize / callback / refresh, else #unknown-step', () => {
    expect(resolve('GET', '/api/marketing?action=google-auth&step=authorize')).toMatchObject({ action: 'google-auth', step: 'authorize' });
    expect(resolve('GET', '/api/marketing?action=google-auth&step=callback&code=c')).toMatchObject({ action: 'google-auth', step: 'callback' });
    expect(resolve('GET', '/api/marketing?action=google-auth&step=refresh&error=x')).toMatchObject({ action: 'google-auth', step: 'error' });
    expect(resolve('GET', '/api/marketing?action=google-auth&step=bogus').action).toBe('#unknown-step');
    expect(resolve('GET', '/api/marketing?action=google-auth').action).toBe('#unknown-step');
    expect(resolve('GET', '/api/marketing?action=google-auth&step=refresh&step=refresh').action).toBe('#unknown-step');
  });

  it('OPTIONS on google-auth&step=refresh is NOT a sentinel (gated like GET)', () => {
    const r = resolve('OPTIONS', '/api/marketing?action=google-auth&step=refresh');
    expect(r).toMatchObject({ action: 'google-auth', step: 'refresh' });
    expect(isSentinel(r.action)).toBe(false);
  });

  it('apollo-enrich: OPTIONS -> #options, every other non-POST -> #method, POST -> apollo-enrich', () => {
    expect(resolve('OPTIONS', '/api/marketing?action=apollo-enrich').action).toBe('#options');
    expect(resolve('GET', '/api/marketing?action=apollo-enrich').action).toBe('#method');
    expect(resolve('PUT', '/api/marketing?action=apollo-enrich', json({})).action).toBe('#method');
    expect(resolve('POST', '/api/marketing?action=apollo-enrich', json({})).action).toBe('apollo-enrich');
  });

  it('unknown, missing or repeated action -> #unknown', () => {
    expect(resolve('GET', '/api/marketing?action=bogus')).toMatchObject({ action: '#unknown', rawAction: 'bogus' });
    expect(resolve('GET', '/api/marketing').action).toBe('#unknown');
    expect(resolve('GET', '/api/marketing?action=track&action=track').action).toBe('#unknown');
    expect(resolve('POST', '/api/marketing', json({ action: 'track' })).action).toBe('#unknown');
  });

  it('/api/track merges action=track after the request keys (request keys win)', () => {
    const r = resolve('GET', '/api/track?type=open&eid=1&cid=2');
    expect(r).toMatchObject({ endpoint: 'marketing', publicPath: '/api/track', functionUrl: '/api/marketing?type=open&eid=1&cid=2&action=track', action: 'track' });
    expect(r.query).toEqual({ type: 'open', eid: '1', cid: '2', action: 'track' });
    expect(resolve('GET', '/api/track?action=webhook')).toMatchObject({ functionUrl: '/api/marketing?action=webhook', action: 'webhook' });
    expect(resolve('GET', '/api/track?url=a+b&type=click').functionUrl).toBe('/api/marketing?url=a%2Bb&type=click&action=track');
    expect(resolve('GET', '/api/track').functionUrl).toBe('/api/marketing?action=track');
  });
});

describe('/api/notifications', () => {
  it('OPTIONS -> #options', () => {
    expect(resolve('OPTIONS', '/api/notifications').action).toBe('#options');
  });

  it("body.action || ?action= || 'partner'; nest and production-status, everything else partner (POST only)", () => {
    expect(resolve('POST', '/api/notifications', json({}))).toMatchObject({ action: 'partner', rawAction: 'partner' });
    expect(resolve('POST', '/api/notifications', json({ action: 'nest' })).action).toBe('nest');
    expect(resolve('POST', '/api/notifications', json({ action: 'production-status' })).action).toBe('production-status');
    expect(resolve('POST', '/api/notifications', json({ action: 'bogus' }))).toMatchObject({ action: 'partner', rawAction: 'bogus' });
    expect(resolve('POST', '/api/notifications?action=nest', json({})).action).toBe('nest');
    expect(resolve('POST', '/api/notifications?action=nest', json({ action: 'production-status' })).action).toBe('production-status');
  });

  it('inv-* runs for any method, as given', () => {
    expect(resolve('GET', '/api/notifications?action=inv-x')).toMatchObject({ action: 'inv-x', rawAction: 'inv-x' });
    expect(resolve('PUT', '/api/notifications', json({ action: 'inv-label' })).action).toBe('inv-label');
    expect(resolve('DELETE', '/api/notifications', json({ action: 'inv-stock-scan' })).action).toBe('inv-stock-scan');
    expect(resolve('POST', '/api/notifications', json({ action: 'inv-cron-batch' })).action).toBe('inv-cron-batch');
  });

  it('a non-inv action on any method but POST -> #method', () => {
    expect(resolve('GET', '/api/notifications').action).toBe('#method');
    expect(resolve('GET', '/api/notifications?action=nest').action).toBe('#method');
    expect(resolve('PATCH', '/api/notifications', json({ action: 'partner' })).action).toBe('#method');
  });

  it('invalid JSON or a non-string action -> #throws', () => {
    expect(resolve('POST', '/api/notifications', { body: '{bad' }).action).toBe('#throws');
    expect(resolve('GET', '/api/notifications?action=inv-x', { type: 'text/plain; charset' }).action).toBe('#throws');
    expect(resolve('POST', '/api/notifications', json({ action: 5 }))).toMatchObject({ action: '#throws', rawAction: 5 });
    expect(resolve('POST', '/api/notifications', json({ action: ['inv-x'] })).action).toBe('#throws');
    expect(resolve('POST', '/api/notifications', { body: 'action=a&action=b', type: 'application/x-www-form-urlencoded' }).action).toBe('#throws');
  });
});

describe('/api/gsc', () => {
  it('OPTIONS -> #options; everything else is gsc (requireAdmin precedes the action)', () => {
    expect(resolve('OPTIONS', '/api/gsc').action).toBe('#options');
    expect(resolve('GET', '/api/gsc?action=search-analytics')).toMatchObject({ action: 'gsc', rawAction: 'search-analytics' });
    expect(resolve('POST', '/api/gsc', json({ action: 'inspect-url' }))).toMatchObject({ action: 'gsc', rawAction: 'inspect-url' });
    expect(resolve('POST', '/api/gsc', { body: '{bad' }).action).toBe('gsc');
    expect(resolve('DELETE', '/api/gsc').action).toBe('gsc');
  });
});

describe('/api/tenders and /api/connector-status', () => {
  it('OPTIONS; GET order connectors -> stats_only -> export -> id -> list; PATCH; else #method', () => {
    expect(resolve('OPTIONS', '/api/tenders').action).toBe('#options');
    expect(resolve('GET', '/api/tenders?connectors=true&stats_only=true').action).toBe('connectors');
    expect(resolve('GET', '/api/tenders?stats_only=true&export=csv').action).toBe('stats');
    expect(resolve('GET', '/api/tenders?export=csv&id=1').action).toBe('export');
    expect(resolve('GET', '/api/tenders?id=1').action).toBe('id');
    expect(resolve('GET', '/api/tenders').action).toBe('list');
    expect(resolve('GET', '/api/tenders?connectors=1&stats_only=TRUE&export=json').action).toBe('list');
    expect(resolve('PATCH', '/api/tenders', json({ id: 1 })).action).toBe('patch');
    for (const m of ['POST', 'PUT', 'DELETE', 'HEAD']) expect(resolve(m, '/api/tenders').action, m).toBe('#method');
  });

  it('/api/connector-status: connectors=true merged after the request keys, method preserved', () => {
    expect(resolve('GET', '/api/connector-status')).toMatchObject({ endpoint: 'tenders', functionUrl: '/api/tenders?connectors=true', action: 'connectors' });
    expect(resolve('GET', '/api/connector-status?x=1').functionUrl).toBe('/api/tenders?x=1&connectors=true');
    expect(resolve('GET', '/api/connector-status?connectors=false').action).toBe('list');
    expect(resolve('PATCH', '/api/connector-status', json({ id: 1 })).action).toBe('patch');
    expect(resolve('OPTIONS', '/api/connector-status').action).toBe('#options');
  });
});

describe('/api/tender-scan, /api/funded-startups, scrapers', () => {
  it('tender-scan: OPTIONS, POST scan, else #method', () => {
    expect(resolve('OPTIONS', '/api/tender-scan').action).toBe('#options');
    expect(resolve('POST', '/api/tender-scan', json({ country_code: 'GR' })).action).toBe('scan');
    expect(resolve('GET', '/api/tender-scan').action).toBe('#method');
  });

  it('funded-startups: GET order stats -> feeds -> export -> id -> list; POST scan; PATCH; else #method', () => {
    expect(resolve('OPTIONS', '/api/funded-startups').action).toBe('#options');
    for (const a of ['stats', 'feeds', 'export']) expect(resolve('GET', `/api/funded-startups?action=${a}&id=1`).action, a).toBe(a);
    expect(resolve('GET', '/api/funded-startups?action=other&id=1').action).toBe('id');
    expect(resolve('GET', '/api/funded-startups').action).toBe('list');
    expect(resolve('POST', '/api/funded-startups', json({})).action).toBe('scan');
    expect(resolve('PATCH', '/api/funded-startups', json({})).action).toBe('patch');
    expect(resolve('DELETE', '/api/funded-startups').action).toBe('#method');
  });

  it('scrape-website, scrape-company-profile, scan-directory: OPTIONS, POST post, else #method', () => {
    for (const p of ['/api/scrape-website', '/api/scrape-company-profile', '/api/scan-directory']) {
      expect(resolve('OPTIONS', p).action, p).toBe('#options');
      expect(resolve('POST', p, json({})).action, p).toBe('post');
      expect(resolve('GET', p).action, p).toBe('#method');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Parity: each sentinel is answered by the unchanged handler itself, with no outbound call.

const EXPECTED_STATUS: Record<string, number[]> = {
  '#options': [200, 204],
  '#method': [405],
  '#unknown': [400],
  '#unknown-step': [400],
  '#throws': [500],
};

interface SentinelCase {
  module: string;
  method: string;
  path: string;
  init?: Init;
  sentinel: string;
}

const SENTINEL_CASES: SentinelCase[] = [
  { module: 'emails', method: 'OPTIONS', path: '/api/emails', sentinel: '#options' },
  { module: 'emails', method: 'GET', path: '/api/emails', sentinel: '#method' },
  { module: 'emails', method: 'POST', path: '/api/emails', init: { body: '{bad' }, sentinel: '#throws' },
  { module: 'emails', method: 'POST', path: '/api/emails', init: { body: '{}', type: 'text/plain; charset' }, sentinel: '#throws' },
  { module: 's3', method: 'OPTIONS', path: '/api/s3?action=list', sentinel: '#options' },
  { module: 's3', method: 'POST', path: '/api/s3?action=bogus', init: json({}), sentinel: '#unknown' },
  { module: 's3', method: 'POST', path: '/api/s3', init: json({}), sentinel: '#unknown' },
  { module: 's3', method: 'POST', path: '/api/s3?action=list', init: { body: '{bad' }, sentinel: '#throws' },
  { module: 's3', method: 'POST', path: '/api/s3?action=list', init: { body: 'null', type: 'text/plain' }, sentinel: '#throws' },
  { module: 'marketing', method: 'GET', path: '/api/marketing?action=bogus', sentinel: '#unknown' },
  { module: 'marketing', method: 'GET', path: '/api/marketing?action=google-auth&step=bogus', sentinel: '#unknown-step' },
  { module: 'marketing', method: 'OPTIONS', path: '/api/marketing?action=apollo-enrich', sentinel: '#options' },
  { module: 'marketing', method: 'GET', path: '/api/marketing?action=apollo-enrich', sentinel: '#method' },
  { module: 'notifications', method: 'OPTIONS', path: '/api/notifications', sentinel: '#options' },
  { module: 'notifications', method: 'GET', path: '/api/notifications?action=nest', sentinel: '#method' },
  { module: 'notifications', method: 'POST', path: '/api/notifications', init: { body: '{bad' }, sentinel: '#throws' },
  { module: 'notifications', method: 'POST', path: '/api/notifications', init: json({ action: 5 }), sentinel: '#throws' },
  { module: 'gsc', method: 'OPTIONS', path: '/api/gsc', sentinel: '#options' },
  { module: 'tenders', method: 'OPTIONS', path: '/api/tenders', sentinel: '#options' },
  { module: 'tenders', method: 'POST', path: '/api/tenders', init: json({}), sentinel: '#method' },
  { module: 'tenders', method: 'HEAD', path: '/api/connector-status', sentinel: '#method' },
  { module: 'tender-scan', method: 'OPTIONS', path: '/api/tender-scan', sentinel: '#options' },
  { module: 'tender-scan', method: 'GET', path: '/api/tender-scan', sentinel: '#method' },
  { module: 'funded-startups', method: 'OPTIONS', path: '/api/funded-startups', sentinel: '#options' },
  { module: 'funded-startups', method: 'DELETE', path: '/api/funded-startups', sentinel: '#method' },
  { module: 'scrape-website', method: 'OPTIONS', path: '/api/scrape-website', sentinel: '#options' },
  { module: 'scrape-website', method: 'GET', path: '/api/scrape-website', sentinel: '#method' },
  { module: 'scrape-company-profile', method: 'OPTIONS', path: '/api/scrape-company-profile', sentinel: '#options' },
  { module: 'scrape-company-profile', method: 'GET', path: '/api/scrape-company-profile', sentinel: '#method' },
  { module: 'scan-directory', method: 'OPTIONS', path: '/api/scan-directory', sentinel: '#options' },
  { module: 'scan-directory', method: 'PUT', path: '/api/scan-directory', init: json({}), sentinel: '#method' },
];

async function loadHandler(name: string): Promise<VercelHandler> {
  // A variable specifier (absolute file URL): the handler files are plain JS without type declarations.
  const specifier = new URL(`../../../api/${name}.js`, (import.meta as unknown as { url: string }).url).href;
  return ((await import(/* @vite-ignore */ specifier)) as { default: VercelHandler }).default;
}

describe('sentinels are answered by the unchanged handlers, with no outbound call', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(SENTINEL_CASES)('$module $method $path -> $sentinel', async (c) => {
    // Module-scope clients need these names; no value is ever used for a request here.
    vi.stubEnv('RESEND_API_KEY', 'dummy-not-a-secret');
    vi.stubEnv('SUPABASE_URL', 'https://supabase.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'dummy-not-a-secret');
    vi.stubEnv('SUPABASE_ANON_KEY', 'dummy-not-a-secret');
    const outbound = vi.fn(async () => new Response('unexpected outbound call', { status: 599 }));
    vi.stubGlobal('fetch', outbound);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { request: req, bytes } = request(c.method, c.path, c.init);
    const r = resolveApi(req, bytes);
    expect(r.action).toBe(c.sentinel);

    const handler = await loadHandler(c.module);
    const response = await runNodeHandler(handler, {
      request: req,
      functionUrl: r.functionUrl,
      body: r.method === 'GET' || r.method === 'HEAD' ? null : r.bodyBytes,
      logPrefix: '[microns-site]',
      timeoutMs: 5_000,
    });
    expect(EXPECTED_STATUS[c.sentinel]).toContain(response.status);
    expect(outbound).not.toHaveBeenCalled();
  });
});
