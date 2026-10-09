// runXometryTick (PHASE5_SPEC §6.4, X-1…X-3; xometry-cad §2.6-§2.7): flag and run gates, overlap guard, token gate
// with fingerprint and 06:00 reminder, JWT expiry hint, scan into xometry_offers through PostgREST semantics,
// shadow mode, failure kinds and their repeat rules, the subrequest and wall-time budget, the compute pass, the run
// output, the Telegram texts and the Analytics Engine point. Partner calls are scripted (ScriptedSources); no
// provider is ever called.

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentFlag } from '../../../src/agents/flags';
import { openRun } from '../../../src/agents/runs';
import { DbError, type Db } from '../../../src/db/postgrest';
import type { OpsEnv } from '../../../src/env';
import { makeTestP5Ports, P5MemoryDb, ScriptedSources, type TestP5Ports } from '../../../src/ports/p5-stub/index';
import { SCAN_MAX_PAGES } from '../../../src/xometry/config';
import { runXometryTick, SUBREQUEST_STOP, tokenFingerprint, WALL_STOP_MS, type XometryTickLimits } from '../../../src/xometry/tick';
import { agentBindings, agentPorts, FakeClock, FakeKV, type AgentTestPorts } from '../../helpers/agent-env';
import { opsEnv } from '../../helpers/ops';
import { RecordingLogger } from '../../helpers/recorders';
import { ANODIZING_TAG, GRINDING_TAG, gqlPage, makeOffer, makePart, MILLING_TAG, PDF_FILE, type Json } from './helpers';

/** Thursday 2026-10-08. */
const DAY = '2026-10-08';
const at = (hhmm: string, day = DAY) => Date.parse(`${day}T${hhmm}:00.000Z`);
const slotOf = (hhmm: string, day = DAY) => `${day}T${hhmm}Z`;
const GRAPHQL = 'https://xometry.test/partners/graphql';
// Credential-shaped test values are built at runtime (G5-7).
const TOKEN = ['t1', 'xometry', 'token', 'value'].join('-');
const OTHER_TOKEN = ['t1', 'xometry', 'token', 'renewed'].join('-');

function jwtWithExp(exp: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: 'partner', exp }), 'c2lnbmF0dXJl'].join('.');
}

interface World {
  env: OpsEnv;
  kv: FakeKV;
  clock: FakeClock;
  db: P5MemoryDb;
  ports: AgentTestPorts;
  p5: TestP5Ports;
  sources: ScriptedSources;
}

function world(o: { token?: string | null; cookie?: string } = {}): World {
  const kv = new FakeKV();
  const clock = new FakeClock(at('06:00'));
  const db = new P5MemoryDb({ clock: () => clock.now() });
  const ports = agentPorts({ db, clock });
  const sources = new ScriptedSources();
  const p5 = makeTestP5Ports({ sources });
  const env = opsEnv({
    ...agentBindings({ FLAGS: kv as unknown as KVNamespace }),
    ...(o.token === null ? {} : { XOMETRY_TOKEN: o.token ?? TOKEN }),
    ...(o.cookie ? { XOMETRY_COOKIE: o.cookie } : {}),
  });
  return { env, kv, clock, db, ports, p5, sources };
}

function setFlag(w: World, enabled: boolean, mode: AgentFlag['mode'] = 'assist', value: Record<string, unknown> = {}): void {
  w.kv.setJson('agent.growth.xometry', { enabled, mode, value, rev: 1 });
}

/** The partner answers these responses in order (the last one repeats). */
function board(w: World, ...responses: Array<Response | (() => Response)>): void {
  let i = 0;
  w.sources.route({
    method: 'POST',
    match: GRAPHQL,
    respond: () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return typeof r === 'function' ? r() : r.clone();
    },
  });
}

const partnerCalls = (w: World) => w.sources.requests.filter((r) => r.url === GRAPHQL);
const offers = (w: World) => w.db.rows('xometry_offers');

async function tick(w: World, hhmm = '06:00', day = DAY, limits?: XometryTickLimits) {
  w.clock.set(at(hhmm, day));
  const slot = slotOf(hhmm, day);
  const run = await openRun(w.db, { agent: 'growth.xometry', trigger: 'cron', idempotency_key: `growth.xometry:${slot}` });
  const result = await runXometryTick(w.env, w.ports, w.p5, { slot, run_id: run.run_id, attempt: 1 }, limits);
  const row = w.db.rows('agent_runs', ['id', 'eq', run.run_id])[0];
  return { result, row, run_id: run.run_id };
}

