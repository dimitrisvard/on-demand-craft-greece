// Phase 2 configuration of the site: every Phase 2 Env field is optional and checked per dispatch target
// (NAMES_BY_TARGET in src/api/router.ts), so a missing name fails only the requests that need it; and the
// Env interface, the router's names and wrangler.jsonc agree with each other.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/gate', () => ({ applyGate: vi.fn(), actionIdOf: vi.fn() }));
vi.mock('../src/api/files', () => ({ handleFiles: vi.fn() }));
vi.mock('../src/api/emails', () => ({ handleEmails: vi.fn() }));
vi.mock('../src/api/track', () => ({ handleTrack: vi.fn() }));

import opsIndexSource from '../../ops/src/index.ts?raw';
import opsConfigText from '../../ops/wrangler.jsonc?raw';
import { handleEmails } from '../src/api/emails';
import { handleFiles } from '../src/api/files';
import { CATALOGUE_PATHS } from '../src/api/resolve';
import { createRouteApi, ENDPOINT_TARGETS, NAMES_BY_TARGET, routeApi } from '../src/api/router';
import { handleTrack } from '../src/api/track';
import { applyGate } from '../src/auth/gate';
import type { Env } from '../src/env';
import envSource from '../src/env.ts?raw';
import siteConfigText from '../wrangler.jsonc?raw';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://microns-site.example.workers.dev';
const DUMMY = 'dummy-not-a-secret';

// A Phase 1 Env literal (the shape test/helpers/seo-harness.ts builds) must still type-check.
const PHASE1_ONLY: Env = {
  ASSETS: {} as Fetcher,
  SEO_CACHE: {} as KVNamespace,
  FLAGS: {} as KVNamespace,
  SUPABASE_URL: 'https://supabase.invalid',
  SUPABASE_ANON_KEY: DUMMY,
  SITE_ORIGIN: 'https://www.micronshub.eu',
  PREVIEW_HOSTNAMES: '',
  SEO_STRICT_404: 'false',
  API_FORWARD_ORIGIN: 'https://upstream.example',
  DIRECTORY_INDEX_EMULATION: 'true',
};

const FILES_NAMES = [
  'PRIVATE_FILES', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'LEGACY_S3_REGION',
  'LEGACY_S3_RFQ_BUCKET', 'LEGACY_S3_ARTICLES_BUCKET', 'LEGACY_AWS_ACCESS_KEY_ID', 'LEGACY_AWS_SECRET_ACCESS_KEY',
] as const;

const OPS_PATHS = ['/api/notifications', '/api/gsc', '/api/tenders', '/api/connector-status', '/api/tender-scan', '/api/funded-startups', '/api/scrape-website', '/api/scrape-company-profile', '/api/scan-directory', '/api/marketing?action=webhook'];

let errors: string[];
let ctx: TestContext;
let opsHandle: ReturnType<typeof vi.fn>;

function fullEnv(over: Partial<Env> = {}): Env {
  opsHandle = vi.fn(async () => new Response('ops'));
  return {
    ...PHASE1_ONLY,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: new MemoryKV().asBinding(),
    OPS: { handle: opsHandle } as unknown as Env['OPS'],
    PRIVATE_FILES: {} as R2Bucket,
    R2_ACCOUNT_ID: 't1account',
    R2_ACCESS_KEY_ID: DUMMY,
    R2_SECRET_ACCESS_KEY: DUMMY,
    LEGACY_S3_REGION: 'eu-north-1',
    LEGACY_S3_RFQ_BUCKET: 't1-rfq',
    LEGACY_S3_ARTICLES_BUCKET: 't1-articles',
    LEGACY_AWS_ACCESS_KEY_ID: DUMMY,
    LEGACY_AWS_SECRET_ACCESS_KEY: DUMMY,
    SUPABASE_SERVICE_ROLE_KEY: DUMMY,
    RESEND_API_KEY: DUMMY,
    ...over,
  };
}

