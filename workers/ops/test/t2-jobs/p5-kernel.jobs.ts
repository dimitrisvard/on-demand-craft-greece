// T2 (profile 'jobs', real workerd): the Phase 5 schedule table on the every-minute cron of microns-ops. The cron is
// fired through the Local Explorer with a fixed scheduled_time (POST /cdn-cgi/local/explorer/api/local/scheduled?
// worker=microns-ops), the flags are written into the local KV namespace FLAGS, and the run rows are read from the
// mini-PostgREST of the harness (stubs/postgrest.mjs). Checks: one agent_runs row per due job whose flag is on (run
// keys with the slot, trigger cron), none for a job whose flag is off, the tender fan-out over the seeded
// connectors, the catch-up of the 06:00 slots at 06:30, the ops-digest Workflow instance, and a second tick for the
// same time that adds nothing.
//
// Rules for the work this file dispatches (the local consumers run it):
//   - api/tender-scan.js reaches its portals by country code, so the stub cannot stand in for them: the seeded
//     tender_connectors use only codes the handler refuses before any I/O (XX, YY, ZZ, QQ; a T1 test in
//     test/p5/kernel/harness-jobs.test.ts checks them against the handler's connector table), and the tenders flag
//     is in shadow.
//   - Every run and Workflow instance this file causes reaches a final state while its flags are in force, before
//     afterAll puts the earlier flag values back; if that does not happen in time, afterAll switches the touched
//     flags off instead (fail closed) and fails.

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
const DATE = '2030-01-07';
const DIGEST_INSTANCE = 'ops-digest-2030-W02';
/** Run keys the dispatcher opens at TICK (the tender parent is closed by the dispatcher itself). */
const DISPATCHED = [`growth.hn:${SLOT}`, `growth.reddit:t1:${SLOT}`, `growth.reddit:t2:${SLOT}`, `growth.tenders:${DATE}`, `growth.xometry:${SIX}`];
/** Connector codes refused by api/tender-scan.js before any I/O; the due ones by the 6 h rule are XX and YY. */
const DUE_CHILDREN = [`growth.tenders:${DATE}:XX`, `growth.tenders:${DATE}:YY`];
const FINAL_RUN = new Set(['succeeded', 'failed', 'skipped']);
const FINAL_INSTANCE = new Set(['complete', 'completed', 'errored', 'terminated']);
const SETTLE_MS = 60_000;

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

/** Every agent_runs row this file causes (dispatcher runs, tender children, the digest run) is final, the two tender
 *  children exist, and the ops-digest instance is final; else a description of what is still open. */
async function openWork(): Promise<string[]> {
  const all = await p5Runs();
  const mine = all.filter((r) => {
    const key = String(r.idempotency_key);
    return DISPATCHED.includes(key) || key.startsWith(`growth.tenders:${DATE}:`) || key === 'ops_digest:2030-W02';
  });
  const open = mine.filter((r) => !FINAL_RUN.has(String(r.status))).map((r) => `${String(r.idempotency_key)} ${String(r.status)}`);
  for (const key of [...DISPATCHED, ...DUE_CHILDREN]) if (!mine.some((r) => r.idempotency_key === key)) open.push(`${key} missing`);
  const res = await call(`${EXPLORER}/workflows/ops-digest/instances/${DIGEST_INSTANCE}`);
  const status = res.status === 404 ? 'missing' : String(((await res.json()) as { result?: { status?: string } }).result?.status ?? 'unknown');
  if (!FINAL_INSTANCE.has(status)) open.push(`${DIGEST_INSTANCE} ${status}`);
  return open;
}

/** Waits until openWork() is empty; answers what is still open at the deadline (empty = settled). */
async function settle(ms = SETTLE_MS): Promise<string[]> {
  const end = Date.now() + ms;
  for (;;) {
    const open = await openWork().catch((e: unknown) => [`read failed: ${e instanceof Error ? e.message : String(e)}`]);
    if (open.length === 0 || Date.now() > end) return open;
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
          // Codes the handler refuses before any I/O (rules above): due by the 6 h rule XX (never scanned) and YY
          // (18.5 h before the tick); ZZ scanned 1.5 h before (not due); QQ inactive.
          tender_connectors: [
            { country_code: 'XX', is_active: true, last_scan_at: null },
            { country_code: 'YY', is_active: true, last_scan_at: '2030-01-06T12:00:00.000Z' },
            { country_code: 'ZZ', is_active: true, last_scan_at: '2030-01-07T05:00:00.000Z' },
            { country_code: 'QQ', is_active: false, last_scan_at: null },
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
    // The consumers read the flags when they handle a message: the earlier values come back only after every run and
    // instance of this file is final. Otherwise the touched flags are switched off (absent = off) and the file fails.
    const open = saved.size > 0 ? await settle() : [];
    for (const [key, value] of saved) {
      if (open.length > 0 || value === null) await kvDelete(key);
      else await kvPut(key, value);
    }
    if (open.length > 0) throw new Error(`work still open after ${SETTLE_MS / 1000} s, flags switched off: ${open.join('; ')}`);
  }, SETTLE_MS + 15_000);

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

  it('tenders: the parent closes succeeded with the due connectors of the 6 h rule (XX, YY) enqueued', async () => {
    const parent = await until('the tender parent run', async () => {
      const r = (await p5Runs()).find((x) => x.idempotency_key === 'growth.tenders:2030-01-07');
      return r && r.status === 'succeeded' ? r : null;
    });
    expect(parent.output).toEqual({ due: 2, enqueued: 2, countries: null });
  });

  it('the dispatched work settles while the flags of this file are in force: the tender children close skipped (shadow), never flag_off', async () => {
    const open = await settle();
    expect(open).toEqual([]);
    const runs = await p5Runs();
    const parent = runs.find((r) => r.idempotency_key === `growth.tenders:${DATE}`);
    const children = runs.filter((r) => String(r.idempotency_key).startsWith(`growth.tenders:${DATE}:`));
    expect(children.map((r) => r.idempotency_key).sort()).toEqual(DUE_CHILDREN);
    for (const child of children) {
      expect(child, String(child.idempotency_key)).toMatchObject({ status: 'skipped', trigger: 'queue', parent_run_id: parent?.id });
      expect((child.output as Row | null)?.reason, String(child.idempotency_key)).toBe('shadow');
    }
    // The xometry run was handled under the shadow flag too (a flag read after afterAll would close it flag_off).
    const xometry = runs.find((r) => r.idempotency_key === `growth.xometry:${SIX}`);
    expect((xometry?.output as Row | null)?.reason).not.toBe('flag_off');
  }, SETTLE_MS + 5_000);

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