let logger: RecordingLogger;
let restore: () => void;
beforeEach(() => {
  logger = new RecordingLogger();
  restore = logger.start();
});
afterEach(() => restore());

describe('gates before any partner call', () => {
  it('flag off: the run closes skipped {reason: flag_off}; nothing is fetched, written or sent', async () => {
    const w = world();
    setFlag(w, false);
    board(w, Response.json(gqlPage([makeOffer('HJO-1')])));
    const { result, row } = await tick(w);
    expect(result.status).toBe('skipped');
    expect(row.status).toBe('skipped');
    expect(row.output).toMatchObject({ reason: 'flag_off', slot: slotOf('06:00') });
    expect(partnerCalls(w)).toHaveLength(0);
    expect(offers(w)).toHaveLength(0);
    expect(w.p5.telegramText.messages).toHaveLength(0);
  });

  it('a redelivered message for a closed run does nothing; a missing run does nothing', async () => {
    const w = world();
    setFlag(w, true);
    board(w, Response.json(gqlPage([makeOffer('HJO-1')])));
    const first = await tick(w);
    expect(first.row.status).toBe('succeeded');
    const again = await runXometryTick(w.env, w.ports, w.p5, { slot: slotOf('06:00'), run_id: first.run_id });
    expect(again).toEqual({ status: 'none', reason: 'not_running', alerts: [] });
    expect(partnerCalls(w)).toHaveLength(1);
    expect(await runXometryTick(w.env, w.ports, w.p5, { slot: slotOf('06:00'), run_id: '00000000-0000-4000-8000-000000000000' })).toEqual({ status: 'none', reason: 'run_missing', alerts: [] });
  });

  it('overlap: another running run started 5 min earlier -> skipped {reason: overlap} without a call', async () => {
    const w = world();
    setFlag(w, true);
    board(w, Response.json(gqlPage([])));
    w.clock.set(at('05:55'));
    await openRun(w.db, { agent: 'growth.xometry', trigger: 'manual', idempotency_key: 'growth.xometry:manual-1' });
    const { row } = await tick(w);
    expect(row.status).toBe('skipped');
    expect(row.output).toMatchObject({ reason: 'overlap' });
    expect(partnerCalls(w)).toHaveLength(0);
  });

  it('not configured: skipped {auth: not_configured}; one alert per UTC day', async () => {
    const w = world({ token: null });
    setFlag(w, true);
    const a = await tick(w, '06:00');
    expect(a.row.status).toBe('skipped');
    expect(a.row.output).toMatchObject({ reason: 'not_configured', auth: 'not_configured', alerts: ['not_configured'] });
    await tick(w, '08:00');
    await tick(w, '06:00', '2026-10-09');
    expect(w.p5.telegramText.texts()).toEqual([
      'Xometry scan is switched on but neither XOMETRY_TOKEN nor XOMETRY_COOKIE is set in workers/ops; scans are skipped. Set it with `npx wrangler secret put XOMETRY_TOKEN` in workers/ops.',
      'Xometry scan is switched on but neither XOMETRY_TOKEN nor XOMETRY_COOKIE is set in workers/ops; scans are skipped. Set it with `npx wrangler secret put XOMETRY_TOKEN` in workers/ops.',
    ]);
    expect(partnerCalls(w)).toHaveLength(0);
  });
});