function post(path: string): Request {
  return new Request(new URL(path, SITE), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
}

async function status(path: string, env: Env, method = 'POST'): Promise<number> {
  const req = method === 'POST' ? post(path) : new Request(new URL(path, SITE), { method });
  return (await routeApi(req, env, ctx.asContext())).status;
}

beforeEach(() => {
  errors = [];
  ctx = new TestContext();
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(applyGate).mockReset();
  vi.mocked(applyGate).mockImplementation(async () => ({ kind: 'allow', actionId: 'GS-1', principal: { class: 'STAFF' } }));
  vi.mocked(handleEmails).mockReset();
  vi.mocked(handleEmails).mockImplementation(async () => new Response('emails'));
  vi.mocked(handleTrack).mockReset();
  vi.mocked(handleTrack).mockImplementation(async () => new Response('track'));
  vi.mocked(handleFiles).mockReset();
  vi.mocked(handleFiles).mockImplementation(async () => new Response('files'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('names per dispatch target', () => {
  it('the table', () => {
    expect(NAMES_BY_TARGET).toEqual({
      emails: ['RESEND_API_KEY'],
      track: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_ORIGIN'],
      files: [...FILES_NAMES],
      ops: ['OPS'],
      forward: [],
    });
  });

  it('with every name present each target answers', async () => {
    const env = fullEnv();
    expect(await status('/api/emails', env)).toBe(200);
    expect(await status('/api/s3?action=list', env)).toBe(200);
    expect(await status('/api/marketing?action=track&type=open', env, 'GET')).toBe(200);
    for (const p of OPS_PATHS) expect(await status(p, env), p).toBe(200);
    expect(errors).toEqual([]);
  });

  it('without RESEND_API_KEY: /api/emails 500 (OPTIONS too), tracking, files and ops answer', async () => {
    const env = fullEnv({ RESEND_API_KEY: undefined });
    expect(await status('/api/emails', env)).toBe(500);
    expect(await status('/api/emails', env, 'OPTIONS')).toBe(500);
    expect(errors).toContain('[microns-site] api config missing: RESEND_API_KEY');
    expect(handleEmails).not.toHaveBeenCalled();
    expect(await status('/api/marketing?action=track&type=open', env, 'GET')).toBe(200);
    expect(await status('/api/track?type=open', env, 'GET')).toBe(200);
    expect(await status('/api/s3?action=list', env)).toBe(200);
    expect(await status('/api/gsc', env)).toBe(200);
  });

  it('an empty value counts as missing', async () => {
    expect(await status('/api/emails', fullEnv({ RESEND_API_KEY: '' }))).toBe(500);
  });

  it('without OPS: every ops path 500, the local paths answer', async () => {
    const env = fullEnv({ OPS: undefined });
    for (const p of OPS_PATHS) expect(await status(p, env), p).toBe(500);
    expect(errors.every((e) => e === '[microns-site] api config missing: OPS')).toBe(true);
    expect(await status('/api/emails', env)).toBe(200);
    expect(await status('/api/s3?action=list', env)).toBe(200);
    expect(await status('/api/marketing?action=track&type=open', env, 'GET')).toBe(200);
  });

  it.each(FILES_NAMES)('without %s: /api/s3 500 only', async (name) => {
    const env = fullEnv({ [name]: undefined } as Partial<Env>);
    expect(await status('/api/s3?action=presign-upload', env)).toBe(500);
    expect(await status('/api/s3?action=list', env, 'OPTIONS')).toBe(500);
    expect(errors).toContain(`[microns-site] api config missing: ${name}`);
    expect(handleFiles).not.toHaveBeenCalled();
    expect(await status('/api/emails', env)).toBe(200);
    expect(await status('/api/tenders', env, 'GET')).toBe(200);
    expect(await status('/api/track?type=open', env, 'GET')).toBe(200);
  });

  it('without SUPABASE_SERVICE_ROLE_KEY: tracking 500, the rest answer', async () => {
    const env = fullEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(await status('/api/track?type=open', env, 'GET')).toBe(500);
    expect(await status('/api/emails', env)).toBe(200);
    expect(await status('/api/marketing?action=webhook', env)).toBe(200);
  });

  it('a Phase 1 env (no Phase 2 name at all): every routed path 500, unknown /api paths still forwarded', async () => {
    for (const path of CATALOGUE_PATHS) expect(await status(path, { ...PHASE1_ONLY, FLAGS: new MemoryKV().asBinding() }), path).toBe(500);
    const res = await routeApi(new Request(`${SITE}/api/other`), { ...PHASE1_ONLY, FLAGS: new MemoryKV().asBinding() }, ctx.asContext());
    expect(await res.text()).toBe('upstream');
  });

  it('a forward target needs no Phase 2 name', async () => {
    const route = createRouteApi({ ...ENDPOINT_TARGETS, gsc: 'forward' });
    const res = await route(post('/api/gsc'), { ...PHASE1_ONLY, FLAGS: new MemoryKV().asBinding() }, ctx.asContext());
    expect(await res.text()).toBe('upstream');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Config and type agree.

/** JSONC -> JSON: drops comments outside strings, then trailing commas. */
function parseJsonc(text: string): Record<string, any> {
  let out = '';
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const site = parseJsonc(siteConfigText);
const ops = parseJsonc(opsConfigText);

const PHASE2_SECRETS = [
  'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY', 'LEGACY_AWS_ACCESS_KEY_ID', 'LEGACY_AWS_SECRET_ACCESS_KEY', 'ACCESS_MACHINE_CLIENT_IDS',
];

function configuredNames(): Set<string> {
  return new Set([
    ...Object.keys(site.vars ?? {}),
    ...(site.secrets?.required ?? []),
    ...(site.kv_namespaces ?? []).map((b: { binding: string }) => b.binding),
    ...(site.services ?? []).map((b: { binding: string }) => b.binding),
    ...(site.r2_buckets ?? []).map((b: { binding: string }) => b.binding),
    ...(site.ratelimits ?? []).map((b: { name: string }) => b.name),
    site.assets?.binding,
  ]);
}

describe('wrangler.jsonc, Env and the router agree', () => {
  it('every Phase 2 Env field is optional and configured (binding, var or required secret)', () => {
    const marker = envSource.indexOf('----- Phase 2');
    expect(marker).toBeGreaterThan(0);
    const phase2 = envSource.slice(marker, envSource.indexOf('}', marker));
    const optional = [...phase2.matchAll(/^\s+([A-Z][A-Z0-9_]*)\?:/gm)].map((m) => m[1]);
    const required = [...phase2.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    expect(optional.length).toBe(22);
    expect(required).toEqual([]);
    const configured = configuredNames();
    expect(optional.filter((name) => !configured.has(name))).toEqual([]);
  });

  it('every name a target checks is configured; secrets are required secrets', () => {
    const configured = configuredNames();
    for (const names of Object.values(NAMES_BY_TARGET)) {
      for (const name of names) expect(configured.has(name), name).toBe(true);
    }
    expect([...site.secrets.required].sort()).toEqual([...PHASE2_SECRETS].sort());
  });

  it('bindings: OPS -> microns-ops#OpsApi (the ops config name and its exported class), R2 EU bucket, three rate limits', () => {
    expect(site.services).toEqual([{ binding: 'OPS', service: 'microns-ops', entrypoint: 'OpsApi' }]);
    expect(ops.name).toBe('microns-ops');
    expect(opsIndexSource).toMatch(/export class OpsApi extends WorkerEntrypoint/);
    expect(site.r2_buckets).toEqual([{ binding: 'PRIVATE_FILES', bucket_name: 'microns-private', jurisdiction: 'eu' }]);
    expect(site.ratelimits).toEqual([
      { name: 'API_RATE_LIMIT', namespace_id: '2001', simple: { limit: 30, period: 60 } },
      { name: 'API_RATE_LIMIT_MAIL', namespace_id: '2002', simple: { limit: 5, period: 60 } },
      { name: 'API_RATE_LIMIT_BULK', namespace_id: '2003', simple: { limit: 300, period: 60 } },
    ]);
  });

  it('vars: forward off by default, forward origin is the Vercel deployment host, gate defaults', () => {
    expect(site.vars).toMatchObject({
      API_FORWARD_TO_VERCEL: 'false',
      API_FORWARD_ORIGIN: 'https://on-demand-craft-greece.vercel.app',
      LEGACY_S3_REGION: 'eu-north-1',
      API_GATES_MODE: 'recipient=report',
      API_MACHINE_HOSTS: '',
    });
    expect(new URL(site.vars.API_FORWARD_ORIGIN).host).not.toBe(new URL(site.vars.SITE_ORIGIN).host);
  });

  it('Phase 1 entries are unchanged', () => {
    expect(site).toMatchObject({
      name: 'microns-site',
      main: 'src/index.ts',
      compatibility_date: '2026-09-01',
      compatibility_flags: ['nodejs_compat'],
      workers_dev: true,
      preview_urls: true,
      assets: { directory: '../../dist', binding: 'ASSETS', html_handling: 'none', not_found_handling: 'single-page-application', run_worker_first: true },
      kv_namespaces: [{ binding: 'SEO_CACHE', id: '<KV_ID_SEO_CACHE>' }, { binding: 'FLAGS', id: '<KV_ID_FLAGS>' }],
      routes: [],
    });
    expect(site.vars).toMatchObject({
      SUPABASE_URL: 'https://cfjrtmtaitwzggzpkhxi.supabase.co',
      SITE_ORIGIN: 'https://www.micronshub.eu',
      PREVIEW_HOSTNAMES: '',
      SEO_STRICT_404: 'false',
      DIRECTORY_INDEX_EMULATION: 'true',
    });
  });

  it('no browser-prefixed AWS name and no secret-looking value in the config', () => {
    // Built at run time, so a repository-wide search for the retired name finds no file.
    expect(siteConfigText).not.toMatch(new RegExp('VITE' + '_AWS'));
    // Built at run time, so this file itself holds no secret-looking prefix.
    const secretLike = new RegExp(`^(${['ey' + 'J', 'whsec' + '_', 're' + '_', 'AK' + 'IA'].join('|')})`);
    for (const value of Object.values(site.vars as Record<string, string>)) {
      expect(value).not.toMatch(secretLike);
    }
  });
});
