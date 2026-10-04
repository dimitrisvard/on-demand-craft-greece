// OpsApi entrypoint and the Hono app around every route: the OpsCall check, the call registry read by the
// middleware, the 404 surfaces, the error boundary and the per-call log line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsCall } from '../../shared/src/http/rpc';
import { app, registerCall } from '../src/app';
import worker, { OpsApi, invalidCallReason } from '../src/index';
import { invoke, opsCall, opsEnv, snapshot, testContext } from './helpers/ops';

const gsc = vi.hoisted(() => ({
  seen: [] as Array<{ method: string; url: string }>,
  mode: 'ok' as 'ok' | 'throw' | 'api-error',
}));

vi.mock('../../../api/gsc.js', () => ({
  default: async (req: { method: string; url: string }, res: { status(n: number): { json(b: unknown): void } }) => {
    gsc.seen.push({ method: req.method, url: req.url });
    if (gsc.mode === 'throw') throw new Error('handler exploded for someone@example.test');
    if (gsc.mode === 'api-error') throw Object.assign(new Error('Teapot says no'), { statusCode: 418 });
    res.status(200).json({ ok: true });
  },
}));

const notifications = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'throw' }));

vi.mock('../../../api/notifications.js', () => ({
  default: async (_req: unknown, res: { status(n: number): { json(b: unknown): void } }) => {
    if (notifications.mode === 'throw') throw new Error('inventory step failed');
    res.status(400).json({ error: 'Unknown action' });
  },
}));

let logs: string[];
let errors: string[];

