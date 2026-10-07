// X-7 parity of the remote MCP port with the local stdio server (opt-in: MCP_PARITY=1, npm run mcp:parity; needs
// `npm --prefix mcp-server ci && npm --prefix mcp-server run build`).
//   1 tools/list, resources/list, prompts/list of the local build (started on stdio with dummy configuration and
//     SUPABASE_URL = a local recording server) against the remote server at its widest stage: names equal,
//     descriptions equal, JSON input schemas equal after normalisation, except the differences listed in
//     parity.allow.json (each with its reason).
//   2 the PostgREST requests the local tools, resources and prompts make for the cases of
//     test/fixtures/mcp/query-cases.json equal test/fixtures/mcp/local-queries.json (MCP_PARITY_WRITE=1 rewrites
//     the file from the local build); test/mcp/queries.test.ts holds the remote tools to the same file in T1.
// Nothing here reaches the network: the local server's Supabase URL is 127.0.0.1.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { allTools, annotationsOf, descriptionOf, WRITE_NOTICE } from '../../src/mcp/registry';
import { ALL_TOOL_DEFS } from '../../src/mcp/server';
import { connectV1, mcpHarness, postgrestRecorder } from './helpers';
import { LOCAL_QUERIES_FILE, caseKey, loadCases, normalise } from './query-recording';

const LOCAL_BUILD = fileURLToPath(new URL('../../../../mcp-server/build/index.js', import.meta.url));
const ALLOW = JSON.parse(readFileSync(new URL('./parity.allow.json', import.meta.url), 'utf8')) as {
  remote_only_tools: string[];
  write_notice: string;
  removed_properties: Record<string, { properties: string[]; reason: string }>;
  changed_properties: Record<string, { properties: Record<string, unknown>; reason: string }>;
};

type Json = Record<string, unknown>;

/** Sorted keys, no $schema, no additionalProperties: false, no empty required list. */
export function normaliseSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normaliseSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Json = {};
  for (const key of Object.keys(schema).sort()) {
    const value = (schema as Json)[key];
    if (key === '$schema') continue;
    if (key === 'additionalProperties' && value === false) continue;
    if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
    out[key] = key === 'required' && Array.isArray(value) ? [...value].sort() : normaliseSchema(value);
  }
  return out;
}

