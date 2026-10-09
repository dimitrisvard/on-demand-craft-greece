// C5: translation backlog (oldest English article first, at most N per language, today's group left out), the flag
// snapshot, IndexNow requests and the SEO cache purge.

import { describe, expect, it } from 'vitest';
import { backfillCap, englishMasters, planBackfill, presentLanguages } from '../../../src/content/backfill';
import { mustHalt, snapshotFlag } from '../../../src/content/flag';
import { submitIndexNow, translationUrls } from '../../../src/content/indexnow';
import { blogSegment, TARGET_LANGS } from '../../../src/content/languages';
import { listKey, purgeSeoKeys, translationsKey } from '../../../src/content/seo-purge';
import { P5MemoryDb, ScriptedSources } from '../../../src/ports/p5-stub/index';
import { FakeKV } from '../../helpers/agent-env';
import { INDEXNOW_TEST_KEY, SITE, uuid } from './helpers';

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

  it('cap and flag value parsing', () => {
    expect(backfillCap({})).toBe(5);
    expect(backfillCap({ backfill_per_language_per_day: 2 })).toBe(2);
    expect(backfillCap({ backfill_per_language_per_day: -1 })).toBe(5);
    expect(backfillCap({ backfill_per_language_per_day: '3' })).toBe(5);
    const all = snapshotFlag({ enabled: true, mode: 'assist', value: {} });
    expect(all.steps).toEqual(['generate', 'translate', 'fix_links', 'sitemap']);
    expect(all.model).toBe('claude-sonnet-5');
    const some = snapshotFlag({ enabled: true, mode: 'shadow', value: { steps: ['sitemap', 'bogus', 'translate'], model: ' claude-x ', shadow_generate: true } });
    expect(some).toEqual({ enabled: true, mode: 'shadow', steps: ['translate', 'sitemap'], model: 'claude-x', backfill_per_language_per_day: 5, shadow_generate: true });
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
