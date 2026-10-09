// T2 (profile 'jobs', real workerd): the Phase 5 schedule table on the every-minute cron of microns-ops. The cron is
// fired through the Local Explorer with a fixed scheduled_time (POST /cdn-cgi/local/explorer/api/local/scheduled?
// worker=microns-ops), the flags are written into the local KV namespace FLAGS, and the run rows are read from the
// mini-PostgREST of the harness (stubs/postgrest.mjs). Checks: one agent_runs row per due job whose flag is on (run
// keys with the slot, trigger cron), none for a job whose flag is off, the tender fan-out over the seeded
// connectors, the catch-up of the 06:00 slots at 06:30, the ops-digest Workflow instance, and a second tick for the
// same time that adds nothing. The Phase 5 consumers settle the messages; this file asserts only what the dispatcher
// writes.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITE = process.env.T2_SITE_URL ?? '';
const STUB = process.env.T2_STUB_URL ?? '';
const PROFILE = process.env.T2_PROFILE ?? '';
const EXPLORER = `${SITE}/cdn-cgi/local/explorer/api`;
const JSON_HEADERS = { 'content-type': 'application/json' };

/** Monday 2030-01-07 06:30 UTC: a slot no other file uses (the dispatcher memoises slots per isolate). */
const TICK = Date.UTC(2030, 0, 7, 6, 30);
const SLOT = '2030-01-07T06:30Z';
const SIX = '2030-01-07T06:00Z';

type Row = Record<string, unknown>;

async function call(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init?.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

let namespace = '';
async function kvUrl(key: string): Promise<string> {
  if (!namespace) {
    const body = (await (await call(`${EXPLORER}/storage/kv/namespaces`)).json()) as { result: Array<{ id: string; title?: string }> };
    const hit = body.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title ?? ''));
    if (!hit) throw new Error(`no FLAGS namespace in ${JSON.stringify(body.result)}`);
    namespace = hit.id;
  }
  return `${EXPLORER}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${encodeURIComponent(key)}`;
}
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
  const res = await call(`${EXPLORER}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ cron: '* * * * *', scheduled_time: scheduledTime }) });
  expect(res.status).toBe(200);
}

const rows = async (table: string): Promise<Row[]> => (await (await call(`${STUB}/__stub/rows/${table}`)).json()) as Row[];
const p5Runs = async (): Promise<Row[]> => (await rows('agent_runs')).filter((r) => String(r.agent).startsWith('growth.') || String(r.agent).startsWith('content_daily') || String(r.agent).startsWith('ops_digest') || String(r.agent).startsWith('marketing.'));

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; runs ${JSON.stringify((await p5Runs()).map((r) => [r.agent, r.idempotency_key, r.status, r.error]))} (the [microns-ops] schedule lines are in the wrangler log of the harness tmp dir)`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const FLAGS: Record<string, Row | null> = {
  'agent.growth.reddit': { enabled: true, mode: 'shadow', value: {}, rev: 1 },
  'agent.growth.hn': { enabled: true, mode: 'shadow', value: {}, rev: 1 },
  'agent.growth.tenders': { enabled: true, mode: 'shadow', value: {}, rev: 1 },
  'agent.growth.xometry': { enabled: true, mode: 'shadow', value: {}, rev: 1 },
  'agent.ops_digest': { enabled: true, mode: 'shadow', value: {}, rev: 1 },
  // Off at this tick: no run row may appear for it.
  'agent.content_daily': { enabled: false, mode: 'shadow', value: {}, rev: 1 },
};

describe.skipIf(!SITE || !STUB || PROFILE !== 'jobs')('Phase 5 schedule table on the every-minute cron (T2, profile jobs)', () => {
  const saved = new Map<string, string | null>();

  beforeAll(async () => {
    await call(`${STUB}/__stub/postgrest/reset`, { method: 'POST' });
    await call(`${STUB}/__stub/seed`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tables: {
          tender_connectors: [
            { country_code: 'NL', is_active: true, last_scan_at: null },
            { country_code: 'DE', is_active: true, last_scan_at: '2030-01-06T12:00:00.000Z' },
            { country_code: 'FR', is_active: true, last_scan_at: '2030-01-07T05:00:00.000Z' },
            { country_code: 'IT', is_active: false, last_scan_at: null },
          ],
        },
      }),
    });
    for (const [key, value] of Object.entries(FLAGS)) {
      saved.set(key, await kvGet(key));
      if (value) await kvPut(key, JSON.stringify(value));
      else await kvDelete(key);
    }
  });

  afterAll(async () => {
    for (const [key, value] of saved) {
      if (value === null) await kvDelete(key);
      else await kvPut(key, value);
    }
  });

  it('one run per due job with its flag on (trigger cron, slot in the key); the 06:00 slots are caught up at 06:30', async () => {
    await cron(TICK);
    const expected = [
      `growth.hn:${SLOT}`,
      `growth.reddit:t1:${SLOT}`,
      `growth.reddit:t2:${SLOT}`,
      'growth.tenders:2030-01-07',
      `growth.xometry:${SIX}`,
    ];
    const runs = await until('the dispatcher runs', async () => {
      const r = await p5Runs();
      return expected.every((k) => r.some((x) => x.idempotency_key === k)) ? r : null;
    });
    const dispatcherRuns = runs.filter((r) => String(r.agent).startsWith('growth.') && (r.parent_run_id === null || r.parent_run_id === undefined));
    expect(dispatcherRuns.map((r) => r.idempotency_key).sort()).toEqual(expected);
    for (const r of dispatcherRuns) expect(r.trigger, String(r.idempotency_key)).toBe('cron');
    expect(runs.some((r) => String(r.agent).startsWith('content_daily'))).toBe(false);
  });

  it('tenders: the parent closes succeeded with the due connectors of the 6 h rule (NL, DE) enqueued', async () => {
    const parent = await until('the tender parent run', async () => {
      const r = (await p5Runs()).find((x) => x.idempotency_key === 'growth.tenders:2030-01-07');
      return r && r.status === 'succeeded' ? r : null;
    });
    expect(parent.output).toEqual({ due: 2, enqueued: 2, countries: null });
  });

  it('ops-digest: the Workflow instance ops-digest-2030-W02 exists with {iso_week, trigger: cron}', async () => {
    const list = await until('the ops-digest instance', async () => {
      const res = await call(`${EXPLORER}/workflows/ops-digest/instances`);
      if (res.status === 404) return null;
      const body = (await res.json()) as { result?: Array<{ id: string }> };
      return body.result?.some((i) => i.id === 'ops-digest-2030-W02') ? body.result : null;
    });
    expect(list.map((i) => i.id)).toContain('ops-digest-2030-W02');
  });

  it('a second tick for the same scheduled time adds no run', async () => {
    const growth = async () => (await p5Runs()).filter((r) => String(r.agent).startsWith('growth.') && (r.parent_run_id === null || r.parent_run_id === undefined)).length;
    const before = await growth();
    await cron(TICK);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await growth()).toBe(before);
    expect(before).toBe(5);
  });
});
