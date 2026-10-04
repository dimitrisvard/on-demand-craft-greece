// /api/tender-scan for MACHINE principals against the real api/tender-scan.js: the queued answer, the message,
// validation answers identical to the handler's own (status, headers and body), and the connector code list read
// from the handler source. The global fetch fails the test if anything reaches the network.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../shared/src/compat/vercel-node';
import type { Principal } from '../../shared/src/http/rpc';
import { COLLECTOR, MCP, STAFF, invoke, opsCall, opsEnv, recordingQueue, snapshot, SUPABASE_URL, type RecordingQueue } from './helpers/ops';

type IndexModule = typeof import('../src/index');
type TenderScanRoute = typeof import('../src/routes/tender-scan');

const HANDLER_SOURCE = fileURLToPath(new URL('../../../api/tender-scan.js', import.meta.url));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let OpsApi: IndexModule['OpsApi'];
let route: TenderScanRoute;
let handler: VercelHandler;
let queue: RecordingQueue;
let networkCalls: string[];
let errors: string[];

beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-value');
  vi.resetModules();
  ({ OpsApi } = await import('../src/index'));
  route = await import('../src/routes/tender-scan');
  handler = ((await import('../../../api/tender-scan.js')) as { default: VercelHandler }).default;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  queue = recordingQueue();
  networkCalls = [];
  errors = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    networkCalls.push(String(input instanceof Request ? input.url : input));
    throw new Error('network is not allowed in this test');
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scanCall(principal: Principal) {
  return opsCall({ endpoint: 'tender-scan', action: 'scan', functionUrl: '/api/tender-scan', principal });
}

function post(body: string, contentType: string | null): RequestInit {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers['content-type'] = contentType;
  return { method: 'POST', headers, body };
}

async function viaOps(principal: Principal, init: RequestInit) {
  return snapshot(await invoke(OpsApi, scanCall(principal), { ...init, env: opsEnv({ SCRAPES: queue.binding }) }));
}

/** The handler's own answer, run directly through the shim (as on Vercel), for comparison. */
async function direct(init: RequestInit): Promise<{ status: number; headers: Record<string, string>; body: string } | 'threw'> {
  const request = new Request('https://www.micronshub.eu/api/tender-scan', init);
  const bytes = new Uint8Array(await request.clone().arrayBuffer());
  try {
    return await snapshot(await runNodeHandler(handler, { request, functionUrl: '/api/tender-scan', body: bytes, logPrefix: '[microns-ops]' }));
  } catch {
    return 'threw';
  }
}

describe('connector codes', () => {
  it('equal the CONNECTORS table of api/tender-scan.js, in order', () => {
    const source = readFileSync(HANDLER_SOURCE, 'utf8');
    const block = /const CONNECTORS = \{([\s\S]*?)\n\};/.exec(source);
    expect(block, 'CONNECTORS block found in api/tender-scan.js').not.toBeNull();
    const codes = [...block![1].matchAll(/^\s*([A-Z]{2}):/gm)].map((m) => m[1]);
    expect(codes.length).toBe(30);
    expect(route.TENDER_SCAN_COUNTRY_CODES).toStrictEqual(codes);
  });
});

