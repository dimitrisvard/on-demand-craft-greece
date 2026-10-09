// C5: translation backlog (oldest English article first, at most N per language, today's group left out), the flag
// snapshot, IndexNow requests and the SEO cache purge.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { backfillCap, englishMasters, pairKey, planBackfill, presentLanguages, recentPairOutcomes } from '../../../src/content/backfill';
import { mustHalt, snapshotFlag } from '../../../src/content/flag';
import { submitIndexNow, translationUrls } from '../../../src/content/indexnow';
import { blogSegment, TARGET_LANGS } from '../../../src/content/languages';
import { translateRunKey } from '../../../src/content/report';
import { listKey, purgeSeoKeys, translationsKey } from '../../../src/content/seo-purge';
import { failText, okText, P5MemoryDb, ScriptedSources } from '../../../src/ports/p5-stub/index';
import { translationsConsumer } from '../../../src/queues/translations';
import { FakeKV } from '../../helpers/agent-env';
import { testContext } from '../../helpers/ops';
import { delimiterAnswer } from './fixtures';
import { batchOf, contentHarness, INDEXNOW_TEST_KEY, message, SITE, uuid } from './helpers';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

function seed() {
  const db = new P5MemoryDb();
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 8; i++) {
    rows.push({ id: uuid('e', i), slug: `en-${i}`, language: 'en', status: i === 8 ? 'draft' : 'published', translation_id: uuid('7', i), created_at: `2026-09-${String(30 - i).padStart(2, '0')}T07:00:00Z` });
  }
  rows.push({ id: uuid('e', 99), slug: 'en-no-group', language: 'en', status: 'published', translation_id: null, created_at: '2026-01-01T07:00:00Z' });
  // de complete for 1..7; fi only for 7; pt for 6 and 7 (one draft row still counts as present)
  for (let i = 1; i <= 7; i++) rows.push({ id: uuid('d', i), slug: `de-${i}`, language: 'de', status: 'published', translation_id: uuid('7', i), created_at: '2026-09-30T08:00:00Z' });
  rows.push({ id: uuid('f', 7), slug: 'fi-7', language: 'fi', status: 'published', translation_id: uuid('7', 7), created_at: '2026-09-30T08:00:00Z' });
  rows.push({ id: uuid('a', 6), slug: 'pt-6', language: 'pt', status: 'draft', translation_id: uuid('7', 6), created_at: '2026-09-30T08:00:00Z' });
  rows.push({ id: uuid('a', 7), slug: 'pt-7', language: 'pt', status: 'published', translation_id: uuid('7', 7), created_at: '2026-09-30T08:00:00Z' });
  db.seed('articles', rows);
  return db;
}