beforeEach(() => {
  gsc.seen = [];
  gsc.mode = 'ok';
  notifications.mode = 'ok';
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const GSC_CALL = opsCall({ endpoint: 'gsc', action: 'gsc', functionUrl: '/api/gsc?action=status' });

describe('public surface', () => {
  it('the default fetch answers 404 with no body', async () => {
    const response = await worker.fetch();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('OpsApi.fetch answers 404 with no body', async () => {
    const response = await new OpsApi(testContext(), opsEnv()).fetch();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('the default export carries the queue consumer', () => {
    expect(typeof worker.queue).toBe('function');
  });
});

describe('OpsApi.handle: call check', () => {
  const bad: Array<[string, unknown]> = [
    ['no call', undefined],
    ['null call', null],
    ['version 2', { ...GSC_CALL, v: 2 }],
    ['version as string', { ...GSC_CALL, v: '1' }],
    ['absolute function URL', { ...GSC_CALL, functionUrl: 'https://elsewhere.test/api/gsc' }],
    ['protocol-relative function URL', { ...GSC_CALL, functionUrl: '//elsewhere.test/api/gsc' }],
    ['function URL not a string', { ...GSC_CALL, functionUrl: 42 }],
    ['unknown principal class', { ...GSC_CALL, principal: { class: 'ROOT' } }],
    ['principal missing', { ...GSC_CALL, principal: undefined }],
    ['action missing', { ...GSC_CALL, action: undefined }],
    ['requestId missing', { ...GSC_CALL, requestId: undefined }],
  ];

  for (const [name, call] of bad) {
    it(`${name} -> 500 text/plain, no handler runs`, async () => {
      const request = new Request('https://www.micronshub.eu/api/gsc?action=status');
      const response = await new OpsApi(testContext(), opsEnv()).handle(request, call as OpsCall);
      expect(await snapshot(response)).toMatchObject({ status: 500, body: 'Internal Server Error' });
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(gsc.seen).toEqual([]);
      expect(errors.join('\n')).toContain('[microns-ops] rpc call rejected');
    });
  }

  it('a valid call reaches the route of its function URL', async () => {
    const response = await invoke(OpsApi, GSC_CALL);
    expect(response.status).toBe(200);
    expect(gsc.seen).toEqual([{ method: 'GET', url: '/api/gsc?action=status' }]);
  });

  it('the function URL decides the route, not the path of the RPC request URL', async () => {
    const request = new Request('https://www.micronshub.eu/api/connector-status?x=1');
    const response = await new OpsApi(testContext(), opsEnv()).handle(request, GSC_CALL);
    expect(response.status).toBe(200);
    expect(gsc.seen).toEqual([{ method: 'GET', url: '/api/gsc?action=status' }]);
  });

  it('invalidCallReason accepts every principal class of the contract', () => {
    for (const cls of ['ANON', 'CUSTOMER', 'PARTNER', 'STAFF', 'ADMIN', 'MACHINE'] as const) {
      expect(invalidCallReason({ ...GSC_CALL, principal: { class: cls } })).toBeNull();
    }
  });
});

describe('app middleware', () => {
  it('a request without a registered call answers 500 text/plain and runs no handler', async () => {
    const response = await app.fetch(new Request('https://www.micronshub.eu/api/gsc'), opsEnv(), testContext());
    expect(await snapshot(response)).toMatchObject({ status: 500, body: 'Internal Server Error' });
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(gsc.seen).toEqual([]);
  });

  it('a call registered for another Request object does not count', async () => {
    const registered = new Request('https://www.micronshub.eu/api/gsc');
    registerCall(registered, GSC_CALL);
    const response = await app.fetch(new Request(registered), opsEnv(), testContext());
    expect(response.status).toBe(500);
    expect(gsc.seen).toEqual([]);
  });

  it('a registered call reaches the handler', async () => {
    const request = new Request('https://www.micronshub.eu/api/gsc?action=status');
    registerCall(request, GSC_CALL);
    const response = await app.fetch(request, opsEnv(), testContext());
    expect(response.status).toBe(200);
  });

  it('a path without a route answers 404 text/plain', async () => {
    const response = await invoke(OpsApi, opsCall({ endpoint: 'emails', action: 'email', functionUrl: '/api/emails' }), { method: 'POST', body: '{}' });
    expect(await snapshot(response)).toMatchObject({ status: 404, body: 'Not Found' });
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('a trailing slash reaches the same function', async () => {
    const response = await invoke(OpsApi, opsCall({ endpoint: 'gsc', action: 'gsc', functionUrl: '/api/gsc/' }));
    expect(response.status).toBe(200);
    expect(gsc.seen).toEqual([{ method: 'GET', url: '/api/gsc/' }]);
  });
});

describe('error boundary and logging', () => {
  it('a handler throw (not an ApiError) answers 500 text/plain and is logged without e-mail addresses', async () => {
    gsc.mode = 'throw';
    const response = await invoke(OpsApi, GSC_CALL);
    expect(await snapshot(response)).toMatchObject({ status: 500, body: 'Internal Server Error' });
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const logged = errors.join('\n');
    expect(logged).toContain('[microns-ops] handler failed endpoint=gsc action=gsc requestId=req-test-1');
    expect(logged).not.toContain('someone@example.test');
  });

  it('an error with a statusCode answers that status with its message (shim rule)', async () => {
    gsc.mode = 'api-error';
    const response = await invoke(OpsApi, GSC_CALL);
    expect(await snapshot(response)).toMatchObject({ status: 418, body: 'Teapot says no' });
  });

  it('one log line per call: endpoint, action, status, ms, principal class, requestId; no query, no e-mail', async () => {
    const call = opsCall({
      endpoint: 'gsc',
      action: 'gsc',
      functionUrl: '/api/gsc?site=private-value&email=someone%40example.test',
      principal: { class: 'STAFF', uid: 'u-1', email: 'someone@example.test', roles: ['admin'] },
      requestId: 'req-log-1',
    });
    await invoke(OpsApi, call);
    const line = logs.find((l) => l.startsWith('[microns-ops] api '));
    expect(line).toMatch(/^\[microns-ops\] api endpoint=gsc action=gsc status=200 ms=\d+ principal=STAFF requestId=req-log-1$/);
    const all = [...logs, ...errors].join('\n');
    expect(all).not.toContain('someone');
    expect(all).not.toContain('private-value');
  });

  it('the log line of a failed call carries status 500', async () => {
    gsc.mode = 'throw';
    await invoke(OpsApi, GSC_CALL);
    expect(logs.find((l) => l.startsWith('[microns-ops] api '))).toContain('status=500');
  });

  describe('the action is logged only as a sentinel or a short [a-z0-9-] value, else as "invalid"', () => {
    const invCall = (action: string): OpsCall =>
      opsCall({ endpoint: 'notifications', action, functionUrl: '/api/notifications', requestId: 'req-inv-1' });

    it('an inv-* action carrying an e-mail address is logged as "invalid" on the per-call line', async () => {
      const response = await invoke(OpsApi, invCall('inv-someone@example.test'), { method: 'POST' });
      expect(response.status).toBe(400);
      const line = logs.find((l) => l.startsWith('[microns-ops] api '));
      expect(line).toMatch(/^\[microns-ops\] api endpoint=notifications action=invalid status=400 ms=\d+ principal=STAFF requestId=req-inv-1$/);
      expect([...logs, ...errors].join('\n')).not.toContain('someone');
    });

    it('an inv-* action carrying an e-mail address is logged as "invalid" on the error-boundary line', async () => {
      notifications.mode = 'throw';
      const response = await invoke(OpsApi, invCall('inv-someone@example.test'), { method: 'POST' });
      expect(response.status).toBe(500);
      expect(errors.join('\n')).toContain('[microns-ops] handler failed endpoint=notifications action=invalid requestId=req-inv-1');
      expect([...logs, ...errors].join('\n')).not.toContain('someone');
    });

    it('an action longer than 40 characters or with other characters is logged as "invalid"', async () => {
      for (const action of [`inv-${'x'.repeat(40)}`, 'inv-Label', 'inv label', 'inv-"x"', '#a@b.example', '']) {
        logs = [];
        await invoke(OpsApi, invCall(action), { method: 'POST' });
        expect(logs.find((l) => l.startsWith('[microns-ops] api ')), action).toContain(' action=invalid ');
      }
    });

    it('sentinels and short [a-z0-9-] actions are logged as they are', async () => {
      for (const action of ['inv-label', 'nest', 'partner', '#options', '#method', '#unknown-step', 'x'.repeat(40)]) {
        logs = [];
        await invoke(OpsApi, invCall(action), { method: 'POST' });
        expect(logs.find((l) => l.startsWith('[microns-ops] api ')), action).toContain(` action=${action} `);
      }
    });
  });
});
