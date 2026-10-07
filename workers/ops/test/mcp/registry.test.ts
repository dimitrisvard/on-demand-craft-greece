// X-2 stage matrix of flag mcp.remote: exact tool, resource and prompt name sets per stage, annotations and the
// write notice, with a v1 and a v2 MCP client against handleMcp.

import { Client as ClientV2, StreamableHTTPClientTransport as TransportV2 } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageOf, toolsForStage, WRITE_NOTICE } from '../../src/mcp/registry';
import { ALL_TOOL_DEFS } from '../../src/mcp/server';
import { MCP_URL, connectV1, mcpHarness, textOf, withHost } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

export const STAGE1_TOOLS = [
  // 25 ported read tools
  'get_leads', 'get_lead_detail', 'get_lead_stats', 'search_leads', 'manage_keywords', 'manage_subreddits', 'get_companies',
  'get_saved_searches', 'get_tenders', 'get_tender_detail', 'get_tender_stats', 'search_tenders', 'get_connector_status',
  'export_tenders_csv', 'get_funded_startups', 'get_funded_startup_detail', 'get_funding_stats', 'gsc_search_analytics',
  'gsc_get_top_queries', 'gsc_get_top_pages', 'gsc_compare_periods', 'gsc_inspect_url', 'gsc_get_unindexed_pages',
  'gsc_get_indexing_quota', 'gsc_list_sitemaps',
  // 10 new read tools
  'list_rfqs', 'get_rfq', 'list_inbound_emails', 'get_quote_workflow', 'list_pending_approvals', 'list_orders', 'get_order',
  'get_stock_summary', 'list_agent_runs', 'search_similar_quotes',
].sort();
export const STAGE2_TOOLS = ['decide_approval', 'update_lead_status', 'update_tender_status', 'trigger_country_scan', 'run_saved_search'].sort();
export const OPT_IN_TOOLS = [
  'score_lead', 'save_response_draft', 'add_lead_note', 'manage_keywords', 'manage_subreddits', 'scan_directory', 'enrich_company_emails',
  'update_company', 'update_startup_outreach', 'trigger_funding_scan', 'gsc_submit_for_indexing', 'gsc_submit_sitemap', 'start_quote',
].sort();
const RESOURCES = ['leads://keywords', 'leads://subreddits', 'leads://today'];
const PROMPTS = ['daily_lead_review', 'draft_lead_response'];

async function listed(flag: Record<string, unknown> | null) {
  const h = await mcpHarness({ flag });
  const client = await connectV1(h, await h.token());
  const tools = (await client.listTools()).tools;
  const caps = client.getServerCapabilities() ?? {};
  const resources = caps.resources ? (await client.listResources()).resources.map((r) => r.uri).sort() : [];
  const prompts = caps.prompts ? (await client.listPrompts()).prompts.map((p) => p.name).sort() : [];
  await client.close();
  return { h, tools, names: tools.map((t) => t.name).sort(), resources, prompts };
}