describe('backfill plan', () => {
  it('oldest first, cap per language, today excluded, present languages (any status) skipped', async () => {
    const db = seed();
    const masters = await englishMasters(db);
    // oldest created_at first: en-7 (09-23) ... en-1 (09-29); the draft and the group-less article are left out
    expect(masters.map((m) => m.slug)).toEqual(['en-7', 'en-6', 'en-5', 'en-4', 'en-3', 'en-2', 'en-1']);
    const present = await presentLanguages(db);
    const plan = planBackfill(masters, present, { cap: 2, exclude: new Set([uuid('7', 6)]), for_date: '2026-10-08', parent_run_id: uuid('9', 1) });
    const by = (lang: string) => plan.filter((m) => m.language === lang).map((m) => m.translation_id);
    expect(by('de')).toEqual([]);
    expect(by('fi')).toEqual([uuid('7', 5), uuid('7', 4)]);
    expect(by('pt')).toEqual([uuid('7', 5), uuid('7', 4)]);
    expect(by('fr')).toEqual([uuid('7', 7), uuid('7', 5)]);
    expect(plan.length).toBe(2 * 12);
    expect(plan.every((m) => m.origin === 'backfill' && m.v === 1 && m.for_date === '2026-10-08' && m.parent_run_id === uuid('9', 1))).toBe(true);
    expect(plan.find((m) => m.translation_id === uuid('7', 7))?.en_article_id).toBe(uuid('e', 7));
    expect(planBackfill(masters, present, { cap: 0, exclude: new Set(), for_date: 'x', parent_run_id: 'y' })).toEqual([]);
  });

  it('recent outcomes: a slug conflict holds the pair, another failure moves it behind the rest, the cap is filled with the next oldest', async () => {
    const db = seed();
    const masters = await englishMasters(db);
    const present = await presentLanguages(db);
    const recent = new Map([
      [pairKey(uuid('7', 7), 'fr'), 'conflict' as const],
      [pairKey(uuid('7', 5), 'fr'), 'failed' as const],
      [pairKey(uuid('7', 4), 'es'), 'failed' as const],
    ]);
    const plan = planBackfill(masters, present, { cap: 2, exclude: new Set(), for_date: '2026-10-08', parent_run_id: uuid('9', 1), recent });
    const by = (lang: string) => plan.filter((m) => m.language === lang).map((m) => m.translation_id);
    // fr: 7 held, 5 failed -> 6 and 4 first
    expect(by('fr')).toEqual([uuid('7', 6), uuid('7', 4)]);
    // es: 4 failed, but 7 and 6 come first anyway
    expect(by('es')).toEqual([uuid('7', 7), uuid('7', 6)]);
    // a failed pair is still planned when nothing else is missing
    const only = planBackfill(masters.slice(0, 1), present, { cap: 5, exclude: new Set(), for_date: '2026-10-08', parent_run_id: uuid('9', 1), recent: new Map([[pairKey(uuid('7', 7), 'it'), 'failed' as const]]) });
    expect(only.filter((m) => m.language === 'it').map((m) => m.translation_id)).toEqual([uuid('7', 7)]);
  });

  it('recentPairOutcomes: failed translate runs of the last 7 days by pair; slug_conflict wins; other agents, statuses and older runs ignored', async () => {
    const db = new P5MemoryDb();
    let n = 0;
    const run = (tid: string, lang: string, day: string, status: string, error: string | null, started: string, agent = 'content_daily.translate') =>
      ({ id: uuid('5', ++n), agent, trigger: 'queue', idempotency_key: agent === 'content_daily.translate' ? translateRunKey(tid, lang, day) : `${agent}:${day}`, status, error, started_at: started });
    // ids ascending in this order: the conflict of 7_1/de is read before its later failures
    db.seed('agent_runs', [
      run(uuid('7', 1), 'de', '2026-10-06', 'failed', 'slug_conflict', '2026-10-06T07:10:00Z'),
      run(uuid('7', 1), 'de', '2026-10-05', 'failed', 'GeminiOverloadedError', '2026-10-05T07:10:00Z'),
      run(uuid('7', 1), 'de', '2026-10-07', 'failed', 'ArticleRejectedError', '2026-10-07T07:10:00Z'),
      run(uuid('7', 2), 'fi', '2026-10-01', 'failed', 'slug_conflict', '2026-10-01T07:10:00Z'),
      run(uuid('7', 3), 'fi', '2026-09-30', 'failed', 'slug_conflict', '2026-09-30T23:59:00Z'),
      run(uuid('7', 4), 'nl', '2026-10-07', 'succeeded', null, '2026-10-07T07:10:00Z'),
      run(uuid('7', 5), 'nl', '2026-10-07', 'skipped', null, '2026-10-07T07:10:00Z'),
      run(uuid('7', 6), 'pt', '2026-10-07', 'failed', 'x', '2026-10-07T07:10:00Z', 'content_daily'),
    ]);
    const recent = await recentPairOutcomes(db, '2026-10-08');
    expect([...recent.entries()].sort()).toEqual([
      [pairKey(uuid('7', 1), 'de'), 'conflict'],
      [pairKey(uuid('7', 2), 'fi'), 'conflict'],
    ].sort());
    // a week later the conflict of 10-06 has expired; the failure of 10-07 still moves the pair back
    const later = await recentPairOutcomes(db, '2026-10-14');
    expect(later.get(pairKey(uuid('7', 1), 'de'))).toBe('failed');
    expect(later.has(pairKey(uuid('7', 2), 'fi'))).toBe(false);
  });

  it('a backlog whose oldest pairs never land does not stall: the 6th missing pair is planned on day 2 and held pairs cost no model call', async () => {
    const h = contentHarness();
    const rows: Array<Record<string, unknown>> = [];
    for (let k = 1; k <= 6; k++) {
      rows.push({ id: uuid('e0', k), title: `Guide ${k}`, slug: `guide-${k}`, content: `<p>${'word '.repeat(300)}</p>`, language: 'en', status: 'published', translation_id: uuid('70', k), created_at: `2026-09-0${k}T07:00:00Z` });
      TARGET_LANGS.filter((l) => l !== 'de').forEach((l, i) => rows.push({ id: uuid(`d${k}`, i + 1), slug: `g${k}-${l}`, language: l, status: 'published', translation_id: uuid('70', k) }));
    }
    // an unrelated German article already owns the slug the model returns for groups 1-5
    rows.push({ id: uuid('dd', 99), slug: 'leitfaden', language: 'de', status: 'published', translation_id: uuid('71', 99) });
    h.db.seed('articles', rows);
    h.p5.textLlm.setScript((call) =>
      call.input.includes('word word')
        ? okText(delimiterAnswer({ title: 'Leitfaden', slug: call.input.includes('Guide 6') ? 'leitfaden-sechs' : 'leitfaden', content: `<p>${'Wort '.repeat(300)}</p>` }), { model: call.model, stop: 'STOP' })
        : failText('other', { status: 400 }),
    );
    h.p5.sources.route({ method: 'POST', match: 'https://indexnow.test/indexnow', respond: new Response('', { status: 200 }) });
    const planned: string[][] = [];
    for (const [i, day] of ['2026-10-08', '2026-10-09', '2026-10-10'].entries()) {
      h.clock.set(Date.UTC(2026, 9, 8 + i, 7, 0, 0));
      const msgs = planBackfill(await englishMasters(h.db), await presentLanguages(h.db), { cap: 5, exclude: new Set(), for_date: day, parent_run_id: uuid('9', 1), recent: await recentPairOutcomes(h.db, day) });
      planned.push(msgs.map((m) => `${m.translation_id.slice(-1)}:${m.language}`));
      for (const b of msgs) {
        const m = message(b, 1, `${day}-${b.translation_id}`);
        await translationsConsumer(batchOf('translations', m), h.env, testContext(), { ports: h.ports, p5: h.p5, sleep: async () => {}, now: () => h.clock.now().getTime() });
        expect(m.acked).toBe(true);
      }
    }
    expect(planned).toEqual([['1:de', '2:de', '3:de', '4:de', '5:de'], ['6:de'], []]);
    expect(h.p5.textLlm.calls.length).toBe(6);
    const runs = h.db.rows('agent_runs').filter((r) => r.agent === 'content_daily.translate');
    expect(runs.filter((r) => r.status === 'failed' && r.error === 'slug_conflict')).toHaveLength(5);
    expect(h.db.rows('articles').filter((a) => a.language === 'de' && a.translation_id === uuid('70', 6))).toHaveLength(1);
    expect(h.p5.telegramText.messages).toHaveLength(5);
  });

  it('cap and flag value parsing', () => {
    expect(backfillCap({})).toBe(5);
    expect(backfillCap({ backfill_per_language_per_day: 2 })).toBe(2);
    expect(backfillCap({ backfill_per_language_per_day: -1 })).toBe(5);
    expect(backfillCap({ backfill_per_language_per_day: '3' })).toBe(5);
    const all = snapshotFlag({ enabled: true, mode: 'assist', value: {} });
    expect(all.steps).toEqual(['generate', 'translate', 'fix_links', 'sitemap']);
    expect(all.model).toBe('claude-sonnet-5');
    const some = snapshotFlag({ enabled: true, mode: 'shadow', value: { steps: ['sitemap', 'bogus', 'translate'], model: ' claude-x ', shadow_generate: true } });
    expect(some).toEqual({ enabled: true, mode: 'shadow', steps: ['translate', 'sitemap'], model: 'claude-x', backfill_per_language_per_day: 5, shadow_generate: true, sitemap_accept_drop_on: null });
    const ack = (v: unknown) => snapshotFlag({ enabled: true, mode: 'assist', value: { sitemap_accept_drop_on: v } }).sitemap_accept_drop_on;
    expect(ack('2026-10-09')).toBe('2026-10-09');
    expect([ack('2026-02-30'), ack('2026-10-09T00:00:00Z'), ack(20261009), ack(true)]).toEqual([null, null, null, null]);
    expect(mustHalt('assist', { ...all, mode: 'shadow' })).toBe(true);
    expect(mustHalt('shadow', { ...all, mode: 'shadow' })).toBe(false);
    expect(mustHalt('assist', { ...all, enabled: false })).toBe(true);
  });
});

