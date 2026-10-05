// T2 (profile 'agents', real workerd): the every-minute flag mirror of microns-ops against the mini-PostgREST and the
// local KV namespace FLAGS that microns-site reads too. The cron is fired through the Local Explorer
// (POST /cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops with an explicit scheduled_time), KV is read
// and written through the Explorer's KV routes, rows through the stub's REST surface and control API.
// Needs the harness of PHASE4_SPEC.md §6.3 (T2_SITE_URL = the dev server, T2_STUB_URL = the stub with
// stubs/postgrest.mjs mounted).

import { beforeAll, describe, expect, it } from 'vitest';

const SITE = process.env.T2_SITE_URL ?? '';
const STUB = process.env.T2_STUB_URL ?? '';
const EXPLORER = `${SITE}/cdn-cgi/local/explorer/api`;
const TENANT = '00000000-0000-0000-0000-000000000001';
const HOUR = Date.parse('2026-10-05T08:00:00.000Z');

type Row = Record<string, unknown>;

async function call(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init?.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

const json = { 'content-type': 'application/json' };
const rest = (path: string, init: RequestInit = {}) =>
  call(`${STUB}/rest/v1${path}`, { ...init, headers: { apikey: 't2', authorization: 'Bearer t2', ...json, ...(init.headers as Record<string, string> | undefined) } });

let namespace = '';
async function kvNamespace(): Promise<string> {
  if (namespace) return namespace;
  const body = (await (await call(`${EXPLORER}/storage/kv/namespaces`)).json()) as { result: Array<{ id: string; title: string }> };
  const hit = body.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title));
  if (!hit) throw new Error(`no FLAGS namespace in ${JSON.stringify(body.result)}`);
  namespace = hit.id;
  return namespace;
}
const kvUrl = async (key: string) => `${EXPLORER}/storage/kv/namespaces/${encodeURIComponent(await kvNamespace())}/values/${encodeURIComponent(key)}`;
async function kvGet(key: string): Promise<string | null> {
  const res = await call(await kvUrl(key));
  return res.status === 404 ? null : res.text();
}
async function kvPut(key: string, value: string): Promise<void> {
  await call(await kvUrl(key), { method: 'PUT', body: value, headers: { 'content-type': 'application/octet-stream' } });
}
async function kvDelete(key: string): Promise<void> {
  await call(await kvUrl(key), { method: 'DELETE' });
}

async function cron(scheduledTime: number): Promise<void> {
  const res = await call(`${EXPLORER}/local/scheduled?worker=microns-ops`, {
    method: 'POST', headers: json, body: JSON.stringify({ cron: '* * * * *', scheduled_time: scheduledTime }),
  });
  expect(res.status).toBe(200);
}

const rows = async (table: string): Promise<Row[]> => (await (await call(`${STUB}/__stub/rows/${table}`)).json()) as Row[];
const flag = async (key: string): Promise<Row> => (await rows('feature_flags')).find((r) => r.key === key && r.tenant_id === TENANT) as Row;

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!SITE || !STUB)('flags-sync cron in workerd (T2)', () => {
  beforeAll(async () => {
    await call(`${STUB}/__stub/postgrest/reset`, { method: 'POST' });
    await call(`${STUB}/__stub/seed`, { method: 'POST', headers: json, body: JSON.stringify({ flags: 'migration' }) });
    for (const key of ['agent.quote', 'agent.post_order', 'seo.strict_404']) await kvDelete(key);
    // KV as set by hand before the agent layer: the Phase 2 rollback switch on for preview hosts, one malformed key.
    await kvPut('api.forward_to_vercel', '{"enabled":true,"value":{"hosts":["preview"]}}');
    await kvPut('mcp.remote', 'on');
  });

  it('first tick: imports the hand-set value, marks absent keys in sync, keeps the malformed key pending, records one run', async () => {
    await cron(HOUR + 60_000);
    const fwd = await until('the import of api.forward_to_vercel', async () => {
      const r = await flag('api.forward_to_vercel');
      return r && r.kv_seed_pending === false && r.kv_synced_rev === r.rev ? r : null;
    });
    expect(fwd).toMatchObject({ enabled: true, value: { hosts: ['preview'] } });
    const flags = await rows('feature_flags');
    expect(flags.filter((r) => r.kv_seed_pending === true).map((r) => r.key)).toEqual(['mcp.remote']);
    const kv = JSON.parse((await kvGet('api.forward_to_vercel')) as string) as Row;
    expect(kv).toMatchObject({ enabled: true, value: { hosts: ['preview'] }, rev: fwd.rev });
    expect(String(kv.updated_at)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(await kvGet('agent.quote')).toBeNull();
    expect(await kvGet('mcp.remote')).toBe('on');
    const runs = await until('the run row', async () => {
      const r = (await rows('agent_runs')).filter((x) => x.agent === 'flags' && x.finished_at !== null);
      return r.length ? r : null;
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'cron', status: 'succeeded', idempotency_key: 'flags-sync:2026-10-05T08:01Z' });
  });

  it('an edited row is mirrored on the next tick (rev, mode and value in the KV record)', async () => {
    await rest(`/feature_flags?key=eq.agent.quote&tenant_id=eq.${TENANT}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
    await cron(HOUR + 2 * 60_000);
    const kv = await until('agent.quote in KV', async () => {
      const raw = await kvGet('agent.quote');
      return raw ? (JSON.parse(raw) as Row) : null;
    });
    const row = await flag('agent.quote');
    expect(kv).toMatchObject({ enabled: true, mode: 'assist', rev: row.rev, value: { mode: 'assist', follow_up_days: [3, 4, 7] } });
    await until('agent.quote marked synced', async () => (await flag('agent.quote')).kv_synced_rev === row.rev);
  });

  it('minute 0: a KV value changed by hand is reported as drift and left as it is', async () => {
    await kvPut('agent.quote', '{"enabled":false}');
    await cron(HOUR + 60 * 60_000);
    const run = await until('the hourly run row', async () => (await rows('agent_runs')).find((r) => r.idempotency_key === 'flags-sync:2026-10-05T09:00Z' && r.finished_at !== null));
    expect((run.output as Row).drift).toEqual(expect.arrayContaining([{ kv_key: 'agent.quote', kind: 'kv_differs' }]));
    expect(await kvGet('agent.quote')).toBe('{"enabled":false}');
    expect((await flag('agent.quote')).enabled).toBe(true);
  });
});
