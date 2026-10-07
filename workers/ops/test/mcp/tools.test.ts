// Remote tools beyond the query parity: the new agent-layer tools, decide_approval through decide(), queued scans
// (directory-scan, tender-scan, funded-scan), the in-process CSV export with its cut, GSC calls and e-mail masking.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256hex } from '../../src/agents/ids';
import { isDirectoryScanMessage } from '../../src/queues/messages';
import type { ScrapeMessage } from '../../src/queues/messages';
import { SCRAPERS_OFF_MESSAGE } from '../../src/mcp/tools/companies';
import { CSV_TEXT_LIMIT_BYTES } from '../../src/mcp/tools/tenders';
import { MCP_DISABLED_TEXT } from '../../src/mcp/tools/agents';
import { recordingQueue } from '../helpers/ops';
import { NOW, STAFF_UID, connectV1, mcpHarness, textOf } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALL_WRITES = { enabled: true, value: { writes: true, write_tools: ['scan_directory', 'trigger_funding_scan', 'start_quote', 'gsc_submit_for_indexing'] } };

const SCRAPERS_ON = { enabled: true, value: {}, updated_at: '2026-10-05T08:00:00Z', rev: 1 };

/** A recording SCRAPES queue for the harness env and a reader of the message bodies sent to it. */
function scrapesQueue(): { env: { SCRAPES: Queue<ScrapeMessage> }; sent(): ScrapeMessage[] } {
  const q = recordingQueue();
  return { env: { SCRAPES: q.binding }, sent: () => q.sent.map((s) => s.body) };
}

describe('new read tools', () => {
  it('list_inbound_emails masks senders and filters by the default tenant', async () => {
    const h = await mcpHarness({
      sbRoute: ({ table }) => (table === 'inbound_emails' ? { body: [{ id: 'e1', mailbox: 'rfq', kind: 'rfq', status: 'parsed', from_email: 'buyer.name@example.de', subject: 'RFQ brackets', received_at: '2026-10-05T08:00:00Z', rfq_id: null }] } : undefined),
    });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'list_inbound_emails', arguments: { status: 'parsed' } }));
    expect(text).toContain('b***@example.de');
    expect(text).not.toContain('buyer.name@example.de');
    const req = h.sb.requests.find((r) => r.path.startsWith('/inbound_emails'));
    expect(decodeURIComponent(req?.path ?? '')).toContain(`tenant_id=eq.${TENANT}`);
    expect(decodeURIComponent(req?.path ?? '')).toContain('status=eq.parsed');
    await client.close();
  });

  it('list_rfqs, list_orders, list_agent_runs and list_pending_approvals read with tenant filters; no token hashes are selected', async () => {
    const h = await mcpHarness();
    const client = await connectV1(h, await h.token());
    for (const name of ['list_rfqs', 'list_orders', 'list_agent_runs', 'list_pending_approvals']) {
      await client.callTool({ name, arguments: {} });
    }
    const paths = h.sb.requests.map((r) => decodeURIComponent(r.path));
    for (const table of ['rfqs', 'orders', 'agent_runs']) expect(paths.some((p) => p.startsWith(`/${table}?`) && p.includes(`tenant_id=eq.${TENANT}`)), table).toBe(true);
    expect(paths.some((p) => p.includes('approval_token_sha256'))).toBe(false);
    expect(paths.find((p) => p.startsWith('/agent_runs?') && p.includes('status=eq.waiting_human'))).toBeDefined();
    await client.close();
  });

  it('get_rfq refuses a non-uuid id without a query; get_stock_summary calls the RPC with the tenant', async () => {
    const h = await mcpHarness({ sbRoute: ({ table }) => (table === 'rpc/get_stock_summary' ? { body: [{ material_name: 'S235 sheet', category: 'steel', thickness_mm: 2, full_sheets: 3, remnant_count: 1, total_area_mm2: 1000, total_quantity: 3, base_unit: 'sheet', total_value: 120, is_low_stock: true }] } : undefined) });
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'get_rfq', arguments: { rfq_id: "x' or 1=1" } }))).toContain('RFQ not found');
    expect(h.sb.requests).toHaveLength(0);
    const stock = textOf(await client.callTool({ name: 'get_stock_summary', arguments: {} }));
    expect(stock).toContain('[LOW] S235 sheet');
    expect(h.sb.requests[0]).toMatchObject({ method: 'POST', path: '/rpc/get_stock_summary', body: { p_tenant_id: TENANT } });
    await client.close();
  });

  it('search_similar_quotes embeds the text and queries the tenant namespace', async () => {
    const h = await mcpHarness();
    const embedded = await h.ports.embed.embed(['2 mm stainless bracket'], { agent: 't', run_id: 'r', tenant_id: TENANT, step: 's' });
    await h.ports.vector.upsert(TENANT, [{ id: 'q1:1', values: embedded.vectors[0], metadata: { quote_workflow_id: 'q1', rfq_id: 'rfq-1', line_no: 1, process: 'sheet_metal', material_family: 'stainless', material_grade: '1.4301', thickness_mm: 2, qty: 50, unit_price_eur: 4.2, line_total_eur: 210, outcome: 'won', sent_at_unix: 1, rules_version: 'v1' } }]);
    await h.ports.vector.upsert('another-tenant', [{ id: 'q9:1', values: embedded.vectors[0], metadata: { quote_workflow_id: 'q9', rfq_id: 'rfq-9', line_no: 1, process: 'sheet_metal', material_family: 'x', material_grade: 'x', thickness_mm: 1, qty: 1, unit_price_eur: 1, line_total_eur: 1, outcome: 'won', sent_at_unix: 1, rules_version: 'v1' } }]);
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'search_similar_quotes', arguments: { text: '2 mm stainless bracket', top_k: 50 } }));
    expect(text).toContain('RFQ rfq-1 line 1');
    expect(text).not.toContain('rfq-9');
    await client.close();
  });

  it('get_rfq lists the linked inbound e-mails with masked sender addresses', async () => {
    const RFQ = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
    const h = await mcpHarness({
      sbRoute: ({ table }) => {
        if (table === 'rfqs') return { body: { id: RFQ, rfq_number: 'RFQ-1', status: 'pending', parts_details: [] } };
        if (table === 'inbound_emails') return { body: [{ id: 'e1', subject: 'Brackets', status: 'rfq_created', received_at: '2026-10-05T08:00:00Z', from_email: 'buyer.name@example.de' }] };
        return undefined;
      },
    });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'get_rfq', arguments: { rfq_id: RFQ } }));
    expect(text).toContain('2026-10-05T08:00:00Z rfq_created | b***@example.de | Brackets');
    expect(text).not.toContain('buyer.name@example.de');
    await client.close();
  });

  it('mcp_status answers the disabled text', async () => {
    const h = await mcpHarness({ flag: null });
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'mcp_status', arguments: {} }))).toBe(MCP_DISABLED_TEXT);
    await client.close();
  });
});