describe('IndexNow', () => {
  it('posts host, key, keyLocation and the two URLs (per-language blog segment)', async () => {
    const sources = new ScriptedSources({ routes: [{ method: 'POST', match: 'https://indexnow.test/indexnow', respond: new Response('', { status: 202 }) }] });
    const urls = translationUrls(SITE, 'en-guide', 'sv', 'sv-guide');
    expect(urls).toEqual([`${SITE}/en/blog/en-guide`, `${SITE}/sv/blogg/sv-guide`]);
    expect(await submitIndexNow(sources, { key: INDEXNOW_TEST_KEY, siteOrigin: SITE, urls })).toBe(true);
    expect(JSON.parse(sources.requests[0].body!)).toEqual({ host: 'www.micronshub.eu', key: INDEXNOW_TEST_KEY, keyLocation: `${SITE}/indexnow_key.txt`, urlList: urls });
    expect(sources.requests[0].headers['content-type']).toBe('application/json');
  });

  it('not configured without a key; false on an error answer; never throws', async () => {
    const sources = new ScriptedSources();
    expect(await submitIndexNow(sources, { key: undefined, siteOrigin: SITE, urls: [`${SITE}/en/blog/x`] })).toBe('not_configured');
    expect(sources.requests).toEqual([]);
    expect(await submitIndexNow(sources, { key: INDEXNOW_TEST_KEY, siteOrigin: SITE, urls: [`${SITE}/en/blog/x`] })).toBe(false);
    const throwing = { base: () => 'https://indexnow.test', fetch: (async () => { throw new Error('network'); }) as typeof fetch };
    expect(await submitIndexNow(throwing, { key: INDEXNOW_TEST_KEY, siteOrigin: SITE, urls: [`${SITE}/en/blog/x`] })).toBe(false);
    expect(TARGET_LANGS.map(blogSegment).filter((s) => s !== 'blog')).toEqual(['blogg', 'blogg', 'blogi']);
  });
});

describe('SEO cache purge', () => {
  it('deletes the site key format; missing binding and KV errors never throw', async () => {
    const kv = new FakeKV();
    kv.store.set('seo:v1:list:de', '{}');
    kv.store.set('seo:v1:translations:abc', '{}');
    kv.store.set('seo:v1:article:de:x', '{}');
    expect(await purgeSeoKeys(kv as unknown as KVNamespace, [listKey('de'), translationsKey('abc'), listKey('de')])).toEqual({ deleted: 2, failed: 0, configured: true });
    expect([...kv.store.keys()]).toEqual(['seo:v1:article:de:x']);
    expect(await purgeSeoKeys(undefined, [listKey('en')])).toEqual({ deleted: 0, failed: 0, configured: false });
    const broken = { delete: async () => { throw new Error('kv'); } } as unknown as KVNamespace;
    expect(await purgeSeoKeys(broken, [listKey('en')])).toEqual({ deleted: 0, failed: 1, configured: true });
  });
});
