// X-4: the remote tools, resources and prompts send the same PostgREST requests (method, path, query; timestamps
// normalised) as the local server for the same arguments. The local side is test/fixtures/mcp/local-queries.json,
// recorded from the local build with supabase-js and re-checked by test/mcp/parity.test.ts (MCP_PARITY=1).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_QUERIES_FILE, loadCases, runRemoteCases } from './query-recording';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('X-4 query parity with the local tools', () => {
  it('every case sends exactly the local requests', async () => {
    const cases = loadCases();
    const local = JSON.parse(readFileSync(LOCAL_QUERIES_FILE, 'utf8')) as Record<string, string[]>;
    expect(Object.keys(local)).toHaveLength(cases.cases.length + cases.resources.length + cases.prompts.length);
    const remote = await runRemoteCases(cases);
    for (const [key, requests] of Object.entries(local)) expect(remote[key], key).toEqual(requests);
    // The fixture is not trivial: reads, counts, writes and the or= search filter are all covered.
    const all = Object.values(local).flat();
    for (const prefix of ['GET ', 'HEAD ', 'POST ', 'PATCH ', 'DELETE ']) expect(all.some((r) => r.startsWith(prefix)), prefix).toBe(true);
    expect(all.some((r) => r.includes('or=('))).toBe(true);
  });
});
