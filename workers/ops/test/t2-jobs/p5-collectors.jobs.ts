// T2 (profile 'jobs', real workerd): the scheduled collectors, one tick per job. The every-minute cron is fired through
// the Local Explorer at 06:00 of a day no other file uses; the dispatcher (unit K5) opens the runs and sends the
// scrapes messages, the local scrapes consumer hands them to the G5 handlers, which read the mini-PostgREST, call the
// PullPush and Algolia stubs and send plain sendMessage requests to the Telegram stub. Checks: every run closed with
// its counts; leads rows written once (a stored row neither re-inserted nor alerted, D-14); the alert request bodies
// byte-equal to what the live functions send for the same posts (test/p5/collectors/live-source.ts); the tender
// child of the only due connector runs the real api/tender-scan.js in-process, which refuses the unknown country
// with 400 before any I/O (no real scan runs in T2). A second tick, a day later, with reddit and tenders in shadow and
// hn off: reddit fetches without writing, the tender child closes skipped (shadow), no hn run exists.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { P5MemoryDb } from '../../src/ports/p5-stub/index';
import { fixture, type AlgoliaFixture, type FixtureKeyword, type PullpushFixture } from '../p5/collectors/fixtures';
import { fakeSupabase, loadLive } from '../p5/collectors/live-source';
import { call, flagValue, globalUrls, json, JSON_HEADERS, restoreFlag, rows, seed, setFlag, until, type Row } from '../quote/t2-helpers';

const PROFILE = process.env.T2_PROFILE ?? '';
const ENABLED = Boolean(process.env.T2_STUB_URL) && PROFILE === 'jobs';

/** Tuesday 2032-02-10 06:00 UTC and the day after: slots no other T2 file uses. */
const TICK1 = Date.UTC(2032, 1, 10, 6, 0);
const TICK2 = Date.UTC(2032, 1, 11, 6, 0);
const SLOT1 = '2032-02-10T06:00Z';
const SLOT2 = '2032-02-11T06:00Z';
const FLAG_KEYS = ['agent.growth.reddit', 'agent.growth.hn', 'agent.growth.tenders', 'agent.growth.xometry'] as const;

interface TelegramCall {
  method: string;
  body: { chat_id?: string; text?: string };
  raw: string;
}

