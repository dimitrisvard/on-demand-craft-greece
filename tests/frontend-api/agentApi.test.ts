// W-1: src/utils/agentApi.ts and src/types/agent.ts.
//   - src/types/agent.ts parses every shared fixture of workers/shared/test/fixtures/agent-api/ exactly as the
//     shared guards do; the verb/code table, labels and patterns equal the shared contract
//   - status probe: JSON v1 -> available; HTML 200, 404 or a wrong shape -> absent; 401/403/5xx/network reported
//   - no action can be sent without a successful probe; bodies are checked before sending and equal the fixtures
//   - answers: 200 in the contract's shape; {"error"} codes become AgentApiRequestError; messages per code
//   - file URLs keep slashes literal and only carry staff preview keys
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '../../workers/shared/src/agent-api';
import * as agentApiModule from '@/utils/agentApi';
import {
  AgentApiRequestError,
  agentFileUrl,
  dashboardDecision,
  describeAgentError,
  probeAgentApi,
  STAFF_FILE_KEY_RE,
  isStaffFileKey,
  validateQuoteEdits,
  type AgentApiClient,
} from '@/utils/agentApi';
import * as types from '@/types/agent';
import { API_UNAUTHORIZED_EVENT } from '@/utils/apiAuth';
import { supabaseMock } from './mocks/supabase-client';
import { jsonResponse, stubFetch, stubObjectUrls, type RecordedCall } from './helpers';

// import.meta.url is not a file: URL under the jsdom environment; the suite runs from the repository root.
const FIXTURE_DIR = (() => {
  const fromModule = import.meta.url.startsWith('file:') ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../workers/shared/test/fixtures/agent-api') : null;
  const dir = fromModule && existsSync(fromModule) ? fromModule : path.resolve(process.cwd(), 'workers/shared/test/fixtures/agent-api');
  if (!existsSync(dir)) throw new Error(`shared agent-api fixtures not found at ${dir} (run from the repository root)`);
  return `${dir}/`;
})();

function fixtures(): Array<{ file: string; type: string; reject: boolean; value: unknown }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const [type, caseName] = file.split('.');
      return { file, type, reject: caseName.startsWith('reject-'), value: JSON.parse(readFileSync(FIXTURE_DIR + file, 'utf8')) as unknown };
    });
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, 'utf8'));
}

const STATUS_ADMIN = { v: 1, ok: true, actions: ['decision', 'flag', 'start', 'file'], principal: 'ADMIN' };
const STATUS_STAFF = { v: 1, ok: true, actions: ['decision', 'start', 'file'], principal: 'STAFF' };

async function client(status: unknown = STATUS_ADMIN, answer?: (call: RecordedCall, i: number) => Response): Promise<{ api: AgentApiClient; calls: RecordedCall[] }> {
  const { calls } = stubFetch((call, i) => (i === 0 ? jsonResponse(200, status) : (answer?.(call, i) ?? jsonResponse(500, { error: 'x' }))));
  const probe = await probeAgentApi();
  if (!probe.available) throw new Error(`probe failed: ${probe.reason}`);
  return { api: probe.client, calls };
}

beforeEach(() => {
  supabaseMock.reset();
  supabaseMock.accessToken = 'session-fixture-value';
});

