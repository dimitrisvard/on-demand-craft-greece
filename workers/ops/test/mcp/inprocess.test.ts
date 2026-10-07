// X-5 in-process calls: the shared scrape rules run before any in-process handler (the site gate does not run
// in-process); allowed calls reach the ops route with the MCP staff principal; the URL-taking tools refuse targets
// outside the rules before anything is fetched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '../../src/mcp/context';
import { callInProcess } from '../../src/mcp/inprocess';
import { STAFF_UID, connectV1, mcpHarness, textOf } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function context(): Promise<{ ctx: McpContext; h: Awaited<ReturnType<typeof mcpHarness>> }> {
  const h = await mcpHarness();
  const ctx = {
    env: h.env,
    exec: h.ctx,
    principal: { class: 'STAFF', uid: STAFF_UID, roles: ['sales_rep'] },
    stage: { name: 'write', writeTools: [] },
    tenantId: '00000000-0000-0000-0000-000000000001',
    deps: h.deps,
    actor: `user:${STAFF_UID}`,
    sb: () => { throw new Error('unused'); },
    ports: () => h.ports,
    scraper: () => { throw new Error('unused'); },
  } as unknown as McpContext;
  return { ctx, h };
}

describe('X-5 scrape rules before in-process calls', () => {
  it.each([
    ['an IP literal', ['http://127.0.0.1/']],
    ['a decimal IP', ['http://2130706433/']],
    ['localhost', ['http://localhost:8080/']],
    ['our own zone', ['https://www.micronshub.eu/en/contact']],
    ['a platform host', ['https://x.workers.dev/']],
    ['more than 25 URLs', Array.from({ length: 26 }, (_, i) => `https://example${i}.com/`)],
    ['no URL', []],
    ['not a list', 'https://example.com/'],
  ])('scrape-website with %s -> 400 url_not_allowed, no handler runs', async (_name, urls) => {
    const { ctx } = await context();
    const fetchSpy = vi.fn(async () => new Response('<html></html>'));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callInProcess(ctx, { endpoint: 'scrape-website', action: 'post', functionUrl: '/api/scrape-website', method: 'POST', body: { urls } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'url_not_allowed' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an allowed URL runs the Phase 2 scrape-website handler in-process', async () => {
    const { ctx } = await context();
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response('<html><title>Example GmbH</title><a href="mailto:info@example.com">mail</a></html>', { headers: { 'content-type': 'text/html' } });
    }));
    const res = await callInProcess(ctx, { endpoint: 'scrape-website', action: 'post', functionUrl: '/api/scrape-website', method: 'POST', body: { urls: ['https://www.example.com/'] } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ url: string; emails: string[] }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].url).toBe('https://www.example.com/');
    expect(fetched[0]).toBe('https://www.example.com/');
  });

  it('only the three tool calls are possible', async () => {
    const { ctx } = await context();
    for (const call of [
      { endpoint: 'tenders', action: 'patch', functionUrl: '/api/tenders', method: 'POST' },
      { endpoint: 'agent', action: 'flag', functionUrl: '/api/agent/flag', method: 'POST' },
      { endpoint: 'scrape-website', action: 'get', functionUrl: '/api/scrape-website', method: 'GET' },
    ] as const) {
      await expect(callInProcess(ctx, call)).rejects.toThrow(/not allowed/);
    }
  });

  it('start in-process: the agent start route sees the MCP staff principal and creates the quote instance', async () => {
    const { ctx, h } = await context();
    h.kv.setJson('agent.quote', { enabled: true, value: { mode: 'assist' } });
    const RFQ = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith('/rfqs')) return Response.json([{ id: RFQ, tenant_id: '00000000-0000-0000-0000-000000000001' }]);
      if (url.pathname.endsWith('/quote_workflows')) return Response.json([]);
      return new Response('[]', { status: 404 });
    }));
    const res = await callInProcess(ctx, { endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', method: 'POST', body: { v: 1, kind: 'quote', rfq_id: RFQ } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 1, ok: true, instance_id: `quote-${RFQ}-v1`, created: true });
    const created = (h.env.QUOTE as unknown as { created: Array<{ id: string; params: { requested_by: string } }> }).created;
    expect(created.map((c) => c.id)).toEqual([`quote-${RFQ}-v1`]);
    expect(created[0].params.requested_by).toBe(`user:${STAFF_UID}`);
  });
});

describe('URL-taking tools', () => {
  it('scan_directory refuses a non-directory host and an IP literal before any fetch', async () => {
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true, write_tools: ['scan_directory', 'enrich_company_emails'] } } });
    const client = await connectV1(h, await h.token());
    for (const url of ['https://evil.example/europages/x', 'http://169.254.169.254/wlw.de/x', 'https://www.wlw.de.evil.example/']) {
      const result = await client.callTool({ name: 'scan_directory', arguments: { url } });
      expect(result.isError, url).toBe(true);
    }
    expect(h.ports.db.rows('agent_runs').filter((r) => r.agent === 'growth.scrapers')).toHaveLength(0);
    await client.close();
  });

  it('enrich_company_emails skips websites outside the rules without an in-process call', async () => {
    const h = await mcpHarness({
      flag: { enabled: true, value: { writes: true, write_tools: ['enrich_company_emails'] } },
      sbRoute: ({ method, table }) => (method === 'GET' && table === 'company_leads'
        ? { body: [{ id: 'c1', company_name: 'Internal', website_url: 'http://10.0.0.5/' }, { id: 'c2', company_name: 'Example GmbH', website_url: 'https://www.example.de/' }] }
        : undefined),
      inprocess: async () => Response.json({ results: [{ emails: ['sales@example.de'] }] }),
    });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'enrich_company_emails', arguments: {} }));
    expect(text).toContain('Internal: website not allowed by the scrape rules, skipped');
    expect(text).toContain('Example GmbH: s***@example.de');
    expect(h.inprocessCalls.map((c) => (c.body as { urls: string[] }).urls)).toEqual([['https://www.example.de/']]);
    await client.close();
  });
});