describe.skipIf(!ENABLED)('scheduled collectors in workerd (T2, profile jobs)', () => {
  const u = globalUrls();
  const saved = new Map<string, string | null>();
  const start = Date.now();
  const created = Math.floor(start / 1000) - 3 * 3600;
  const posts = fixture<PullpushFixture>('pullpush.json');
  const algolia = fixture<AlgoliaFixture>('algolia.json');
  const pick = (sub: string, ids: string[]): Row[] => (posts[sub].posts ?? []).filter((p) => ids.includes(String(p.id))).map((p): Row => ({ ...p, created_utc: created }));
  const hits = (list: Row[] | undefined): Row[] => (list ?? []).map((h): Row => ({ ...h, created_at_i: created, created_at: new Date(created * 1000).toISOString() }));
  const script = {
    pullpush: { subreddits: { machining: { posts: pick('machining', ['t1a', 't1b', 't1c']) }, cnc: { posts: pick('cnc', ['t2a']) }, hardware: { posts: pick('hardware', ['t3a', 't3b']) } } },
    hn: {
      queries: {
        'CNC machining': { hits: hits(algolia.queries['CNC machining'].hits) },
        manufacturing: { hits: hits(algolia.queries.manufacturing.hits) },
        Protolabs: { status: 500 },
        show_hn: { hits: hits(algolia.show_hn.hits) },
      },
    },
  };
  const t3a = script.pullpush.subreddits.hardware.posts.find((p) => p.id === 't3a')!;

  // lead alerts only (another file's in-flight work could reach the Telegram stub too)
  const telegram = async () => (await json<TelegramCall[]>(await call(`${u.stub}/__stub/telegram/calls`))).filter((c) => c.method === 'sendMessage' && /LEAD/.test(String(c.body.text)));
  const runs = async (prefix: string) => (await rows(u, 'agent_runs')).filter((r) => String(r.idempotency_key).startsWith(prefix));
  const cron = async (at: number) => {
    const res = await call(`${u.explorer}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ cron: '* * * * *', scheduled_time: at }) });
    expect(res.status).toBe(200);
  };
  const settled = (list: Row[], n: number) => list.length === n && list.every((r) => r.status !== 'running');

  beforeAll(async () => {
    for (const key of FLAG_KEYS) saved.set(key, await flagValue(u, key));
    await call(`${u.stub}/__stub/reset`, { method: 'POST' });
    const now = Date.now();
    await seed(u, {
      lead_keywords: fixture<FixtureKeyword[]>('keywords.json').map((k, i) => ({ id: i + 1, ...k })),
      monitored_subreddits: [
        { id: 1, subreddit: 'machining', source: 'reddit', tier: 1, scan_interval_minutes: 30, is_active: true, last_scanned_at: null },
        { id: 2, subreddit: 'cnc', source: 'reddit', tier: 2, scan_interval_minutes: 30, is_active: true, last_scanned_at: null },
        { id: 3, subreddit: 'hardware', source: 'reddit', tier: 3, scan_interval_minutes: null, is_active: true, last_scanned_at: null },
        { id: 4, subreddit: 'fresh', source: 'reddit', tier: 1, scan_interval_minutes: 30, is_active: true, last_scanned_at: new Date(now - 5 * 60_000).toISOString() },
      ],
      leads: [
        { source: 'hackernews', external_id: '40999999', title: 'older lead', posted_at: new Date(now - 6 * 3600_000).toISOString(), source_url: null },
        { source: 'reddit', external_id: 't3a', title: 'stored before', source_url: `https://reddit.com${t3a.permalink}`, posted_at: new Date(now - 7 * 3600_000).toISOString() },
      ],
      tender_connectors: [
        { country_code: 'XX', is_active: true, last_scan_at: null },
        // a code the handler refuses before any I/O (no real connector code in a T2 file: its portals have no stub)
        { country_code: 'YY', is_active: true, last_scan_at: '2032-02-10T05:00:00.000Z' },
      ],
    });
    await call(`${u.stub}/__stub/pullpush/script`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(script.pullpush) });
    await call(`${u.stub}/__stub/hn/script`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(script.hn) });
    await setFlag(u, 'agent.growth.reddit', { enabled: true, mode: 'assist', value: { mode: 'assist' }, rev: 601 });
    await setFlag(u, 'agent.growth.hn', { enabled: true, mode: 'assist', value: { mode: 'assist' }, rev: 601 });
    await setFlag(u, 'agent.growth.tenders', { enabled: true, mode: 'assist', value: { mode: 'assist' }, rev: 601 });
    await setFlag(u, 'agent.growth.xometry', { enabled: false, mode: 'shadow', value: {}, rev: 601 });
  }, 120_000);

  afterAll(async () => {
    for (const [key, raw] of saved) await restoreFlag(u, key, raw);
  });

  it('tick 1 (assist): reddit t1-t3, hn and the tender parent close with their counts', async () => {
    await cron(TICK1);
    const growth = await until('the five dispatcher runs and the tender child settled', async () => {
      const list = [
        ...(await runs(`growth.reddit:t1:${SLOT1}`)), ...(await runs(`growth.reddit:t2:${SLOT1}`)), ...(await runs(`growth.reddit:t3:${SLOT1}`)),
        ...(await runs(`growth.hn:${SLOT1}`)), ...(await runs('growth.tenders:2032-02-10')),
      ];
      return settled(list, 6) ? list : null;
    }, 60_000);
    const byKey = (k: string) => growth.find((r) => r.idempotency_key === k)!;
    for (const k of [`growth.reddit:t1:${SLOT1}`, `growth.reddit:t2:${SLOT1}`, `growth.reddit:t3:${SLOT1}`, `growth.hn:${SLOT1}`]) {
      expect(byKey(k), k).toMatchObject({ status: 'succeeded', trigger: 'cron' });
    }
    const reddit = [1, 2, 3].map((t) => byKey(`growth.reddit:t${t}:${SLOT1}`).output as Row);
    const sum = (f: string) => reddit.reduce((n, o) => n + Number(o[f] ?? 0), 0);
    // the three tier ticks share subreddits; every due one is scanned (by whichever tick reached it first)
    expect(sum('leads_new')).toBe(4);
    expect(sum('high')).toBe(2);
    expect(sum('errors')).toBe(0);
    expect(byKey(`growth.hn:${SLOT1}`).output).toEqual({ scanned: 5, matched: 3, leads_new: 3, high_or_medium: 3, errors: 0, algolia_status: { 200: 15, 500: 1 } });
    expect(byKey('growth.tenders:2032-02-10').output).toEqual({ due: 1, enqueued: 1, countries: null });
    expect(await runs(`growth.xometry:${SLOT1}`)).toEqual([]);
  });

  it('tick 1: the tender child ran the real api/tender-scan.js in-process (400 for the unknown country)', async () => {
    const [child] = await runs('growth.tenders:2032-02-10:');
    expect(child).toMatchObject({ idempotency_key: 'growth.tenders:2032-02-10:XX', trigger: 'queue', status: 'failed', error: 'handler_400', output: { status: 400, country_code: 'XX' } });
    const [parent] = (await runs('growth.tenders:2032-02-10')).filter((r) => r.idempotency_key === 'growth.tenders:2032-02-10');
    expect(child.parent_run_id).toBe(parent.id);
  });

  it('tick 1: leads written once, the stored row untouched, last_scanned_at stamped, PullPush called with the live User-Agent', async () => {
    const leads = await rows(u, 'leads');
    const reddit = leads.filter((l) => l.source === 'reddit').map((l) => l.external_id).sort();
    expect(reddit).toEqual(['t1a', 't1b', 't2a', 't3a', 't3b']);
    expect(leads.find((l) => l.external_id === 't3a')?.title).toBe('stored before');
    expect(leads.filter((l) => l.source === 'hackernews').map((l) => l.external_id).sort()).toEqual(['40999999', '41000001', '41000003', '41000005']);
    const subs = await rows(u, 'monitored_subreddits');
    for (const name of ['machining', 'cnc', 'hardware']) expect(Date.parse(String(subs.find((s) => s.subreddit === name)?.last_scanned_at)), name).toBeGreaterThanOrEqual(start);
    expect(Date.parse(String(subs.find((s) => s.subreddit === 'fresh')?.last_scanned_at))).toBeLessThan(start);
    const calls = await json<Array<{ subreddit: string; query: Record<string, string>; user_agent: string | null }>>(await call(`${u.stub}/__stub/pullpush/calls`));
    expect([...new Set(calls.map((c) => c.subreddit))].sort()).toEqual(['cnc', 'hardware', 'machining']);
    for (const c of calls) {
      expect(c.user_agent).toBe('MicronsHubLeadMonitor/1.0');
      expect(c.query).toMatchObject({ sort: 'new', sort_type: 'created_utc', size: '100' });
    }
  });

  it('tick 1: alert request bodies are byte-equal to the live functions for the inserted high (reddit) and high/medium (hn) leads', async () => {
    const sent = await telegram();
    expect(sent).toHaveLength(5);
    const chat = String(sent[0].body.chat_id);
    const bodies: string[] = [];
    const rt = {
      env: { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: chat, SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'x' },
      // the alerts touch no table; the client only has to exist
      supabase: fakeSupabase({ rows: () => [], insert: async () => [], update: async () => [] } as unknown as P5MemoryDb),
      fetch: async (_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        return new Response('{"ok":true}', { status: 200 });
      },
    };
    const liveReddit = loadLive('reddit-collector', rt);
    const liveHn = loadLive('hn-collector', rt);
    const keywords = fixture<FixtureKeyword[]>('keywords.json').filter((k) => k.is_active);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(start);
      for (const post of [...pick('machining', ['t1a']), ...pick('cnc', ['t2a'])]) {
        await liveReddit.sendTelegramNotification(post, liveReddit.matchKeywords(`${post.title} ${post.selftext || ''}`, keywords));
      }
      const allHits = [...script.hn.queries['CNC machining'].hits!, ...script.hn.queries.manufacturing.hits!, ...script.hn.queries.show_hn.hits!];
      for (const id of ['41000001', '41000003', '41000005']) {
        const hit = allHits.filter((x) => x.objectID === id).pop()!;
        await liveHn.sendTelegramNotification(hit, liveHn.matchKeywords(`${hit.title} ${hit.story_text || ''}`, keywords));
      }
    } finally {
      vi.useRealTimers();
    }
    expect(sent.map((c) => c.raw).sort()).toEqual(bodies.sort());
  });

  it('tick 2 (reddit and tenders shadow, hn off): no write, no alert; tender child skipped (shadow); no hn run', async () => {
    const leadsBefore = (await rows(u, 'leads')).length;
    const alertsBefore = (await telegram()).length;
    // make the three subreddits due again (stamped 31 minutes ago) so the shadow ticks fetch them
    const subs = await rows(u, 'monitored_subreddits');
    const stamp = new Date(Date.now() - 31 * 60_000).toISOString();
    await seed(u, { monitored_subreddits: subs.map((s) => (s.subreddit === 'fresh' ? s : { ...s, last_scanned_at: stamp })) }, true);
    await setFlag(u, 'agent.growth.reddit', { enabled: true, mode: 'shadow', value: { mode: 'shadow' }, rev: 602 });
    await setFlag(u, 'agent.growth.hn', { enabled: false, mode: 'shadow', value: {}, rev: 602 });
    await setFlag(u, 'agent.growth.tenders', { enabled: true, mode: 'shadow', value: { mode: 'shadow' }, rev: 602 });
    await cron(TICK2);
    const list = await until('the tick-2 runs settled', async () => {
      const l = [...(await runs(`growth.reddit:t1:${SLOT2}`)), ...(await runs(`growth.reddit:t2:${SLOT2}`)), ...(await runs(`growth.reddit:t3:${SLOT2}`)), ...(await runs('growth.tenders:2032-02-11'))];
      return settled(l, 6) ? l : null;
    }, 60_000);
    for (const r of list.filter((x) => String(x.agent) === 'growth.reddit')) expect(r).toMatchObject({ status: 'succeeded', output: { shadow: true, leads_new: 0, high: 0 } });
    const reddit = list.filter((x) => String(x.agent) === 'growth.reddit').map((r) => r.output as Row);
    expect(reddit.reduce((n, o) => n + Number(o.matched ?? 0), 0)).toBeGreaterThanOrEqual(5);
    // XX (never scanned) and YY (last scan more than 6 h before this tick) are due; shadow never runs the handler
    expect(list.find((r) => r.idempotency_key === 'growth.tenders:2032-02-11')).toMatchObject({ status: 'succeeded', output: { due: 2, enqueued: 2, countries: null } });
    for (const cc of ['XX', 'YY']) {
      expect(list.find((r) => r.idempotency_key === `growth.tenders:2032-02-11:${cc}`), cc).toMatchObject({ status: 'skipped', output: { reason: 'shadow', country_code: cc } });
    }
    expect(await runs(`growth.hn:${SLOT2}`)).toEqual([]);
    expect((await rows(u, 'leads')).length).toBe(leadsBefore);
    expect((await telegram()).length).toBe(alertsBefore);
    const after = await rows(u, 'monitored_subreddits');
    for (const s of after.filter((x) => x.subreddit !== 'fresh')) expect(s.last_scanned_at, String(s.subreddit)).toBe(stamp);
  });
});