describe('src/types/agent.ts mirrors the shared contract', () => {
  it('every shared fixture gets the same answer from both guard sets (accept for <Type>.<case>, refuse for reject-)', () => {
    const all = fixtures();
    expect(all.length).toBeGreaterThan(20);
    const names = new Set(all.map((f) => f.type));
    expect([...names].sort()).toEqual(Object.keys(types.AGENT_API_GUARDS).sort());
    for (const f of all) {
      const mine = types.AGENT_API_GUARDS[f.type as types.AgentApiTypeName](f.value);
      const theirs = shared.AGENT_API_GUARDS[f.type as shared.AgentApiTypeName](f.value);
      expect(mine, f.file).toBe(theirs);
      expect(mine, f.file).toBe(!f.reject);
    }
  });

  it('the same guard names, verb codes, labels, card kinds, actions, errors and patterns', () => {
    expect(Object.keys(types.AGENT_API_GUARDS).sort()).toEqual(Object.keys(shared.AGENT_API_GUARDS).sort());
    expect(types.VERB_CODES).toEqual(shared.VERB_CODES);
    expect(types.VERB_LABELS).toEqual(shared.VERB_LABELS);
    expect(types.CARD_KINDS).toEqual(shared.CARD_KINDS);
    expect(types.AGENT_ACTIONS).toEqual(shared.AGENT_ACTIONS);
    expect(types.AGENT_API_ERRORS).toEqual(shared.AGENT_API_ERRORS);
    expect(types.DECISION_OUTCOMES).toEqual(shared.DECISION_OUTCOMES);
    for (const name of ['TOKEN_RE', 'CODE_RE', 'SHA256_HEX_RE', 'UUID_RE', 'VERB_RE', 'FLAG_EDIT_KEY_RE'] as const) {
      expect(types[name].source, name).toBe(shared[name].source);
    }
    expect([types.NOTE_MAX, types.LABEL_MAX]).toEqual([shared.NOTE_MAX, shared.LABEL_MAX]);
  });
});

describe('probeAgentApi', () => {
  it('JSON v1 status -> available; GET /api/agent/status with the session and Accept: application/json', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, STATUS_STAFF));
    const probe = await probeAgentApi();
    expect(probe.available).toBe(true);
    if (!probe.available) return;
    expect(probe.status).toEqual(STATUS_STAFF);
    expect(probe.client.canEditFlags).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/agent/status');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.get('authorization')).toBe('Bearer session-fixture-value');
    expect(calls[0].headers.get('accept')).toBe('application/json');
  });

  it('an admin status allows flag edits', async () => {
    stubFetch(() => jsonResponse(200, STATUS_ADMIN));
    const probe = await probeAgentApi();
    expect(probe.available && probe.client.canEditFlags).toBe(true);
  });

  it('the SPA shell (HTML 200), 404, a JSON answer of another shape or invalid JSON -> absent', async () => {
    const answers = [
      () => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }),
      () => jsonResponse(404, { error: 'not_found' }),
      () => jsonResponse(200, { v: 2, ok: true, actions: [], principal: 'STAFF' }),
      () => jsonResponse(200, { ok: true }),
      () => new Response('{"v":1,', { status: 200, headers: { 'content-type': 'application/json' } }),
      // A valid status body is accepted only as application/json.
      () => new Response(JSON.stringify(STATUS_STAFF), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ];
    for (const [i, answer] of answers.entries()) {
      stubFetch(answer);
      expect(await probeAgentApi(), String(i)).toEqual({ available: false, reason: 'absent' });
    }
  });

  it('401 -> unauthorized (and the page-wide "sign in again" event); 403 -> forbidden; 5xx and network errors -> error', async () => {
    const seen: string[] = [];
    const listener = () => seen.push('unauthorized');
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);
    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    expect(await probeAgentApi()).toEqual({ available: false, reason: 'unauthorized' });
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
    expect(seen).toEqual(['unauthorized']);
    stubFetch(() => jsonResponse(403, { error: 'forbidden' }));
    expect(await probeAgentApi()).toEqual({ available: false, reason: 'forbidden' });
    stubFetch(() => jsonResponse(502, { error: 'x' }));
    expect(await probeAgentApi()).toEqual({ available: false, reason: 'error' });
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await probeAgentApi()).toEqual({ available: false, reason: 'error' });
  });
});

