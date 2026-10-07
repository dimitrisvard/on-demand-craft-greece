// createMicronsMcpServer(ctx): the MCP SDK v2 server of one request (the stateless handler builds one per request).
// The tool set, resources and prompts depend on the stage of flag mcp.remote (registry.ts); every tools/call goes
// through the audit wrapper (audit.ts). Server name and version identify the remote port of the local server
// (mcp-server/src/index.ts:168-172).

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { auditedCall } from './audit';
import type { McpContext } from './context';
import { PROMPTS } from './prompts';
import { annotationsOf, descriptionOf, toolsForStage, type ToolDef } from './registry';
import { RESOURCES } from './resources';
import { AGENT_TOOLS } from './tools/agents';
import { COMPANY_TOOLS } from './tools/companies';
import { GSC_TOOLS } from './tools/gsc';
import { LEAD_TOOLS } from './tools/leads';
import { ORDER_TOOLS } from './tools/orders';
import { RFQ_TOOLS } from './tools/rfqs';
import { STARTUP_TOOLS } from './tools/startups';
import { TENDER_TOOLS } from './tools/tenders';

export const SERVER_INFO = {
  name: 'micronshub-remote',
  version: '1.0.0',
  description: 'Microns Hub remote MCP: leads, companies, tenders, funded startups, Search Console, RFQs, quotes, orders, stock and agent approvals',
};

/** Every tool definition (both variants of the list-only/full tools). */
export const ALL_TOOL_DEFS: readonly ToolDef[] = [
  ...LEAD_TOOLS,
  ...COMPANY_TOOLS,
  ...TENDER_TOOLS,
  ...STARTUP_TOOLS,
  ...GSC_TOOLS,
  ...RFQ_TOOLS,
  ...ORDER_TOOLS,
  ...AGENT_TOOLS,
];

// Registration is typed loosely (one generic call site): the SDK's overloads stay out of the per-tool types.
interface LooseServer {
  registerTool(name: string, config: Record<string, unknown>, cb: (args: Record<string, unknown>) => Promise<unknown>): unknown;
  registerResource(name: string, uri: string, config: Record<string, unknown>, cb: (uri: URL) => Promise<unknown>): unknown;
  registerPrompt(name: string, config: Record<string, unknown>, cb: (args: Record<string, string>) => Promise<unknown>): unknown;
}

export function createMicronsMcpServer(ctx: McpContext, defs: readonly ToolDef[] = ALL_TOOL_DEFS): McpServer {
  const server = new McpServer(SERVER_INFO);
  const loose = server as unknown as LooseServer;
  for (const def of toolsForStage(defs, ctx.stage)) {
    loose.registerTool(def.name, { description: descriptionOf(def), inputSchema: z.object(def.shape), annotations: annotationsOf(def) }, async (args) => {
      const result = await auditedCall(def, args ?? {}, ctx);
      return { content: [{ type: 'text', text: result.text }], ...(result.isError ? { isError: true } : {}) };
    });
  }
  if (ctx.stage.name === 'off') return server;
  for (const res of RESOURCES) {
    loose.registerResource(res.name, res.uri, { description: res.description }, async (uri) => ({
      contents: [{ uri: uri.href, text: await res.read(ctx), mimeType: 'text/plain' }],
    }));
  }
  for (const prompt of PROMPTS) {
    const config: Record<string, unknown> = { description: prompt.description };
    if (prompt.args) config.argsSchema = z.object(prompt.args);
    loose.registerPrompt(prompt.name, config, async (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: await prompt.render(args ?? {}, ctx) } }],
    }));
  }
  return server;
}
