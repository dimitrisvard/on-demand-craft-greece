// Route table of microns-ops: every function path reaches its handler module, lazily, with the call's function URL,
// for every method; /api/marketing dispatches on the resolved action; /api/tender-scan queues only for a MACHINE
// principal taken from the call. The handler modules are replaced by recording fakes (vi.mock), so nothing here
// touches a network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointId } from '../../shared/src/http/rpc';
import { OPS_ROUTE_TIMEOUT_MS } from '../src/compat/express-shim';
import { OpsApi } from '../src/index';
import { COLLECTOR, MCP, STAFF, invoke, jsonPost, opsCall, opsEnv, recordingQueue, snapshot } from './helpers/ops';

interface Seen { module: string; method: string; url: string; body: unknown; principalHeader: string | undefined }

const h = vi.hoisted(() => {
  const state = {
    loaded: [] as string[],
    seen: [] as Seen[],
    hang: false,
    webhookCalls: 0,
    googleCalls: 0,
  };
  const make = (module: string) => {
    state.loaded.push(module);
    return {
      default: (req: any, res: any) => {
        state.seen.push({
          module,
          method: req.method,
          url: req.url,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
          principalHeader: req.headers['x-microns-principal'],
        });
        if (state.hang) return new Promise(() => {});
        return res.status(200).json({ module });
      },
    };
  };
  return { state, make };
});

vi.mock('../../../api/marketing.js', () => h.make('marketing'));
vi.mock('../../../api/notifications.js', () => h.make('notifications'));
vi.mock('../../../api/gsc.js', () => h.make('gsc'));
vi.mock('../../../api/tenders.js', () => h.make('tenders'));
vi.mock('../../../api/tender-scan.js', () => h.make('tender-scan'));
vi.mock('../../../api/funded-startups.js', () => h.make('funded-startups'));
vi.mock('../../../api/scrape-website.js', () => h.make('scrape-website'));
vi.mock('../../../api/scan-directory.js', () => h.make('scan-directory'));
vi.mock('../../../api/scrape-company-profile.js', () => {
  h.state.loaded.push('scrape-company-profile');
  throw new Error('module-scope failure (missing configuration)');
});
vi.mock('../src/routes/marketing-webhook', () => ({
  handleResendWebhook: async () => {
    h.state.webhookCalls += 1;
    return new Response('webhook-module', { status: 200 });
  },
}));
vi.mock('../src/routes/google-auth', () => ({
  handleGoogleAuth: async () => {
    h.state.googleCalls += 1;
    return new Response('google-auth-module', { status: 200 });
  },
}));