describe('MACHINE + POST, valid country: queued', () => {
  it('answers 200 at once with every key of the scan answer at zero, queued and run_id; the job is sent', async () => {
    const answer = await viaOps(COLLECTOR, post(JSON.stringify({ country_code: 'nl' }), 'application/json'));
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(answer.headers['access-control-allow-origin']).toBe('*');
    expect(answer.headers['access-control-allow-credentials']).toBe('true');
    expect(answer.headers['access-control-allow-methods']).toBe('GET,OPTIONS,POST');
    expect(answer.headers['access-control-allow-headers']).toBe(
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
    );
    const body = JSON.parse(answer.body) as Record<string, unknown>;
    expect(Object.keys(body)).toStrictEqual([
      'success', 'country_code', 'tenders_found', 'tenders_new', 'tenders_relevant', 'errors', 'duration_ms', 'queued', 'run_id',
    ]);
    expect(body).toMatchObject({ success: true, country_code: 'NL', tenders_found: 0, tenders_new: 0, tenders_relevant: 0, errors: [], duration_ms: 0, queued: true });
    expect(body.run_id).toMatch(UUID_RE);

    expect(queue.sent).toHaveLength(1);
    const { body: message, options } = queue.sent[0];
    expect(options).toEqual({ contentType: 'json' });
    expect(Object.keys(message).sort()).toEqual(['enqueued_at', 'kind', 'params', 'requested_by', 'run_id', 'v']);
    expect(message).toMatchObject({ v: 1, kind: 'tender-scan', params: { country_code: 'NL' }, run_id: body.run_id, requested_by: 'MACHINE:collector' });
    expect(new Date(message.enqueued_at).toISOString()).toBe(message.enqueued_at);
    expect(networkCalls).toEqual([]);
  });

  it('every connector code is accepted (any case) and queued upper-case', async () => {
    for (const code of route.TENDER_SCAN_COUNTRY_CODES) {
      const answer = await viaOps(MCP, post(JSON.stringify({ country_code: code.toLowerCase() }), 'application/json'));
      expect(answer.status, code).toBe(200);
    }
    expect(queue.sent.map((s) => s.body.params.country_code)).toStrictEqual([...route.TENDER_SCAN_COUNTRY_CODES]);
    expect(new Set(queue.sent.map((s) => s.body.requested_by))).toEqual(new Set(['MACHINE:mcp']));
  });

  it('a form-urlencoded country is accepted as the handler accepts it', async () => {
    const answer = await viaOps(COLLECTOR, post('country_code=ie', 'application/x-www-form-urlencoded'));
    expect(answer.status).toBe(200);
    expect(queue.sent[0].body.params).toEqual({ country_code: 'IE' });
  });

  it('without the SCRAPES binding: 500 text/plain and a config log line, nothing sent', async () => {
    const env = opsEnv();
    delete (env as Partial<typeof env>).SCRAPES;
    const response = await invoke(OpsApi, scanCall(COLLECTOR), { ...post('{"country_code":"NL"}', 'application/json'), env });
    expect(await snapshot(response)).toMatchObject({ status: 500, body: 'Internal Server Error' });
    expect(errors.join('\n')).toContain('[microns-ops] api config missing: SCRAPES');
  });

  it('a queue send failure answers 500 text/plain', async () => {
    queue.failWith = new Error('queue unavailable');
    const answer = await viaOps(COLLECTOR, post('{"country_code":"NL"}', 'application/json'));
    expect(answer).toMatchObject({ status: 500, body: 'Internal Server Error' });
  });
});

describe('MACHINE + POST, invalid input: the handler answer, nothing queued', () => {
  // Bodies the handler answers with 400 JSON before any work.
  const handled: Array<[string, string, string | null]> = [
    ['empty object', '{}', 'application/json'],
    ['empty string code', '{"country_code":""}', 'application/json'],
    ['null code', '{"country_code":null}', 'application/json'],
    ['zero code', '{"country_code":0}', 'application/json'],
    ['false code', '{"country_code":false}', 'application/json'],
    ['JSON null', 'null', 'application/json'],
    ['JSON array', '[1,2]', 'application/json'],
    ['JSON string', '"NL"', 'application/json'],
    ['empty body', '', 'application/json'],
    ['no content type', '{"country_code":"NL"}', null],
    ['text/plain', 'country_code=NL', 'text/plain'],
    ['octet-stream', '{"country_code":"NL"}', 'application/octet-stream'],
    ['multipart', '--x--', 'multipart/form-data; boundary=x'],
    ['unknown code', '{"country_code":"zz"}', 'application/json'],
    ['unknown code with digits', '{"country_code":"Nl1"}', 'application/json'],
    ['prototype-like code', '{"country_code":"__proto__"}', 'application/json'],
    ['constructor', '{"country_code":"constructor"}', 'application/json'],
    ['unknown form code', 'country_code=xx', 'application/x-www-form-urlencoded'],
  ];

  for (const [name, body, contentType] of handled) {
    it(`${name}: identical to the handler's own answer`, async () => {
      const expected = await direct(post(body, contentType));
      expect(expected).not.toBe('threw');
      expect((expected as { status: number }).status).toBe(400);
      const machine = await viaOps(COLLECTOR, post(body, contentType));
      expect(machine).toStrictEqual(expected);
      const staff = await viaOps(STAFF, post(body, contentType));
      expect(staff).toStrictEqual(expected);
      expect(queue.sent).toEqual([]);
      expect(networkCalls).toEqual([]);
    });
  }

  // Bodies on which the handler fails before any write (the body getter throws, or the code is not a string).
  const fallthrough: Array<[string, string, string, number]> = [
    ['invalid JSON', '{"country_code":', 'application/json', 400],
    ['malformed content type', '{"country_code":"NL"}', 'application/json; =', 500],
    ['number code', '{"country_code":5}', 'application/json', 500],
    ['array code', '{"country_code":["NL"]}', 'application/json', 500],
    ['object code', '{"country_code":{"a":1}}', 'application/json', 500],
    ['repeated form key', 'country_code=nl&country_code=de', 'application/x-www-form-urlencoded', 500],
  ];

  for (const [name, body, contentType, status] of fallthrough) {
    it(`${name}: runs the handler synchronously (${status}), as for any other caller`, async () => {
      const machine = await viaOps(COLLECTOR, post(body, contentType));
      const staff = await viaOps(STAFF, post(body, contentType));
      expect(machine.status).toBe(status);
      expect(machine).toStrictEqual(staff);
      expect(queue.sent).toEqual([]);
      expect(networkCalls).toEqual([]);
    });
  }
});
