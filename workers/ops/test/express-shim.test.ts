// Hono adapter (src/compat/express-shim.ts): the handler sees the call's function URL and the request body (or the
// overrides a route passes), GET/HEAD carry no body, the body can be read again after a route inspected it, work
// after the answer goes to ctx.waitUntil, and a module loads only when its route is first called.

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { VercelHandler } from '../../shared/src/compat/vercel-node';
import { requestBytes, runVercel, vercelRoute } from '../src/compat/express-shim';
import type { OpsHono } from '../src/env';
import { opsCall, opsEnv, testContext } from './helpers/ops';

const echo: VercelHandler = (req, res) => {
  const raw: Uint8Array = req.rawBody;
  res.status(200).json({ url: req.url, method: req.method, raw: new TextDecoder().decode(raw), body: req.body ?? null });
};

function appWith(route: (app: Hono<OpsHono>) => void, functionUrl = '/api/gsc?from=call'): Hono<OpsHono> {
  const app = new Hono<OpsHono>();
  app.use('*', async (c, next) => {
    c.set('call', opsCall({ endpoint: 'gsc', action: 'gsc', functionUrl }));
    await next();
  });
  route(app);
  return app;
}

describe('runVercel', () => {
  it('req.url is the function URL of the call, not the request URL', async () => {
    const app = appWith((a) => a.all('/api/gsc', (c) => runVercel(c, echo)));
    const response = await app.fetch(new Request('https://www.micronshub.eu/api/gsc?from=request'), opsEnv(), testContext());
    expect(await response.json()).toMatchObject({ url: '/api/gsc?from=call', method: 'GET', raw: '', body: '' });
  });

  it('the request body reaches the handler; GET and HEAD carry none', async () => {
    const app = appWith((a) => a.all('/api/gsc', (c) => runVercel(c, echo)));
    const post = await app.fetch(
      new Request('https://www.micronshub.eu/api/gsc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }),
      opsEnv(),
      testContext(),
    );
    expect(await post.json()).toMatchObject({ method: 'POST', raw: '{"a":1}', body: { a: 1 } });
  });

  it('overrides: functionUrl and body (null sends no body even on POST)', async () => {
    const app = appWith((a) =>
      a.all('/api/gsc', async (c) => {
        const first = await requestBytes(c);
        expect(new TextDecoder().decode(first!)).toBe('original');
        // The cached body can be read again after a route inspected it.
        expect(new TextDecoder().decode((await requestBytes(c))!)).toBe('original');
        return runVercel(c, echo, { functionUrl: '/api/other?x=1', body: new TextEncoder().encode('replaced') });
      }),
    );
    const response = await app.fetch(
      new Request('https://www.micronshub.eu/api/gsc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'original' }),
      opsEnv(),
      testContext(),
    );
    expect(await response.json()).toMatchObject({ url: '/api/other?x=1', raw: 'replaced', body: 'replaced' });

    const nullBody = appWith((a) => a.all('/api/gsc', (c) => runVercel(c, echo, { body: null })));
    const answer = await nullBody.fetch(new Request('https://www.micronshub.eu/api/gsc', { method: 'POST', body: 'ignored' }), opsEnv(), testContext());
    expect(await answer.json()).toMatchObject({ raw: '' });
  });

  it('work after the answer is handed to ctx.waitUntil; without a context the answer still arrives', async () => {
    const late: VercelHandler = (_req, res) => {
      res.status(200).json({ ok: true });
      return new Promise((resolve) => setTimeout(resolve, 5));
    };
    const app = appWith((a) => a.all('/api/gsc', (c) => runVercel(c, late)));
    const ctx = testContext();
    expect((await app.fetch(new Request('https://www.micronshub.eu/api/gsc'), opsEnv(), ctx)).status).toBe(200);
    expect(ctx.pending).toHaveLength(1);
    expect((await app.fetch(new Request('https://www.micronshub.eu/api/gsc'), opsEnv())).status).toBe(200);
  });
});

describe('vercelRoute', () => {
  it('loads the module on the first request, not when the route is registered', async () => {
    const load = vi.fn(async () => ({ default: echo }));
    const app = appWith((a) => a.all('/api/gsc', vercelRoute(load)));
    expect(load).not.toHaveBeenCalled();
    await app.fetch(new Request('https://www.micronshub.eu/api/gsc'), opsEnv(), testContext());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a timeout option shortens the deadline (504 text/plain)', async () => {
    const app = appWith((a) => a.all('/api/gsc', vercelRoute(async () => ({ default: () => new Promise(() => {}) }), { timeoutMs: 20 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await app.fetch(new Request('https://www.micronshub.eu/api/gsc'), opsEnv(), testContext());
    expect(response.status).toBe(504);
    expect(await response.text()).toBe('Gateway Timeout');
    vi.restoreAllMocks();
  });
});