beforeEach(() => {
  h.state.seen = [];
  h.state.hang = false;
  h.state.webhookCalls = 0;
  h.state.googleCalls = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ROUTES: Array<[string, EndpointId, string]> = [
  ['/api/notifications', 'notifications', 'notifications'],
  ['/api/gsc', 'gsc', 'gsc'],
  ['/api/tenders', 'tenders', 'tenders'],
  ['/api/tender-scan', 'tender-scan', 'tender-scan'],
  ['/api/funded-startups', 'funded-startups', 'funded-startups'],
  ['/api/scrape-website', 'scrape-website', 'scrape-website'],
  ['/api/scan-directory', 'scan-directory', 'scan-directory'],
  ['/api/marketing', 'marketing', 'marketing'],
];

describe('lazy loading', () => {
  it('importing the Worker loads no handler module; the first request loads only its own', async () => {
    // This file's first test: the static import of src/index above evaluated the app and every route file.
    expect(h.state.loaded).toEqual([]);
    const response = await invoke(OpsApi, opsCall({ endpoint: 'gsc', action: 'gsc', functionUrl: '/api/gsc?action=status' }));
    expect(response.status).toBe(200);
    expect(h.state.loaded).toEqual(['gsc']);
  });

  it('a module that fails at load answers 500 on its route only', async () => {
    const failing = await invoke(OpsApi, opsCall({ endpoint: 'scrape-company-profile', functionUrl: '/api/scrape-company-profile' }), jsonPost({ url: 'x' }));
    expect(await snapshot(failing)).toMatchObject({ status: 500, body: 'Internal Server Error' });
    const other = await invoke(OpsApi, opsCall({ endpoint: 'scrape-website', functionUrl: '/api/scrape-website' }), jsonPost({ url: 'x' }));
    expect(other.status).toBe(200);
  });
});

describe('every route reaches its module with the function URL', () => {
  for (const [path, endpoint, module] of ROUTES) {
    it(`${path} -> api/${module}.js`, async () => {
      const functionUrl = `${path}?probe=1&action=apollo-enrich`;
      const response = await invoke(OpsApi, opsCall({ endpoint, action: 'probe', functionUrl }), {
        ...jsonPost({ probe: true }),
        origin: 'https://abc-microns-site.example.workers.dev',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ module });
      expect(h.state.seen).toEqual([{ module, method: 'POST', url: functionUrl, body: { probe: true }, principalHeader: undefined }]);
    });
  }

  it('/api/connector-status arrives as its merged function URL and reaches api/tenders.js', async () => {
    const functionUrl = '/api/tenders?x=1&connectors=true';
    const request = new Request('https://www.micronshub.eu/api/connector-status?x=1');
    await new OpsApi({ waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext, opsEnv())
      .handle(request, opsCall({ endpoint: 'tenders', action: 'connectors', functionUrl }));
    expect(h.state.seen.map((s) => [s.module, s.url])).toEqual([['tenders', functionUrl]]);
  });

  it('every method, OPTIONS included, reaches the handler', async () => {
    for (const method of ['OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await invoke(OpsApi, opsCall({ endpoint: 'gsc', action: 'gsc', functionUrl: '/api/gsc' }), { method });
      expect(response.status, method).toBe(200);
    }
    expect(h.state.seen.map((s) => s.method)).toEqual(['OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
  });

  it('a handler that never ends answers 504 after 300 s (ops route deadline)', async () => {
    vi.useFakeTimers();
    h.state.hang = true;
    let settled = false;
    const pending = invoke(OpsApi, opsCall({ endpoint: 'scan-directory', functionUrl: '/api/scan-directory' }), jsonPost({}));
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(OPS_ROUTE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await snapshot(await pending)).toMatchObject({ status: 504, body: 'Gateway Timeout' });
    expect(OPS_ROUTE_TIMEOUT_MS).toBe(300_000);
  });
});

describe('/api/marketing dispatch on the resolved action', () => {
  const cases: Array<[string, string]> = [
    ['webhook', 'webhook-module'],
    ['google-auth', 'google-auth-module'],
  ];
  for (const [action, marker] of cases) {
    it(`${action} -> its own module, not api/marketing.js`, async () => {
      const response = await invoke(OpsApi, opsCall({ endpoint: 'marketing', action, functionUrl: `/api/marketing?action=${action}` }), { method: 'POST', body: '{}' });
      expect(await response.text()).toBe(marker);
      expect(h.state.seen).toEqual([]);
    });
  }

  for (const action of ['apollo-enrich', '#options', '#method', '#unknown', '#unknown-step', 'track']) {
    it(`${action} -> api/marketing.js unchanged`, async () => {
      const response = await invoke(OpsApi, opsCall({ endpoint: 'marketing', action, functionUrl: '/api/marketing?action=x' }), { method: 'OPTIONS' });
      expect(await response.json()).toEqual({ module: 'marketing' });
      expect(h.state.webhookCalls + h.state.googleCalls).toBe(0);
    });
  }
});

describe('/api/tender-scan: the queue only for MACHINE principals from the call', () => {
  const SCAN = (principal = STAFF) => opsCall({ endpoint: 'tender-scan', action: 'scan', functionUrl: '/api/tender-scan', principal });

  it('STAFF + POST with a valid country runs the handler synchronously; nothing is queued', async () => {
    const queue = recordingQueue();
    const response = await invoke(OpsApi, SCAN(), { ...jsonPost({ country_code: 'NL' }), env: opsEnv({ SCRAPES: queue.binding }) });
    expect(await response.json()).toEqual({ module: 'tender-scan' });
    expect(h.state.seen).toMatchObject([{ module: 'tender-scan', method: 'POST', body: { country_code: 'NL' } }]);
    expect(queue.sent).toEqual([]);
  });

  it('a principal-like header never makes a call MACHINE', async () => {
    const queue = recordingQueue();
    const response = await invoke(OpsApi, SCAN(), {
      ...jsonPost({ country_code: 'NL' }, { 'x-microns-principal': 'MACHINE:collector', 'cf-access-client-id': 'collector-id' }),
      env: opsEnv({ SCRAPES: queue.binding }),
    });
    expect(await response.json()).toEqual({ module: 'tender-scan' });
    expect(queue.sent).toEqual([]);
  });

  it('MACHINE + POST with a valid country is queued without loading or running the handler', async () => {
    const queue = recordingQueue();
    const loadedBefore = [...h.state.loaded];
    const response = await invoke(OpsApi, SCAN(COLLECTOR), { ...jsonPost({ country_code: 'de' }), env: opsEnv({ SCRAPES: queue.binding }) });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, country_code: 'DE', queued: true });
    expect(h.state.seen).toEqual([]);
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].body).toMatchObject({ kind: 'tender-scan', params: { country_code: 'DE' }, requested_by: 'MACHINE:collector', run_id: body.run_id });
    // tender-scan may have been loaded by the STAFF tests above; the queued path itself adds nothing.
    expect(h.state.loaded).toEqual(loadedBefore);
  });

  it('the mcp machine is named in requested_by', async () => {
    const queue = recordingQueue();
    await invoke(OpsApi, SCAN(MCP), { ...jsonPost({ country_code: 'GR' }), env: opsEnv({ SCRAPES: queue.binding }) });
    expect(queue.sent[0].body.requested_by).toBe('MACHINE:mcp');
  });

  it('MACHINE with another method runs the handler (OPTIONS, GET)', async () => {
    const queue = recordingQueue();
    for (const method of ['OPTIONS', 'GET']) {
      await invoke(OpsApi, SCAN(COLLECTOR), { method, env: opsEnv({ SCRAPES: queue.binding }) });
    }
    expect(h.state.seen.map((s) => s.method)).toEqual(['OPTIONS', 'GET']);
    expect(queue.sent).toEqual([]);
  });
});