describe('X-2 stages', () => {
  it('counts of the catalogue: 35 read, 5 stage-2, 13 opt-in, 1 status', () => {
    expect(STAGE1_TOOLS).toHaveLength(35);
    expect(new Set(ALL_TOOL_DEFS.map((d) => d.name)).size).toBe(39 + 12 + 1);
    expect(ALL_TOOL_DEFS.filter((d) => d.stage === 'opt').map((d) => d.name).sort()).toEqual(OPT_IN_TOOLS);
    expect(ALL_TOOL_DEFS.filter((d) => d.stage === 's2').map((d) => d.name).sort()).toEqual(STAGE2_TOOLS);
    expect(ALL_TOOL_DEFS.filter((d) => d.stage === 's1').map((d) => d.name).sort()).toEqual(STAGE1_TOOLS);
  });

  it.each([
    ['missing', null],
    ['off', { enabled: false, value: { writes: true } }],
    ['malformed', { enabled: 'yes' }],
  ])('flag %s -> only mcp_status, no resources or prompts', async (_name, flag) => {
    const { h, names, resources, prompts } = await listed(flag as Record<string, unknown> | null);
    expect(names).toEqual(['mcp_status']);
    expect(resources).toEqual([]);
    expect(prompts).toEqual([]);
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'mcp_status', arguments: {} }))).toBe('Remote MCP is disabled (flag mcp.remote)');
    const refused = await client.callTool({ name: 'get_leads', arguments: {} }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
    expect((refused as { isError?: boolean }).isError).toBe(true);
    await client.close();
  });

  it('a KV error reads as off', async () => {
    const h = await mcpHarness();
    h.kv.failWith = new Error('kv down');
    const client = await connectV1(h, await h.token());
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['mcp_status']);
    await client.close();
  });

  it('enabled -> 35 read tools, 3 resources, 2 prompts; manage_* list-only', async () => {
    const { names, resources, prompts, tools } = await listed({ enabled: true, value: { writes: false } });
    expect(names).toEqual(STAGE1_TOOLS);
    expect(resources).toEqual(RESOURCES);
    expect(prompts).toEqual(PROMPTS);
    const keywords = tools.find((t) => t.name === 'manage_keywords');
    expect((keywords?.inputSchema.properties as Record<string, { enum?: string[] }>).action.enum).toEqual(['list']);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.description, t.name).not.toContain(WRITE_NOTICE);
    }
  });

  it('writes -> + the 5 stage-2 tools, with write annotations and the notice', async () => {
    const { names, tools } = await listed({ enabled: true, value: { writes: true } });
    expect(names).toEqual([...STAGE1_TOOLS, ...STAGE2_TOOLS].sort());
    for (const name of STAGE2_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t?.annotations?.readOnlyHint, name).toBe(false);
      expect(t?.annotations?.destructiveHint, name).toBe(false);
      expect(t?.description?.endsWith(WRITE_NOTICE), name).toBe(true);
    }
    expect(tools.find((t) => t.name === 'trigger_country_scan')?.annotations?.openWorldHint).toBe(true);
    expect(tools.find((t) => t.name === 'update_lead_status')?.annotations?.openWorldHint).toBeUndefined();
  });

  it('write_tools adds only the named opt-in tools (the full manage_keywords replaces the list-only one); unknown names are ignored', async () => {
    const { names, tools } = await listed({ enabled: true, value: { writes: true, write_tools: ['manage_keywords', 'start_quote', 'drop_database', 'get_leads'] } });
    expect(names).toEqual([...STAGE1_TOOLS, ...STAGE2_TOOLS, 'start_quote'].sort());
    const keywords = tools.find((t) => t.name === 'manage_keywords');
    expect((keywords?.inputSchema.properties as Record<string, { enum?: string[] }>).action.enum).toEqual(['list', 'add', 'remove', 'toggle']);
    expect(keywords?.description?.endsWith(WRITE_NOTICE)).toBe(true);
    expect(names.filter((n) => n === 'manage_keywords')).toHaveLength(1);
  });

  it('write_tools without writes: true adds nothing', () => {
    const stage = stageOf({ enabled: true, mode: 'shadow', value: { write_tools: ['start_quote'] } });
    expect(stage).toEqual({ name: 'read', writeTools: [] });
    expect(toolsForStage(ALL_TOOL_DEFS, stage).map((d) => d.name).sort()).toEqual(STAGE1_TOOLS);
  });

  it('a v2 client (@modelcontextprotocol/client 2.0.0) lists and calls tools', async () => {
    const h = await mcpHarness();
    const token = await h.token();
    const transport = new TransportV2(new URL(MCP_URL), {
      fetch: (url: string | URL, init?: RequestInit) => h.call(withHost(new Request(url, init))),
      requestInit: { headers: { 'Cf-Access-Jwt-Assertion': token } },
    });
    const client = new ClientV2({ name: 't1-v2', version: '2.0.0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(STAGE1_TOOLS);
    const result = await client.callTool({ name: 'get_leads', arguments: { limit: 5 } });
    expect(textOf(result)).toBe('No leads found matching the specified criteria.');
    await client.close();
  });
});
