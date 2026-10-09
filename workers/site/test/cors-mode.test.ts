// API_CORS_MODE (PLAN.md P6-4): parity by default, allow-list after the Phase 3 observation window. finalise() is the
// single place every answer passes (test/router.test.ts "is applied exactly once"), so the switch lives there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import configText from '../wrangler.jsonc?raw';
import previewSource from '../src/preview.ts?raw';
import envSource from '../src/env.ts?raw';
import { ALLOWLIST_HEADERS, VERCEL_API_CORS_HEADERS } from '../../shared/src/http/cors';
import type { Env } from '../src/env';
import { corsMode, finalise } from '../src/preview';

const PROD = 'https://www.micronshub.eu';
const PREVIEW = 'https://staging-microns-site.acme.workers.dev';
const CORS_NAMES = [
  'access-control-allow-credentials',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
];

function env(mode?: string): Env {
  return { SITE_ORIGIN: PROD, PREVIEW_HOSTNAMES: '', ...(mode === undefined ? {} : { API_CORS_MODE: mode }) } as unknown as Env;
}

function answer(url: string, opts: { origin?: string; method?: string; mode?: string; response?: Response } = {}): Response {
  const headers: Record<string, string> = {};
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  const request = new Request(url, { method: opts.method ?? 'GET', headers });
  return finalise(opts.response ?? new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }), request, env(opts.mode));
}

function cors(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...CORS_NAMES, 'vary']) {
    const value = res.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

const PARITY = Object.fromEntries(VERCEL_API_CORS_HEADERS.map(([n, v]) => [n.toLowerCase(), v]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('corsMode', () => {
  it('is parity unless the var says allowlist (trimmed, any case)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(corsMode(env())).toBe('parity');
    expect(corsMode(env(''))).toBe('parity');
    expect(corsMode(env('parity'))).toBe('parity');
    expect(corsMode(env('allowlist'))).toBe('allowlist');
    expect(corsMode(env(' AllowList '))).toBe('allowlist');
    expect(corsMode(env('allow-list'))).toBe('parity');
  });

  it('logs each unknown value once, never the known ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    corsMode(env('strict'));
    corsMode(env('strict'));
    corsMode(env('open'));
    corsMode(env('strict'));
    corsMode(env('parity'));
    corsMode(env('allowlist'));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('[microns-site] API_CORS_MODE "strict"');
    expect(String(warn.mock.calls[1][0])).toContain('API_CORS_MODE "open"');
  });
});

describe('parity mode (default)', () => {
  it.each([undefined, 'parity', 'bogus'])('API_CORS_MODE=%s: the four vercel.json headers on /api/*, whatever the Origin', (mode) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const origin of [undefined, PROD, 'https://elsewhere.example']) {
      const res = answer(`${PROD}/api/emails`, { origin, mode });
      expect(cors(res)).toEqual(PARITY);
    }
  });
});