describe('scan in assist mode', () => {
  it('two pages: rows upserted in xometry_offers, run succeeded with the output of xc §2.6 step 7, no alert', async () => {
    const w = world();
    setFlag(w, true, 'assist');
    board(
      w,
      Response.json(gqlPage([makeOffer('HJO-CNC'), makeOffer('HJO-LASER', { parts: [makePart({ tags: [{ id: 36, name: 'Laser Cutting', context: 'production_methods' }] })] })], { hasMore: true })),
      Response.json(gqlPage([makeOffer('HJO-COATED', { parts: [makePart({ tags: [MILLING_TAG, ANODIZING_TAG] })] }), makeOffer('HJO-PDF', { parts: [makePart({ files: [PDF_FILE] })] })], { offset: 20 })),
    );
    const { result, row } = await tick(w);
    expect(result.status).toBe('succeeded');
    expect(row.status).toBe('succeeded');
    expect(row.error).toBeNull();
    const fp = createHash('sha256').update(`${TOKEN}\n`).digest('hex').slice(0, 12);
    expect(await tokenFingerprint(TOKEN, undefined)).toBe(fp);
    expect(row.output).toEqual({
      mode: 'assist',
      slot: slotOf('06:00'),
      auth: 'ok',
      token_fp: fp,
      scanned: 4,
      preset_rejected: 1,
      excluded_secondary: 1,
      upserted: 2,
      inserted_new: 3,
      needs_manual: 1,
      computed: 0,
      pages: 2,
      page_cap_hit: false,
      partial: false,
      errors: [],
      alerts: [],
    });
    expect(offers(w).map((r) => [r.code, r.status]).sort()).toEqual([
      ['HJO-CNC', 'new'],
      ['HJO-COATED', 'excluded_secondary_ops'],
      ['HJO-PDF', 'needs_manual'],
    ]);
    expect(w.p5.telegramText.messages).toHaveLength(0);
    const calls = partnerCalls(w);
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers['user-agent']).toBe('microns-ops-xometry-scan/1 (+https://www.micronshub.eu)');
    expect(w.ports.events.points).toEqual([
      expect.objectContaining({ event: 'xometry_tick', agent: 'growth.xometry', step: slotOf('06:00'), outcome: 'succeeded', attempt: 1 }),
    ]);
  });

  it('a re-scan refreshes the seven refresh columns and sets updated_at; a priced row goes through the compute pass', async () => {
    const w = world();
    setFlag(w, true);
    board(w, Response.json(gqlPage([makeOffer('HJO-1')])));
    await tick(w, '06:00');
    await w.db.update('xometry_offers', { status: 'priced', buyer_price: 1000 }, { filters: [['code', 'eq', 'HJO-1']] });
    w.sources.route({ method: 'POST', match: GRAPHQL, respond: () => Response.json(gqlPage([makeOffer('HJO-1', { cost: { amount: 700.0, currency: 'EUR' }, isUrgent: true })])) });
    const { row } = await tick(w, '08:00');
    expect(row.output).toMatchObject({ upserted: 1, inserted_new: 0, computed: 1 });
    const stored = offers(w)[0];
    expect(stored).toMatchObject({ partner_cost: 700.0, is_urgent: true, status: 'ready', suggested_price: 805.0, suggested_leadtime: '2026-10-22', updated_at: new Date(at('08:00')).toISOString() });
  });

  it('borderline_exclude of the flag value excludes the borderline op (trimmed, lower-cased)', async () => {
    const w = world();
    setFlag(w, true, 'assist', { borderline_exclude: [' Grinding ', '', 7] });
    board(w, Response.json(gqlPage([makeOffer('HJO-G', { parts: [makePart({ tags: [MILLING_TAG, GRINDING_TAG] })] })])));
    await tick(w);
    expect(offers(w)[0]).toMatchObject({ status: 'excluded_secondary_ops', excluded_reason: 'Grinding flat' });
  });

  it('shadow: nothing written to xometry_offers, no Telegram; the would-be writes and alerts are recorded', async () => {
    const w = world();
    setFlag(w, true, 'shadow');
    board(w, Response.json(gqlPage([makeOffer('HJO-1'), makeOffer('HJO-2')])));
    const { row } = await tick(w);
    expect(row.status).toBe('succeeded');
    expect(row.output).toMatchObject({ mode: 'shadow', scanned: 2, upserted: 2, inserted_new: 2, would_write: 2, alerts_shadow: [] });
    expect(offers(w)).toHaveLength(0);
    const v = world();
    setFlag(v, true, 'shadow');
    board(v, new Response(null, { status: 401 }));
    const rejected = await tick(v);
    expect(rejected.row.output).toMatchObject({ auth: 'rejected', alerts_shadow: ['token_rejected'] });
    expect((rejected.row.output as Json).alerts).toBeUndefined();
    expect(v.p5.telegramText.messages).toHaveLength(0);
  });

  it('notify_new: one summary of new offers (off by default)', async () => {
    const w = world();
    setFlag(w, true, 'assist', { notify_new: true });
    board(w, Response.json(gqlPage([makeOffer('HJO-1'), makeOffer('HJO-2', { parts: [makePart({ files: [PDF_FILE] })] })])));
    await tick(w);
    expect(w.p5.telegramText.texts()).toEqual(['Xometry: 2 new offers (1 needs_manual) → /dashboard/xometry']);
  });
});