describe('actions exist only behind a successful probe', () => {
  it('the module exports no function that sends a POST by itself', () => {
    const exported = Object.keys(agentApiModule);
    for (const name of ['decide', 'editFlag', 'start', 'postJson', 'downloadFile', 'previewFile']) expect(exported).not.toContain(name);
  });

  it('with the API absent the probe returns no client and no POST is sent', async () => {
    const { calls } = stubFetch(() => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const probe = await probeAgentApi();
    expect(probe.available).toBe(false);
    expect('client' in probe).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

describe('decision bodies', () => {
  const run = { id: '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b', approval_token_sha256: '270036a11a9956bd2b1ca5ea43f02902928e49dc3fc3cbc342c7afb0197048a1' };

  it('equal the shared fixtures (plain approve; approve with edits and a note)', () => {
    expect(dashboardDecision(run, 'approve')).toEqual(fixture('DecisionBodyDashboard.approve'));
    expect(dashboardDecision(run, 'approve', { edits: { overrides: [{ line_no: 1, unit_price: 99.9 }], shipping: 20 }, note: ' price checked ' })).toEqual(
      fixture('DecisionBodyDashboard.approve-with-edits'),
    );
    expect(dashboardDecision(run, 'approve', { edits: {}, note: '   ' })).toEqual(fixture('DecisionBodyDashboard.approve'));
  });

  it('decide(): one POST /api/agent/decision with the JSON body and the session; the result is returned', async () => {
    const result = { v: 1, ok: true, run_id: run.id, verb: 'approve', outcome: 'event_sent', label: 'Approved' };
    const { api, calls } = await client(STATUS_STAFF, () => jsonResponse(200, result));
    expect(await api.decide(dashboardDecision(run, 'approve'))).toEqual(result);
    expect(calls).toHaveLength(2);
    const post = calls[1];
    expect([post.method, post.url]).toEqual(['POST', '/api/agent/decision']);
    expect(post.headers.get('content-type')).toBe('application/json');
    expect(post.headers.get('authorization')).toBe('Bearer session-fixture-value');
    expect(JSON.parse(post.body as string)).toEqual(fixture('DecisionBodyDashboard.approve'));
    expect(post.body).not.toMatch(/"token"/);
  });

  it('409 already_decided, 422 verb_not_allowed, 401 -> AgentApiRequestError with code and status', async () => {
    for (const [status, code] of [
      [409, 'already_decided'],
      [409, 'stale'],
      [422, 'verb_not_allowed'],
      [401, 'unauthorized'],
      [404, 'not_found'],
      [429, 'rate_limited'],
    ] as const) {
      const { api } = await client(STATUS_STAFF, () => jsonResponse(status, { error: code }));
      const err = await api.decide(dashboardDecision(run, 'approve')).catch((e: unknown) => e);
      expect(err, code).toBeInstanceOf(AgentApiRequestError);
      expect([(err as AgentApiRequestError).code, (err as AgentApiRequestError).status]).toEqual([code, status]);
    }
  });

  it('an answer outside the contract (HTML, a 200 of another shape) -> invalid_response; a network error -> network', async () => {
    const html = await client(STATUS_STAFF, () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(html.api.decide(dashboardDecision(run, 'approve'))).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
    const shape = await client(STATUS_STAFF, () => jsonResponse(200, { ok: true }));
    await expect(shape.api.decide(dashboardDecision(run, 'approve'))).rejects.toMatchObject({ code: 'invalid_response' });
    const down = await client(STATUS_STAFF, () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(down.api.decide(dashboardDecision(run, 'approve'))).rejects.toMatchObject({ code: 'network' });
  });

  it('a body outside the contract is never sent (missing hash, raw token, upper-case hash, bad verb)', async () => {
    const { api, calls } = await client(STATUS_STAFF, () => jsonResponse(200, {}));
    const bad: unknown[] = [
      dashboardDecision({ id: run.id, approval_token_sha256: null }, 'approve'),
      { ...dashboardDecision(run, 'approve'), token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
      { ...dashboardDecision(run, 'approve'), token_sha256: run.approval_token_sha256.toUpperCase() },
      dashboardDecision(run, 'Approve'),
      dashboardDecision(run, 'approve', { note: 'x'.repeat(501) }),
    ];
    for (const body of bad) {
      await expect(api.decide(body as types.DecisionBodyDashboard)).rejects.toMatchObject({ code: 'invalid_body' });
    }
    expect(calls).toHaveLength(1);
  });
});

describe('flag and start', () => {
  it('editFlag and start send the fixture bodies and return the contract results', async () => {
    const answers = [jsonResponse(200, fixture('FlagEditResult.written')), jsonResponse(200, fixture('StartResult.created')), jsonResponse(200, fixture('StartResult.existing'))];
    const { api, calls } = await client(STATUS_ADMIN, (_c, i) => answers[i - 1]);
    expect(await api.editFlag(fixture('FlagEditBody.intake-shadow') as types.FlagEditBody)).toEqual(fixture('FlagEditResult.written'));
    expect(await api.start(fixture('StartBody.quote') as types.StartBody)).toEqual(fixture('StartResult.created'));
    expect(await api.start(fixture('StartBody.rfq-intake') as types.StartBody)).toEqual(fixture('StartResult.existing'));
    expect(calls.slice(1).map((c) => [c.method, c.url, JSON.parse(c.body as string)])).toEqual([
      ['POST', '/api/agent/flag', fixture('FlagEditBody.intake-shadow')],
      ['POST', '/api/agent/start', fixture('StartBody.quote')],
      ['POST', '/api/agent/start', fixture('StartBody.rfq-intake')],
    ]);
  });

  it('refused bodies are not sent (seo key, unknown kind, extra key)', async () => {
    const { api, calls } = await client(STATUS_ADMIN);
    await expect(api.editFlag(fixture('FlagEditBody.reject-seo-key') as types.FlagEditBody)).rejects.toMatchObject({ code: 'invalid_body' });
    await expect(api.start(fixture('StartBody.reject-unknown-kind') as types.StartBody)).rejects.toMatchObject({ code: 'invalid_body' });
    await expect(api.start(fixture('StartBody.reject-extra-key') as types.StartBody)).rejects.toMatchObject({ code: 'invalid_body' });
    expect(calls).toHaveLength(1);
  });

  it('409 flag_off and active_quote_exists come back as codes', async () => {
    const { api } = await client(STATUS_STAFF, (_c, i) => (i === 1 ? jsonResponse(409, { error: 'flag_off' }) : jsonResponse(409, { error: 'active_quote_exists' })));
    await expect(api.start(fixture('StartBody.quote') as types.StartBody)).rejects.toMatchObject({ code: 'flag_off', status: 409 });
    await expect(api.start(fixture('StartBody.quote') as types.StartBody)).rejects.toMatchObject({ code: 'active_quote_exists', status: 409 });
  });
});

describe('stored files', () => {
  const RFQ = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  const SHA = 'ab'.repeat(32);

  it('URLs keep slashes literal; only staff preview keys are accepted', () => {
    expect(agentFileUrl(`quotes/${RFQ}/v2/quote.pdf`)).toBe(`/api/agent/file?k=quotes/${RFQ}/v2/quote.pdf`);
    expect(agentFileUrl(`email/${SHA}/att/3-drawing_v2.pdf`)).toBe(`/api/agent/file?k=email/${SHA}/att/3-drawing_v2.pdf`);
    for (const key of [`rfq/${RFQ}/x.pdf`, `quotes/${RFQ}/v2/../v1/quote.pdf`, `email/${SHA}/att/1-a b.pdf`, '']) {
      expect(() => agentFileUrl(key), key).toThrow(AgentApiRequestError);
    }
    expect(STAFF_FILE_KEY_RE.source).toBe(
      '^(quotes\\/[0-9a-f-]{36}\\/v\\d+\\/quote\\.pdf|orders\\/[0-9a-f-]{36}\\/traveler\\.pdf|cad\\/[0-9a-f-]{36}\\/output\\/[a-z_.]+|email\\/[0-9a-f]{64}\\/(raw\\.eml|att\\/[0-9]+-[A-Za-z0-9._-]{1,100}))$',
    );
  });

  // Same vectors in workers/site/test/agent-hmac.test.ts and workers/ops/test/routes/agent-admin.test.ts.
  const DOT_KEYS = [`cad/${RFQ}/output/..`, `cad/${RFQ}/output/a..b`, `email/${SHA}/att/1-..`, `email/${SHA}/att/1-a..b.pdf`, `email/${SHA}/att/12-..pdf`];

  it("'..' anywhere in a key -> refused before any request; every vector otherwise fits STAFF_FILE_KEY_RE", async () => {
    for (const key of DOT_KEYS) {
      expect(STAFF_FILE_KEY_RE.test(key), key).toBe(true);
      expect(isStaffFileKey(key), key).toBe(false);
      expect(() => agentFileUrl(key), key).toThrow(AgentApiRequestError);
    }
    const { api, calls } = await client(STATUS_STAFF, () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const probes = calls.length;
    for (const key of DOT_KEYS) await expect(api.previewFile(key), key).rejects.toBeInstanceOf(AgentApiRequestError);
    expect(calls).toHaveLength(probes);
    // A single dot stays allowed.
    expect(isStaffFileKey(`email/${SHA}/att/1-a.b.pdf`)).toBe(true);
    expect(agentFileUrl(`cad/${RFQ}/output/flat.dxf`)).toBe(`/api/agent/file?k=cad/${RFQ}/output/flat.dxf`);
  });

  it('previewFile fetches with the session and returns an object URL; a refusal throws', async () => {
    const urls = stubObjectUrls();
    const { api, calls } = await client(STATUS_STAFF, (_c, i) => (i === 1 ? new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }) : jsonResponse(403, { error: 'forbidden' })));
    const target = await api.previewFile(`quotes/${RFQ}/v2/quote.pdf`);
    expect(target.href).toBe('blob:http://localhost:3000/object-1');
    target.revoke();
    expect(urls.revoke).toHaveBeenCalledWith('blob:http://localhost:3000/object-1');
    expect(calls[1].url).toBe(`/api/agent/file?k=quotes/${RFQ}/v2/quote.pdf`);
    expect(calls[1].headers.get('authorization')).toBe('Bearer session-fixture-value');
    await expect(api.previewFile(`quotes/${RFQ}/v2/quote.pdf`)).rejects.toMatchObject({ status: 403 });
    urls.restore();
  });
});

describe('describeAgentError and validateQuoteEdits', () => {
  it('maps codes to page messages', () => {
    const msg = (code: string, status = 409) => describeAgentError(new AgentApiRequestError(code as agentApiModule.AgentApiErrorCode, status));
    expect(msg('already_decided')).toEqual({ title: 'Already decided', refetch: true, signIn: false });
    expect(msg('stale')).toEqual({ title: 'Already decided', refetch: true, signIn: false });
    expect(msg('verb_not_allowed', 422).refetch).toBe(true);
    expect(msg('unauthorized', 401)).toMatchObject({ signIn: true });
    expect(msg('flag_off').title).toBe('The agent is switched off');
    expect(msg('active_quote_exists').title).toBe('A quote is already running for this RFQ');
    expect(describeAgentError(new Error('x')).title).toBe('Could not reach the server');
  });

  it('refuses the edits decide() would refuse', () => {
    expect(validateQuoteEdits({ overrides: [{ line_no: 1, unit_price: 12.5 }], shipping: 0, drafts: { subject: 'Offer', body_text: 'Dear customer' } }, 2)).toBeNull();
    expect(validateQuoteEdits({ overrides: [{ line_no: 3, unit_price: 1 }] }, 2)).toMatch(/Line 3/);
    expect(validateQuoteEdits({ overrides: [{ line_no: 1, unit_price: 1 }, { line_no: 1, unit_price: 2 }] }, 2)).toMatch(/Line 1/);
    expect(validateQuoteEdits({ overrides: [{ line_no: 1, unit_price: -1 }] }, 2)).toMatch(/between 0/);
    expect(validateQuoteEdits({ overrides: [{ line_no: 1, unit_price: 10_000_001 }] }, 2)).toMatch(/between 0/);
    expect(validateQuoteEdits({ overrides: [{ line_no: 1, unit_price: 1, note: '<b>x</b>' }] }, 2)).toMatch(/plain text/);
    expect(validateQuoteEdits({ shipping: Number.NaN }, 2)).toMatch(/Shipping/);
    expect(validateQuoteEdits({ drafts: { subject: 'x'.repeat(201) } }, 2)).toMatch(/Subject/);
    expect(validateQuoteEdits({ drafts: { body_text: '<script>' } }, 2)).toMatch(/Text/);
  });
});