describe('decide_approval', () => {
  async function waitingRun(h: Awaited<ReturnType<typeof mcpHarness>>, output: Record<string, unknown>) {
    const hash = await sha256hex('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const [row] = h.ports.db.seed('agent_runs', [{ agent: 'eval', trigger: 'dashboard', idempotency_key: `test-card:${crypto.randomUUID()}`, status: 'waiting_human', approval_token_sha256: hash, output }]);
    return row.id as string;
  }

  it('decides a test card with an allowed verb through decide() (channel mcp, actor user:<uid>)', async () => {
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true } } });
    const runId = await waitingRun(h, { card_kind: 'test', allowed_verbs: ['dismiss'], card: { title: 'Relay test' } });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'decide_approval', arguments: { run_id: runId, verb: 'dismiss', note: 'checked' } }));
    expect(text).toContain(`run ${runId}, verb dismiss, outcome dismissed`);
    const row = h.ports.db.rows('agent_runs').find((r) => r.id === runId);
    expect(row).toMatchObject({ status: 'succeeded', approval_token_sha256: null });
    expect(row?.human_action).toMatchObject({ channel: 'mcp', actor: `user:${STAFF_UID}`, verb: 'dismiss' });
    // Decided once: a second call finds no pending decision.
    expect((await client.callTool({ name: 'decide_approval', arguments: { run_id: runId, verb: 'dismiss' } })).isError).toBe(true);
    await client.close();
  });

  it('a verb outside the allowed verbs is refused before the claim', async () => {
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true } } });
    const runId = await waitingRun(h, { card_kind: 'test', allowed_verbs: ['dismiss'], card: { title: 'Relay test' } });
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'decide_approval', arguments: { run_id: runId, verb: 'approve' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('verb_not_allowed');
    expect(h.ports.db.rows('agent_runs').find((r) => r.id === runId)?.status).toBe('waiting_human');
    await client.close();
  });
});