describe('allowlist mode: only listed origins are reflected', () => {
  const mode = 'allowlist';

  it('reflects the production origin, the apex and one-label tenant hosts; no credentials; Vary: Origin', () => {
    for (const origin of [PROD, 'https://micronshub.eu', 'https://laserkritis.micronshub.eu']) {
      const res = answer(`${PROD}/api/emails`, { origin, mode });
      expect(cors(res), origin).toEqual({
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
        'access-control-allow-headers': ALLOWLIST_HEADERS,
        'access-control-max-age': '600',
        vary: 'Origin',
      });
    }
    expect(ALLOWLIST_HEADERS).toContain('Authorization');
    expect(ALLOWLIST_HEADERS).toContain('X-Turnstile-Token');
  });

  it('grants nothing to an unlisted origin or without an Origin; the answer itself is unchanged', async () => {
    const unlisted = [
      undefined,
      'null',
      'https://elsewhere.example',
      'https://www.micronshub.eu.elsewhere.example',
      'https://notmicronshub.eu',
      'http://www.micronshub.eu',
      'https://api.micronshub.eu',
      'https://a.b.micronshub.eu',
      'https://on-demand-craft-greece.vercel.app',
      'https://www.micronshub.eu:8443',
      PREVIEW,
      'http://localhost:8080',
    ];
    for (const origin of unlisted) {
      const res = answer(`${PROD}/api/emails`, { origin, mode });
      expect(cors(res), String(origin)).toEqual({ vary: 'Origin' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{}');
    }
  });

  it('preview and local dev origins only when the request itself is on a preview host of the same account', () => {
    expect(cors(answer(`${PREVIEW}/api/emails`, { origin: PREVIEW, mode }))['access-control-allow-origin']).toBe(PREVIEW);
    expect(cors(answer(`${PREVIEW}/api/emails`, { origin: 'https://microns-site.acme.workers.dev', mode }))['access-control-allow-origin'])
      .toBe('https://microns-site.acme.workers.dev');
    expect(cors(answer(`${PREVIEW}/api/emails`, { origin: 'http://localhost:8080', mode }))['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(cors(answer(`${PREVIEW}/api/emails`, { origin: 'https://microns-site.other.workers.dev', mode }))).toEqual({ vary: 'Origin' });
    expect(cors(answer(`${PROD}/api/emails`, { origin: PREVIEW, mode }))).toEqual({ vary: 'Origin' });
  });

  it('replaces the grants a handler or the Vercel forward set (e.g. the s3 preflight) and keeps its status', () => {
    const handlerAnswer = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
    const unlisted = answer(`${PROD}/api/s3?action=presign-upload`, { origin: 'https://elsewhere.example', method: 'OPTIONS', mode, response: handlerAnswer.clone() });
    expect(unlisted.status).toBe(204);
    expect(cors(unlisted)).toEqual({ vary: 'Origin' });
    const listed = answer(`${PROD}/api/s3?action=presign-upload`, { origin: PROD, method: 'OPTIONS', mode, response: handlerAnswer });
    expect(listed.status).toBe(204);
    expect(cors(listed)['access-control-allow-origin']).toBe(PROD);
    expect(cors(listed)['access-control-allow-credentials']).toBeUndefined();
  });

  it('keeps an existing Vary and adds Origin once', () => {
    const res = answer(`${PROD}/api/sitemap`, { origin: PROD, mode, response: new Response('x', { headers: { Vary: 'Accept-Encoding' } }) });
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Origin');
    const again = answer(`${PROD}/api/sitemap`, { origin: PROD, mode, response: new Response('x', { headers: { Vary: 'origin' } }) });
    expect(again.headers.get('vary')).toBe('origin');
  });

  it('leaves every non-/api answer alone (pages, assets, sitemaps)', () => {
    for (const path of ['/en/services', '/assets/index-abc.js', '/sitemap.xml', '/api', '/apix', '/robots.txt']) {
      const res = answer(`${PROD}${path}`, { origin: PROD, mode });
      expect(cors(res), path).toEqual({});
    }
    expect(answer(`${PROD}/assets/index-abc.js`, { mode }).headers.get('content-type')).toBe('application/javascript; charset=utf-8');
  });

  it('HEAD keeps the empty body; noindex and HSTS rules are unaffected', () => {
    const head = answer(`${PREVIEW}/api/emails`, { origin: PREVIEW, method: 'HEAD', mode });
    expect(head.body).toBeNull();
    expect(head.headers.get('x-robots-tag')).toBe('noindex');
    const prod = answer(`${PROD}/api/emails`, { origin: PROD, mode });
    expect(prod.headers.has('x-robots-tag')).toBe(false);
  });
});

describe('configuration', () => {
  it('wrangler.jsonc ships parity at the top level (previews) and in env.production; the Env field lives in preview.ts', () => {
    // Switching on (after the Phase 3 gate, preview first) changes these values and this expectation together.
    const values = [...configText.matchAll(/"API_CORS_MODE":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(['parity', 'parity']);
    expect(previewSource).toMatch(/interface CorsModeEnv extends Env \{\s*API_CORS_MODE\?: string;/);
    expect(envSource).not.toMatch(/API_CORS_MODE/);
  });
});
