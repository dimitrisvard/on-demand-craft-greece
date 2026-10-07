// X-3 audit and deduplication: one agent_runs row per tools/call; reads written after the answer (waitUntil);
// writes deduplicated by arguments digest and 10-minute bucket, opened before the effect.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryOf, WRITE_BUCKET_MS, writeKey } from '../../src/mcp/audit';
import { STAFF_UID, connectV1, mcpHarness, settle, textOf } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const LEAD = '7d1e2f30-4a5b-4c6d-8e7f-901a2b3c4d5e';
const WRITES = { enabled: true, value: { writes: true } };

describe('X-3 audit', () => {
  it('a read call: one mcp row, opened and closed after the answer (waitUntil), no raw arguments', async () => {
    const h = await mcpHarness();
    const client = await connectV1(h, await h.token());
    expect(textOf(await client.callTool({ name: 'search_leads', arguments: { query: 'secret-term owner@example.com' } }))).toContain('No leads found');
    // The audit write is handed to waitUntil (it never delays the answer).
    expect(h.ctx.pending.length).toBeGreaterThan(0);
    await settle(h);
    const rows = h.ports.db.rows('agent_runs');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ agent: 'mcp', trigger: 'mcp', status: 'succeeded', llm_calls: 0 });
    expect(String(row.idempotency_key)).toMatch(/^mcp:r:[0-9a-f-]{36}$/);
    expect(row.output).toMatchObject({ tool: 'search_leads', actor: `user:${STAFF_UID}`, ok: true });
    expect((row.output as Record<string, unknown>).args_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row.output)).not.toContain('secret-term');
    expect(JSON.stringify(row.output)).not.toContain('owner@example.com');
    await client.close();
  });

  it('a write twice within the bucket: one effect, the same answer, one row', async () => {
    const h = await mcpHarness({ flag: WRITES });
    const client = await connectV1(h, await h.token());
    const args = { lead_id: LEAD, status: 'reviewed' };
    const first = textOf(await client.callTool({ name: 'update_lead_status', arguments: args }));
    const second = textOf(await client.callTool({ name: 'update_lead_status', arguments: args }));
    expect(first).toBe(`Lead ${LEAD} status updated to: reviewed`);
    expect(second).toBe(first);
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    const insert = h.sb.requests.find((r) => r.method === 'POST' && r.path.startsWith('/lead_activity'));
    expect(insert?.body).toMatchObject({ performed_by: `mcp:${STAFF_UID}`, action: 'status_changed' });
    const rows = h.ports.db.rows('agent_runs');
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotency_key).toBe(await writeKey(STAFF_UID, 'update_lead_status', args, h.ports.clock.now().getTime()));
    expect(rows[0]).toMatchObject({ status: 'succeeded', output: { tool: 'update_lead_status', ok: true, result_text: first } });
    // Other arguments are another call.
    await client.callTool({ name: 'update_lead_status', arguments: { lead_id: LEAD, status: 'saved' } });
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(2);
    await client.close();
  });

  it('a failed write: run failed, the same call in the bucket answers the failure without an effect, a new bucket runs again', async () => {
    let failing = true;
    const h = await mcpHarness({ flag: WRITES, sbRoute: ({ method }) => (method === 'PATCH' && failing ? { status: 500, body: { code: 'XX000', message: 'boom', details: null, hint: null } } : undefined) });
    const client = await connectV1(h, await h.token());
    const args = { lead_id: LEAD, status: 'dismissed' };
    const first = await client.callTool({ name: 'update_lead_status', arguments: args });
    expect(first.isError).toBe(true);
    expect(h.ports.db.rows('agent_runs')[0]).toMatchObject({ status: 'failed', error: 'tool_error', output: { ok: false } });
    failing = false;
    const again = await client.callTool({ name: 'update_lead_status', arguments: args });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain('failed in the current 10-minute window');
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    h.ports.clock.advance(WRITE_BUCKET_MS);
    const later = await client.callTool({ name: 'update_lead_status', arguments: args });
    expect(later.isError).toBeFalsy();
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(2);
    expect(h.ports.db.rows('agent_runs').map((r) => r.status).sort()).toEqual(['failed', 'succeeded']);
    await client.close();
  });

  it('a write whose audit row cannot be opened is not run', async () => {
    const h = await mcpHarness({ flag: WRITES });
    const client = await connectV1(h, await h.token());
    const rpc = h.ports.db.rpc.bind(h.ports.db);
    vi.spyOn(h.ports.db, 'rpc').mockImplementation(async (name, args) => {
      if (name === 'agent_run_begin') throw new Error('db down');
      return rpc(name, args);
    });
    const result = await client.callTool({ name: 'update_lead_status', arguments: { lead_id: LEAD, status: 'saved' } });
    expect(result.isError).toBe(true);
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    await client.close();
  });

  it('keys and summaries', async () => {
    const k1 = await writeKey('u', 'update_company', { b: 1, a: 2 }, 1_000);
    const k2 = await writeKey('u', 'update_company', { a: 2, b: 1 }, 599_999);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^mcp:w:update_company:[0-9a-f]{32}:0$/);
    expect(await writeKey('u', 'update_company', { a: 2, b: 1 }, 600_000)).not.toBe(k1);
    expect(await writeKey('v', 'update_company', { a: 2, b: 1 }, 1_000)).not.toBe(k1);
    expect(summaryOf('\n\nE-mail: someone@example.de and more\nsecond')).toBe('E-mail: s***@example.de and more');
    expect(summaryOf('x'.repeat(400))).toHaveLength(300);
  });
});