async function recordingServer(): Promise<{ url: string; requests: Array<{ method: string; path: string }>; close(): Promise<void> }> {
  const recorder = postgrestRecorder();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const response = await recorder.fetch(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: body.length && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests: recorder.requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function localClient(supabaseUrl: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [LOCAL_BUILD],
    env: { PATH: process.env.PATH ?? '', SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_KEY: 'dummy-not-a-secret', SITE_URL: 'http://127.0.0.1:9' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mcp-parity', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe.skipIf(process.env.MCP_PARITY !== '1')('X-7 parity with the local MCP server', () => {
  it('the local build exists', () => {
    expect(existsSync(LOCAL_BUILD), 'run npm --prefix mcp-server ci && npm --prefix mcp-server run build').toBe(true);
  });

  it('tools, resources and prompts: 0 unexplained differences', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rec = await recordingServer();
    const local = await localClient(rec.url);
    const localTools = (await local.listTools()).tools;
    const localResources = (await local.listResources()).resources;
    const localPrompts = (await local.listPrompts()).prompts;
    await local.close();
    await rec.close();

    const optIn = ALL_TOOL_DEFS.filter((d) => d.stage === 'opt').map((d) => d.name);
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true, write_tools: optIn } } });
    const remote = await connectV1(h, await h.token());
    const remoteTools = (await remote.listTools()).tools;
    const remoteResources = (await remote.listResources()).resources;
    const remotePrompts = (await remote.listPrompts()).prompts;
    await remote.close();

    const problems: string[] = [];
    const remoteByName = new Map(remoteTools.map((t) => [t.name, t]));
    expect(localTools).toHaveLength(39);
    for (const lt of localTools) {
      const rt = remoteByName.get(lt.name);
      if (!rt) {
        problems.push(`${lt.name}: missing on the remote server`);
        continue;
      }
      const def = allTools(ALL_TOOL_DEFS).find((d) => d.name === lt.name);
      const expectedDescription = def && def.cls !== 'R' ? `${lt.description} ${ALLOW.write_notice}` : lt.description;
      if (rt.description !== expectedDescription) problems.push(`${lt.name}: description differs`);
      const localSchema = structuredClone(lt.inputSchema) as Json;
      const props = (localSchema.properties ?? {}) as Json;
      for (const removed of ALLOW.removed_properties[lt.name]?.properties ?? []) {
        delete props[removed];
        if (Array.isArray(localSchema.required)) localSchema.required = (localSchema.required as string[]).filter((r) => r !== removed);
      }
      for (const [name, changed] of Object.entries(ALLOW.changed_properties[lt.name]?.properties ?? {})) props[name] = changed;
      const a = JSON.stringify(normaliseSchema(localSchema));
      const b = JSON.stringify(normaliseSchema(rt.inputSchema));
      if (a !== b) problems.push(`${lt.name}: input schema differs\n  local  ${a}\n  remote ${b}`);
    }
    const extra = remoteTools.map((t) => t.name).filter((n) => !localTools.some((l) => l.name === n)).sort();
    expect(extra).toEqual([...ALLOW.remote_only_tools].sort());
    expect(ALLOW.write_notice).toBe(WRITE_NOTICE);

    const pick = (r: { uri: string; name: string; description?: string }) => ({ uri: r.uri, name: r.name, description: r.description });
    expect(remoteResources.map(pick)).toEqual(localResources.map(pick));
    const pickPrompt = (p: { name: string; description?: string; arguments?: unknown }) => ({ name: p.name, description: p.description, arguments: p.arguments ?? [] });
    expect(remotePrompts.map(pickPrompt)).toEqual(localPrompts.map(pickPrompt));

    // Annotations exist on the remote side only (the local server has none); every remote tool carries them.
    for (const def of allTools(ALL_TOOL_DEFS)) expect(remoteByName.get(def.name)?.annotations, def.name).toEqual(annotationsOf(def));
    expect(problems, problems.join('\n')).toEqual([]);
    // Descriptions of the remote-only tools follow the same rule.
    for (const name of ALLOW.remote_only_tools) {
      const def = allTools(ALL_TOOL_DEFS).find((d) => d.name === name) ?? ALL_TOOL_DEFS.find((d) => d.name === name);
      if (def && remoteByName.has(name)) expect(remoteByName.get(name)?.description).toBe(descriptionOf(def));
    }
  });

  it('PostgREST requests of the local tools equal local-queries.json', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases = loadCases();
    const rec = await recordingServer();
    const local = await localClient(rec.url);
    const out: Record<string, string[]> = {};
    const take = () => rec.requests.splice(0).map(normalise).sort();
    for (const [i, c] of cases.cases.entries()) {
      take();
      await local.callTool({ name: c.tool, arguments: c.args });
      out[caseKey('tool', c.tool, i)] = take();
    }
    for (const [i, uri] of cases.resources.entries()) {
      take();
      await local.readResource({ uri });
      out[caseKey('resource', uri, i)] = take();
    }
    for (const [i, p] of cases.prompts.entries()) {
      take();
      await local.getPrompt({ name: p.name, arguments: p.args });
      out[caseKey('prompt', p.name, i)] = take();
    }
    await local.close();
    await rec.close();
    if (process.env.MCP_PARITY_WRITE === '1') writeFileSync(LOCAL_QUERIES_FILE, `${JSON.stringify(out, null, 2)}\n`);
    expect(out).toEqual(JSON.parse(readFileSync(LOCAL_QUERIES_FILE, 'utf8')));
  });
});