describe('token gate (X-2)', () => {
  it('401: alert in the same tick, run failed with auth rejected; the next slot with the same fingerprint makes no call; 06:00 reminder; a new token scans again', async () => {
    const w = world();
    setFlag(w, true);
    board(w, new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    const first = await tick(w, '10:00');
    expect(first.row.status).toBe('failed');
    expect(first.row.error).toBe('token_rejected');
    expect(first.row.output).toMatchObject({ auth: 'rejected', http_status: 401, rejected_at: new Date(at('10:00')).toISOString(), scanned: 0, alerts: ['token_rejected'] });
    expect(w.p5.telegramText.texts()).toEqual([
      'Xometry partner API rejected the token (HTTP 401) at 10:00 UTC. Scans are paused until XOMETRY_TOKEN changes. Refresh: log in at partner.xometry.eu → DevTools → Application → Local Storage → authToken, then `npx wrangler secret put XOMETRY_TOKEN` in workers/ops (and the Supabase secret XOMETRY_PARTNER_AUTH_TOKEN if you submit counteroffers).',
    ]);
    expect(partnerCalls(w)).toHaveLength(1);

    const second = await tick(w, '12:00');
    expect(second.row.status).toBe('skipped');
    expect(second.row.output).toMatchObject({ reason: 'token_rejected', auth: 'rejected', token_fp: (first.row.output as Json).token_fp, rejected_at: new Date(at('10:00')).toISOString(), alerts: [] });
    expect(partnerCalls(w)).toHaveLength(1);

    const reminder = await tick(w, '06:00', '2026-10-09');
    expect(reminder.row.output).toMatchObject({ reason: 'token_rejected', alerts: ['token_reminder'] });
    expect(w.p5.telegramText.texts()[1]).toBe(
      'Reminder: Xometry scans are still paused since the partner API rejected the token (HTTP 401) on 2026-10-08 10:00 UTC. Refresh: log in at partner.xometry.eu → DevTools → Application → Local Storage → authToken, then `npx wrangler secret put XOMETRY_TOKEN` in workers/ops.',
    );
    expect(partnerCalls(w)).toHaveLength(1);

    w.env.XOMETRY_TOKEN = OTHER_TOKEN;
    board(w, Response.json(gqlPage([makeOffer('HJO-1')])));
    const renewed = await tick(w, '08:00', '2026-10-09');
    expect(renewed.row.status).toBe('succeeded');
    expect(renewed.row.output).toMatchObject({ auth: 'ok', scanned: 1 });
    expect(partnerCalls(w)).toHaveLength(2);
    expect(partnerCalls(w)[1].headers.authorization).toBe(`Bearer ${OTHER_TOKEN}`);
  });

  it('403 is a rejection too; a cookie change alone changes the fingerprint', async () => {
    const w = world({ cookie: 'sid=a' });
    setFlag(w, true);
    board(w, new Response(null, { status: 403 }));
    const first = await tick(w, '06:00');
    expect(first.row.output).toMatchObject({ auth: 'rejected', http_status: 403 });
    w.env.XOMETRY_COOKIE = 'sid=b';
    board(w, Response.json(gqlPage([])));
    const second = await tick(w, '08:00');
    expect(second.row.output).toMatchObject({ auth: 'ok' });
    expect((second.row.output as Json).token_fp).not.toBe((first.row.output as Json).token_fp);
  });

  it('an ok run after a rejection with the same fingerprint lifts the gate (the latest decided run counts)', async () => {
    const w = world();
    setFlag(w, true);
    board(w, new Response(null, { status: 401 }));
    await tick(w, '06:00');
    // A later manual run (e.g. after the partner side restored the token) answered ok.
    w.clock.set(at('07:00'));
    const manual = await openRun(w.db, { agent: 'growth.xometry', trigger: 'manual', idempotency_key: 'growth.xometry:manual' });
    await w.db.update('agent_runs', { status: 'succeeded', finished_at: new Date(at('07:00')).toISOString(), output: { auth: 'ok', token_fp: await tokenFingerprint(TOKEN, undefined) } }, { filters: [['id', 'eq', manual.run_id]] });
    board(w, Response.json(gqlPage([])));
    const { row } = await tick(w, '10:00');
    expect(row.output).toMatchObject({ auth: 'ok' });
  });

  it('JWT expiry hint: once per fingerprint when exp is within token_reminder_hours', async () => {
    const exp = Math.floor(at('12:00') / 1000);
    const jwt = jwtWithExp(exp);
    expect(jwt.startsWith('ey' + 'J')).toBe(true);
    const w = world({ token: jwt });
    setFlag(w, true);
    board(w, Response.json(gqlPage([])));
    const first = await tick(w, '06:00');
    expect(first.row.output).toMatchObject({ alerts: ['token_expiry'] });
    await tick(w, '08:00');
    expect(w.p5.telegramText.texts()).toEqual(['Xometry token expires at 2026-10-08 12:00 UTC; refresh before then.']);
    const far = world({ token: jwtWithExp(Math.floor(at('12:00', '2026-10-20') / 1000)) });
    setFlag(far, true);
    board(far, Response.json(gqlPage([])));
    await tick(far);
    expect(far.p5.telegramText.messages).toHaveLength(0);
    const short = world({ token: jwtWithExp(Math.floor(at('12:00', '2026-10-09') / 1000)) });
    setFlag(short, true, 'assist', { token_reminder_hours: 48 });
    board(short, Response.json(gqlPage([])));
    await tick(short);
    expect(short.p5.telegramText.texts()).toEqual(['Xometry token expires at 2026-10-09 12:00 UTC; refresh before then.']);
  });
});

describe('failures and their repeat rules', () => {
  it('HTTP 500: failed scan_failed:http with the status; one alert per kind and UTC day', async () => {
    const w = world();
    setFlag(w, true);
    board(w, new Response('upstream', { status: 500 }));
    const first = await tick(w, '06:00');
    expect(first.row.status).toBe('failed');
    expect(first.row.error).toBe('scan_failed:http');
    expect(first.row.output).toMatchObject({ auth: 'unknown', error_kind: 'http', http_status: 500, errors: ['scan: partner API returned 500'], alerts: ['scan_failed:http'] });
    await tick(w, '08:00');
    await tick(w, '06:00', '2026-10-09');
    expect(w.p5.telegramText.texts()).toEqual([
      'Xometry scan failed: http 500; first error: partner API returned 500.',
      'Xometry scan failed: http 500; first error: partner API returned 500.',
    ]);
  });

  it('GraphQL errors and a schema error are their own kinds; the auth state is ok when the API answered 2xx', async () => {
    const w = world();
    setFlag(w, true);
    board(w, Response.json({ errors: [{ message: 'boom' }], data: null }));
    const graphql = await tick(w, '06:00');
    expect(graphql.row.output).toMatchObject({ auth: 'ok', error_kind: 'graphql', alerts: ['scan_failed:graphql'] });
    board(w, Response.json(gqlPage([makeOffer('A'), makeOffer('B', { isUrgent: null })])));
    const schema = await tick(w, '08:00');
    expect(schema.row.error).toBe('scan_failed:schema');
    expect(schema.row.output).toMatchObject({ error_kind: 'schema', scanned: 0, alerts: ['scan_failed:schema'] });
    expect(offers(w)).toHaveLength(0);
    expect(w.p5.telegramText.texts()[0]).toBe('Xometry scan failed: graphql 200; first error: [{"message":"boom"}].');
  });

  it('a network failure is kind network; the compute pass is skipped after a failed scan', async () => {
    const w = world();
    setFlag(w, true);
    w.sources.route({ method: 'POST', match: GRAPHQL, respond: () => Promise.reject(new TypeError('fetch failed')) });
    const { row } = await tick(w);
    expect(row.output).toMatchObject({ error_kind: 'network', computed: 0, auth: 'unknown' });
  });

  it('per-offer store errors: the other offers are written, the run is failed offer_errors, one alert per tick', async () => {
    const w = world();
    const memory = w.db;
    const failing: Db = {
      select: (t, o) => memory.select(t, o),
      update: (t, p, o) => memory.update(t, p, o),
      rpc: (n, a) => memory.rpc(n, a),
      insert: async (t, rows, o) => {
        if (t === 'xometry_offers' && (rows as Json).code === 'HJO-BAD') throw new DbError(500, null, 'postgrest POST xometry_offers: 500');
        return memory.insert(t, rows, o);
      },
    };
    (w.ports as unknown as { db: Db }).db = failing;
    setFlag(w, true);
    board(w, Response.json(gqlPage([makeOffer('HJO-BAD'), makeOffer('HJO-OK')])));
    const { row } = await tick(w);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('offer_errors');
    expect(row.output).toMatchObject({ scanned: 2, upserted: 1, errors: ['HJO-BAD: postgrest POST xometry_offers: 500'], alerts: ['offer_errors'] });
    expect(memory.rows('xometry_offers').map((r) => r.code)).toEqual(['HJO-OK']);
    expect(w.p5.telegramText.texts()).toEqual(['Xometry scan finished with 1 offer errors (e.g. HJO-BAD: postgrest POST xometry_offers: 500).']);
  });

  it('page cap: 100 pages that all say hasMore -> page_cap_hit, alert once per UTC day', async () => {
    const w = world();
    setFlag(w, true);
    board(w, () => Response.json(gqlPage([], { hasMore: true })));
    const { row } = await tick(w, '06:00');
    expect(row.output).toMatchObject({ pages: SCAN_MAX_PAGES, page_cap_hit: true, alerts: ['page_cap'] });
    expect(row.status).toBe('succeeded');
    await tick(w, '08:00');
    expect(w.p5.telegramText.texts()).toEqual(['Xometry board exceeded 100 pages; scan truncated.']);
  });
});

describe('budget (9,000 counted subrequests, 10 min wall time)', () => {
  it('defaults; the worst case board (100 pages x 20 offers, 3 requests each) stays inside the budget', async () => {
    expect(SUBREQUEST_STOP).toBe(9_000);
    expect(WALL_STOP_MS).toBe(600_000);
    const w = world();
    const started = new Date(at('06:00')).toISOString();
    // Every upsert takes all three requests (insert ignored, refresh refused, terminal read empty).
    (w.ports as unknown as { db: Db }).db = {
      select: async (t, o) => (t === 'agent_runs' && o?.filters?.[0]?.[0] === 'id' ? [{ id: 'r', status: 'running', started_at: started }] : []),
      update: async () => [],
      rpc: async () => null,
      insert: async () => [],
    } as Db;
    setFlag(w, true);
    let n = 0;
    board(w, () => Response.json(gqlPage(Array.from({ length: 20 }, () => makeOffer(`HJO-${++n}`)), { hasMore: true })));
    const result = await runXometryTick(w.env, w.ports, w.p5, { slot: slotOf('06:00'), run_id: 'r' });
    expect(result.output).toMatchObject({ scanned: 2000, upserted: 2000, partial: false, page_cap_hit: true });
  });

  it('a lower subrequest limit stops writing and records partial: true (no compute pass)', async () => {
    const w = world();
    setFlag(w, true);
    board(w, Response.json(gqlPage(Array.from({ length: 20 }, (_, i) => makeOffer(`HJO-${i}`)), { hasMore: true })));
    const { row } = await tick(w, '06:00', DAY, { subrequestStop: 10 });
    expect(row.output).toMatchObject({ partial: true, computed: 0 });
    const scanned = (row.output as Json).scanned as number;
    expect(scanned).toBeGreaterThan(0);
    expect(scanned).toBeLessThan(20);
    expect(offers(w)).toHaveLength(scanned);
    expect(partnerCalls(w)).toHaveLength(1);
  });

  it('the wall-time limit stops the scan the same way', async () => {
    const w = world();
    setFlag(w, true);
    let page = 0;
    board(w, () => {
      page++;
      w.clock.advance(4 * 60_000);
      return Response.json(gqlPage([makeOffer(`HJO-${page}`)], { hasMore: true }));
    });
    const { row } = await tick(w);
    expect(row.output).toMatchObject({ partial: true });
    expect(partnerCalls(w).length).toBeLessThan(5);
  });
});

describe('no credential in the run, the texts or the logs', () => {
  it('the token and cookie never appear in agent_runs, Telegram or a log line', async () => {
    const cookie = `sid=${OTHER_TOKEN}`;
    const w = world({ cookie });
    setFlag(w, true);
    board(w, new Response(null, { status: 401 }));
    await tick(w, '06:00');
    board(w, new Response('x', { status: 500 }));
    await tick(w, '06:00', '2026-10-09');
    const everything = JSON.stringify(w.db.tables) + JSON.stringify(w.p5.telegramText.messages) + logger.lines.join('\n') + JSON.stringify(w.ports.events.points);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(OTHER_TOKEN);
  });
});
