// Shared by test/mcp/queries.test.ts (remote tools, T1) and test/mcp/parity.test.ts (local server, MCP_PARITY=1):
// the query cases, the request normalisation (decoded path and query, timestamps replaced) and the remote run.

import { readFileSync } from 'node:fs';
import type { RecordedSb } from './helpers';
import { connectV1, mcpHarness } from './helpers';
import { ALL_TOOL_DEFS } from '../../src/mcp/server';

export interface QueryCases {
  cases: Array<{ tool: string; args: Record<string, unknown> }>;
  resources: string[];
  prompts: Array<{ name: string; args: Record<string, string> }>;
}

export const CASES_FILE = new URL('../fixtures/mcp/query-cases.json', import.meta.url);
export const LOCAL_QUERIES_FILE = new URL('../fixtures/mcp/local-queries.json', import.meta.url);

export function loadCases(): QueryCases {
  return JSON.parse(readFileSync(CASES_FILE, 'utf8')) as QueryCases;
}

const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

/** 'METHOD /table?decoded-query' with every timestamp replaced by <ts>. */
export function normalise(r: Pick<RecordedSb, 'method' | 'path'>): string {
  let path: string;
  try {
    path = decodeURIComponent(r.path.replace(/\+/g, ' '));
  } catch {
    path = r.path;
  }
  return `${r.method} ${path.replace(ISO_TS, '<ts>')}`;
}

/** Key of a case in local-queries.json. */
export function caseKey(kind: 'tool' | 'resource' | 'prompt', name: string, index: number): string {
  return `${kind}:${index}:${name}`;
}

/** Sorted normalised requests of each case, from the remote tools (stage 'write' with every opt-in tool). */
export async function runRemoteCases(cases: QueryCases): Promise<Record<string, string[]>> {
  const optIn = ALL_TOOL_DEFS.filter((d) => d.stage === 'opt').map((d) => d.name);
  const h = await mcpHarness({ flag: { enabled: true, value: { writes: true, write_tools: optIn } } });
  const client = await connectV1(h, await h.token());
  const out: Record<string, string[]> = {};
  const take = () => h.sb.requests.splice(0).map(normalise).sort();
  for (const [i, c] of cases.cases.entries()) {
    take();
    await client.callTool({ name: c.tool, arguments: c.args });
    out[caseKey('tool', c.tool, i)] = take();
  }
  for (const [i, uri] of cases.resources.entries()) {
    take();
    await client.readResource({ uri });
    out[caseKey('resource', uri, i)] = take();
  }
  for (const [i, p] of cases.prompts.entries()) {
    take();
    await client.getPrompt({ name: p.name, arguments: p.args });
    out[caseKey('prompt', p.name, i)] = take();
  }
  await client.close();
  return out;
}