describe('queued and in-process work', () => {
  it('trigger_country_scan queues a tender-scan for a code with a connector only', async () => {
    const q = scrapesQueue();
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true } }, env: q.env });
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'trigger_country_scan', arguments: { country_code: 'de' } }))).toMatch(/^Scan for DE queued \(run_id [0-9a-f-]{36}\)/);
    expect((await client.callTool({ name: 'trigger_country_scan', arguments: { country_code: 'XX' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'trigger_country_scan', arguments: { country_code: 'http://x' } })).isError).toBe(true);
    expect(q.sent()).toEqual([expect.objectContaining({ v: 1, kind: 'tender-scan', params: { country_code: 'DE' }, requested_by: 'ADMIN:mcp' })]);
    await client.close();
  });

  it('trigger_funding_scan queues a funded-scan with priority 1-3', async () => {
    const q = scrapesQueue();
    const h = await mcpHarness({ flag: ALL_WRITES, env: q.env });
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'trigger_funding_scan', arguments: { priority: 2 } }))).toContain('Funding scan queued');
    expect((await client.callTool({ name: 'trigger_funding_scan', arguments: { priority: 7 } })).isError).toBe(true);
    expect(q.sent().map((m) => m.params)).toEqual([{ priority: 2 }]);
    await client.close();
  });

  it('run_saved_search opens a growth.scrapers run and queues a directory-scan envelope', async () => {
    const SS = '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
    const q = scrapesQueue();
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true } }, env: q.env, sbRoute: ({ table, headers }) => (table === 'saved_searches' && (headers.get('accept') ?? '').includes('vnd.pgrst.object') ? { body: { id: SS, name: 'Austrian CNC', source: 'wlw', search_url: 'https://www.wlw.at/de/suche/cnc' } } : undefined) });
    const client = await connectV1(h, await h.token());
    // Flag agent.growth.scrapers off (the default): refused, no run opened, nothing queued.
    const off = await client.callTool({ name: 'run_saved_search', arguments: { saved_search_id: SS } });
    expect(off.isError).toBe(true);
    expect(textOf(off)).toBe(`Error: ${SCRAPERS_OFF_MESSAGE}`);
    expect(q.sent()).toEqual([]);
    expect(h.ports.db.rows('agent_runs').filter((r) => r.agent === 'growth.scrapers')).toEqual([]);
    h.kv.setJson('agent.growth.scrapers', SCRAPERS_ON);
    // The refused call holds its write key until the 10-minute window ends.
    h.ports.clock.set(new Date(NOW.getTime() + 600_000));
    const text = textOf(await client.callTool({ name: 'run_saved_search', arguments: { saved_search_id: SS } }));
    expect(text).toContain('Saved search "Austrian CNC" queued');
    const [msg] = q.sent();
    expect(isDirectoryScanMessage(msg)).toBe(true);
    expect(msg).toMatchObject({ params: { url: 'https://www.wlw.at/de/suche/cnc', source: 'wlw', max_pages: 3, enrich_profiles: false, saved_search_id: SS } });
    const run = h.ports.db.rows('agent_runs').find((r) => r.agent === 'growth.scrapers');
    expect(run).toMatchObject({ id: msg.run_id, trigger: 'mcp', status: 'running', subject_type: 'saved_search', subject_id: SS });
    expect(String(run?.idempotency_key)).toMatch(/^directory-scan:[0-9a-f-]{36}$/);
    expect(textOf(await client.callTool({ name: 'run_saved_search', arguments: { saved_search_id: '12' } }))).toBe('Saved search not found: 12');
    await client.close();
  });

  it('scan_directory: more than 3 pages are queued; up to 3 run in the call through the robots gate', async () => {
    const q = scrapesQueue();
    const h = await mcpHarness({ flag: ALL_WRITES, env: q.env });
    const client = await connectV1(h, await h.token());
    const off = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.europages.de/companies/germany/cnc.html', maxPages: 25 } });
    expect(textOf(off)).toBe(`Error: ${SCRAPERS_OFF_MESSAGE}`);
    expect(q.sent()).toEqual([]);
    h.kv.setJson('agent.growth.scrapers', SCRAPERS_ON);
    h.ports.clock.set(new Date(NOW.getTime() + 600_000));
    const queued = textOf(await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.europages.de/companies/germany/cnc.html', maxPages: 25 } }));
    expect(queued).toContain('up to 10 pages');
    expect(q.sent()[0]).toMatchObject({ kind: 'directory-scan', params: { max_pages: 10, source: 'europages' } });
    // In-call scan: the harness scraper answers 404 for robots.txt (no robots.txt -> allowed) and 404 for the page:
    // no page read, so the run closes failed (pages_failed) and the answer is an error.
    const sync = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.europages.de/companies/germany/laser.html', maxPages: 2 } });
    expect(textOf(sync)).toContain('Pages scanned: 0 of up to 2');
    expect(sync.isError).toBe(true);
    const runs = h.ports.db.rows('agent_runs').filter((r) => r.agent === 'growth.scrapers');
    expect(runs.map((r) => r.status).sort()).toEqual(['failed', 'running']);
    expect(runs.find((r) => r.status === 'failed')).toMatchObject({ error: 'pages_failed', output: { pages: 0, errors: 2 } });
    expect(h.ports.db.rows('scan_logs')).toHaveLength(1);
    await client.close();
  });

  it('export_tenders_csv runs the tenders route in-process and cuts at 200 KB on a record boundary', async () => {
    const header = 'id,title\n';
    const row = (i: number) => `${i},"Tender ${'x'.repeat(90)}"`;
    const csv = header + Array.from({ length: 3000 }, (_, i) => row(i)).join('\n');
    const h = await mcpHarness({ inprocess: async () => new Response(csv, { headers: { 'content-type': 'text/csv' } }) });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'export_tenders_csv', arguments: { country: 'GR', min_score: 50, relevant_only: true } }));
    expect(h.inprocessCalls).toEqual([{ endpoint: 'tenders', action: 'list', functionUrl: '/api/tenders?export=csv&country=GR&min_score=50&relevant_only=true', method: 'GET', headers: { Accept: 'text/csv' } }]);
    const [body, note] = text.split('\n\n[Truncated: ');
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(CSV_TEXT_LIMIT_BYTES);
    expect(body.endsWith('"')).toBe(true);
    expect(note).toMatch(/^first \d+ of 3000 tenders shown/);
    await client.close();
  });

  it('start_quote calls the agent start action in-process', async () => {
    const RFQ = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
    const h = await mcpHarness({ flag: ALL_WRITES, inprocess: async () => Response.json({ v: 1, ok: true, instance_id: `quote-${RFQ}-v2`, created: true }) });
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'start_quote', arguments: { rfq_id: RFQ } }))).toBe(`Quote agent started: instance quote-${RFQ}-v2`);
    expect(h.inprocessCalls[0]).toEqual({ endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', method: 'POST', body: { v: 1, kind: 'quote', rfq_id: RFQ } });
    await client.close();
  });

  it('GSC tools call the Search Console module with the computed window; submissions name the actor', async () => {
    const h = await mcpHarness({ flag: ALL_WRITES });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'gsc_get_top_queries', arguments: { days: 7, limit: 3 } }));
    expect(text).toContain('cnc machining');
    expect(h.gscCalls[0]).toEqual({ fn: 'searchAnalytics', args: [{ startDate: '2026-09-25', endDate: '2026-10-02', dimensions: ['query'], dimensionFilterGroups: undefined, rowLimit: 3 }] });
    await client.callTool({ name: 'gsc_submit_for_indexing', arguments: { urls: ['https://www.micronshub.eu/en/'] } });
    expect(h.gscCalls[1]).toEqual({ fn: 'submitBatchForIndexing', args: [['https://www.micronshub.eu/en/'], 'URL_UPDATED', `user:${STAFF_UID}`] });
    await client.close();
  });

  it('get_companies masks e-mail addresses', async () => {
    const h = await mcpHarness({ sbRoute: ({ table }) => (table === 'company_leads' ? { body: [{ id: 'c1', company_name: 'Example GmbH', source: 'wlw', city: 'Wien', country: 'AT', scraped_emails: ['office@example.at'], email: 'info@example.at', outreach_status: 'email_found', email_scrape_status: 'scraped' }] } : undefined) });
    const client = await connectV1(h, await h.token());
    const text = textOf(await client.callTool({ name: 'get_companies', arguments: {} }));
    expect(text).toContain('o***@example.at');
    expect(text).not.toMatch(/office@|info@/);
    await client.close();
  });
});
