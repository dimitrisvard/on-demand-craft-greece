// X-3 audit and deduplication: one agent_runs row per tools/call; reads written after the answer (waitUntil);
// writes deduplicated by arguments digest and 10-minute bucket, opened before the effect.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redact, restoreArgs, summaryOf, WRITE_BUCKET_MS, writeKey } from '../../src/mcp/audit';
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
    // The stored text names the arguments by marker only; the repeated call gets them back from its own arguments.
    expect(rows[0]).toMatchObject({ status: 'succeeded', output: { tool: 'update_lead_status', ok: true, result_text: 'Lead [arg1] status updated to: [arg2]' } });
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

  it('stored write output holds no argument of 3 or more characters and no e-mail address; the repeated call gets the first answer', async () => {
    const h = await mcpHarness({ flag: { enabled: true, value: { writes: true, write_tools: ['save_response_draft'] } } });
    const client = await connectV1(h, await h.token());
    const draft = 'Hi Jane Doe, please send the drawings to jane.doe@example.de or call +49 30 1234567.';
    const args = { lead_id: '11111111-2222-4333-8444-555555555555', response_text: draft, platform: 'email' };
    const first = textOf(await client.callTool({ name: 'save_response_draft', arguments: args }));
    expect(first).toContain(draft);
    const [row] = h.ports.db.rows('agent_runs');
    const stored = JSON.stringify(row.output);
    for (const value of Object.values(args)) expect(stored).not.toContain(value);
    expect(stored).not.toMatch(/[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(row.output).toMatchObject({ result_summary: 'Response draft saved for lead [arg2].', result_text: 'Response draft saved for lead [arg2].\n\nDraft:\n[arg1]' });
    // Within the bucket the same call answers the first result again, without a second effect.
    const again = textOf(await client.callTool({ name: 'save_response_draft', arguments: args }));
    expect(again).toBe(first);
    expect(h.sb.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    await client.close();
  });

  it('flag mcp.remote off: mcp_status calls write no agent_runs row', async () => {
    const h = await mcpHarness({ flag: null });
    const client = await connectV1(h, await h.token());
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['mcp_status']);
    for (let i = 0; i < 3; i++) await client.callTool({ name: 'mcp_status', arguments: {} });
    await settle(h);
    expect(h.ports.db.rows('agent_runs')).toEqual([]);
    await client.close();
  });

  it('redaction: one pass, markers restored exactly from the same arguments, other addresses masked', () => {
    const args = { q: 'cargo bay', tag: 'arg', note: 'see owner@example.com' };
    const text = 'cargo bay and arg; contact buyer.one@example.de; see owner@example.com';
    const stored = redact(text, args);
    expect(stored).toBe('[arg2] and [arg3]; contact b***@example.de; [arg1]');
    expect(restoreArgs(stored, args)).toBe('cargo bay and arg; contact b***@example.de; see owner@example.com');
    expect(redact('no arguments, a@example.org', {})).toBe('no arguments, a***@example.org');
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
