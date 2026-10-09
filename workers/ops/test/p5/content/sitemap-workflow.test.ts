// C5: SitemapWorkflow over FakeStep: the uploaded object is byte-equal to the live generator for the stored articles
// (paged reads, live order), upload options, the R2 copy with its metadata, gsc_monitored_urls upserts in chunks of
// 500, the regression guard, shadow mode (R2 phase5-shadow/ only), a failed upload, flag off and the run row.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sortLikeLive } from '../../../src/content/sitemap-xml';
import { dropAccepted, runSitemap, SITEMAP_R2_KEY, sitemapAlerts } from '../../../src/workflows/sitemap';
import * as oracle from '../../oracles/generate-sitemap.v19';
import { FakeStep } from '../../helpers/fake-step';
import { sitemapFixture } from './fixtures';
import { contentHarness, HookedStep, runByKey, T0, uuid, type ContentHarness } from './helpers';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

const DAY = '2026-10-08';
const NOW = Date.UTC(2026, 9, 8, 9, 0, 4);

function setup(n = 300): ContentHarness {
  const h = contentHarness({ now: NOW });
  h.db.seed('articles', sitemapFixture(n) as never);
  return h;
}

async function go(h: ContentHarness, params: { date: string; parent_run_id?: string } = { date: DAY }) {
  const step = new FakeStep({ now: NOW });
  const r = await runSitemap(params, `sitemap-${params.date}`, { env: h.env, ports: h.ports, p5: h.p5, step });
  return { r, step };
}

async function liveXml(): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const rows = sortLikeLive(sitemapFixture().filter((r) => r.status === 'published'));
  const xml = await oracle.generateSitemap(rows as never);
  vi.useRealTimers();
  return xml;
}

describe('SitemapWorkflow', () => {
  it('assist: uploads the live bytes, keeps an R2 copy with metadata, upserts monitored URLs, closes the run', async () => {
    const h = setup();
    const parent = uuid('9', 1);
    const { r } = await go(h, { date: DAY, parent_run_id: parent });
    expect(r.outcome).toBe('succeeded');
    const expected = await liveXml();
    expect(h.p5.storage.uploads).toHaveLength(1);
    expect(h.p5.storage.uploads[0]).toEqual({ name: 'sitemap-complete.xml', xml: expected, contentType: 'application/xml', cacheControl: '3600' });
    const sha = createHash('sha256').update(expected).digest('hex');
    const copy = h.ports.bucket.objects.get(SITEMAP_R2_KEY)!;
    expect(new TextDecoder().decode(copy.bytes)).toBe(expected);
    expect(copy.httpMetadata).toEqual({ contentType: 'application/xml' });
    expect(copy.customMetadata).toEqual({ sha256: sha, urls: '551', generated_at: new Date(NOW).toISOString() });
    const monitored = h.db.rows('gsc_monitored_urls');
    expect(monitored).toHaveLength(299);
    expect(monitored[0]).toMatchObject({ service_type: 'blog_article', priority: 5 });
    const run = runByKey(h, `content_daily.sitemap:${DAY}`)!;
    expect(run).toMatchObject({ agent: 'content_daily.sitemap', trigger: 'workflow', parent_run_id: parent, status: 'succeeded', workflow_name: 'sitemap', workflow_instance_id: `sitemap-${DAY}` });
    expect(run.output).toEqual({ urls: 551, articles: 300, bytes: Buffer.byteLength(expected), sha256: sha, uploaded: true, shadow_key: SITEMAP_R2_KEY, monitored_urls: 299 });
    expect(h.p5.telegramText.messages).toEqual([]);
  });

  it('started by the schedule (stage S4): trigger cron, no parent', async () => {
    const h = setup(20);
    await go(h);
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ trigger: 'cron', parent_run_id: null, status: 'succeeded' });
  });

  it('more than 1,000 articles: paged read, every row in the XML, upserts in chunks of 500', async () => {
    const h = setup(1300);
    const { r } = await go(h);
    expect(r.outcome).toBe('succeeded');
    const out = runByKey(h, `content_daily.sitemap:${DAY}`)!.output as Record<string, number>;
    expect(out.articles).toBe(1300);
    const upserts = h.db.calls.filter((c) => c.method === 'insert' && c.target === 'gsc_monitored_urls');
    expect(upserts).toHaveLength(3);
    expect(h.db.rows('gsc_monitored_urls').length).toBe(out.monitored_urls);
  });

  it('existing monitored rows are merged on url', async () => {
    const h = setup(20);
    await go(h);
    const first = h.db.rows('gsc_monitored_urls')[0];
    h.db.tables.gsc_monitored_urls[0].label = 'old label';
    h.db.tables.agent_runs = [];
    await go(h);
    expect(h.db.rows('gsc_monitored_urls')).toHaveLength(20);
    expect(h.db.rows('gsc_monitored_urls')[0]).toMatchObject({ id: first.id, label: first.label });
  });

  it('regression guard: fewer URLs than 252 + 95 % of the articles of the last run -> no upload, alert, run failed', async () => {
    const h = setup(100);
    h.db.seed('agent_runs', [{ agent: 'content_daily.sitemap', trigger: 'cron', idempotency_key: 'content_daily.sitemap:2026-10-07', status: 'succeeded', started_at: '2026-10-07T09:00:00Z', output: { urls: 2616, articles: 2364 } }]);
    const { r } = await go(h);
    expect(r.outcome).toBe('regression');
    expect(h.p5.storage.uploads).toEqual([]);
    expect(h.ports.bucket.objects.size).toBe(0);
    expect(h.db.rows('gsc_monitored_urls')).toEqual([]);
    const min = Math.ceil(252 + 0.95 * 2364);
    expect(h.p5.telegramText.texts()).toEqual([sitemapAlerts.regression(DAY, 252 + 99, min)]);
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'failed', error: 'sitemap_regression' });
  });

  it('an intended drop: blocked once with the hint, accepted once by sitemap_accept_drop_on, then guarded against the new size', async () => {
    const h = setup(300);
    const day = (d: string, n: number) => {
      h.clock.set(Date.UTC(2026, 9, n, 9, 0, 4));
      return runSitemap({ date: d }, `sitemap-${d}`, { env: h.env, ports: h.ports, p5: h.p5, step: new FakeStep({ now: h.clock.now().getTime() }) });
    };
    const unpublish = (count: number) => {
      let n = 0;
      for (const a of h.db.tables.articles) if (a.status === 'published' && n < count) { a.status = 'draft'; n++; }
    };
    expect((await day('2026-10-08', 8)).outcome).toBe('succeeded');
    unpublish(60);
    expect((await day('2026-10-09', 9)).outcome).toBe('regression');
    const blocked = runByKey(h, 'content_daily.sitemap:2026-10-09')!.output as Record<string, number>;
    expect(blocked.articles).toBe(240);
    expect(h.p5.telegramText.texts()).toEqual([sitemapAlerts.regression('2026-10-09', blocked.urls, Math.ceil(252 + 0.95 * 300))]);
    expect(sitemapAlerts.regression('2026-10-09', 1, 2)).toContain('sitemap_accept_drop_on to "2026-10-09"');
    // the owner accepts the new size as the alert says
    h.setFlag({ value: { steps: ['sitemap'], sitemap_accept_drop_on: '2026-10-09' } });
    expect((await day('2026-10-10', 10)).outcome).toBe('succeeded');
    expect(runByKey(h, 'content_daily.sitemap:2026-10-10')!.output).toMatchObject({ articles: 240, uploaded: true, drop_accepted: { min_urls: Math.ceil(252 + 0.95 * 300) } });
    // the day after uploads again (reference = the accepted run), with the value still set
    expect((await day('2026-10-11', 11)).outcome).toBe('succeeded');
    expect(runByKey(h, 'content_daily.sitemap:2026-10-11')!.output).not.toHaveProperty('drop_accepted');
    // the value does not accept a second drop
    unpublish(60);
    expect((await day('2026-10-12', 12)).outcome).toBe('regression');
    expect(h.p5.storage.uploads).toHaveLength(3);
    expect(h.p5.telegramText.messages).toHaveLength(2);
  });

  it('dropAccepted: only for the first run on or after the day, never before it, never without a readable reference', () => {
    expect(dropAccepted(null, '2026-10-10', 'content_daily.sitemap:2026-10-08')).toBe(false);
    expect(dropAccepted('2026-10-11', '2026-10-10', 'content_daily.sitemap:2026-10-08')).toBe(false);
    expect(dropAccepted('2026-10-09', '2026-10-10', 'content_daily.sitemap:2026-10-08')).toBe(true);
    expect(dropAccepted('2026-10-10', '2026-10-10', 'content_daily.sitemap:2026-10-08')).toBe(true);
    expect(dropAccepted('2026-10-09', '2026-10-11', 'content_daily.sitemap:2026-10-10')).toBe(false);
    expect(dropAccepted('2026-10-09', '2026-10-11', 'content_daily.sitemap:2026-10-09')).toBe(false);
    expect(dropAccepted('2026-10-09', '2026-10-11', null)).toBe(false);
    expect(dropAccepted('2026-10-09', '2026-10-11', 'other:2026-10-01')).toBe(false);
  });

  it('flag switched off (or to shadow during an assist run) before build-upload: skipped, nothing written', async () => {
    for (const flip of [{ enabled: false }, { mode: 'shadow' as const, value: { steps: ['sitemap'] } }]) {
      const h = setup(20);
      const step = new HookedStep({ now: NOW });
      step.before.set('build-upload', () => h.setFlag(flip));
      const r = await runSitemap({ date: DAY }, `sitemap-${DAY}`, { env: h.env, ports: h.ports, p5: h.p5, step });
      expect(r.outcome).toBe('flag_off');
      expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'build-upload' } });
      expect(h.p5.storage.uploads).toEqual([]);
      expect(h.ports.bucket.objects.size).toBe(0);
      expect(h.db.rows('gsc_monitored_urls')).toEqual([]);
    }
  });

  it('flag switched off before sync-monitored-urls: skipped after the upload, no monitored URL written', async () => {
    const h = setup(20);
    const step = new HookedStep({ now: NOW });
    step.before.set('sync-monitored-urls', () => h.setFlag({ enabled: false }));
    const r = await runSitemap({ date: DAY }, `sitemap-${DAY}`, { env: h.env, ports: h.ports, p5: h.p5, step });
    expect(r.outcome).toBe('flag_off');
    expect(h.p5.storage.uploads).toHaveLength(1);
    expect(h.db.rows('gsc_monitored_urls')).toEqual([]);
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'sync-monitored-urls', uploaded: true } });
  });

  it('shadow regression: run failed, nothing written, no Telegram text', async () => {
    const h = setup(100);
    h.setFlag({ mode: 'shadow', value: { steps: ['sitemap'] } });
    h.db.seed('agent_runs', [{ agent: 'content_daily.sitemap', trigger: 'cron', idempotency_key: 'content_daily.sitemap:2026-10-07', status: 'succeeded', started_at: '2026-10-07T09:00:00Z', output: { urls: 2616, articles: 2364 } }]);
    const { r } = await go(h);
    expect(r.outcome).toBe('regression');
    expect(h.p5.telegramText.messages).toEqual([]);
    expect(h.ports.bucket.objects.size).toBe(0);
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'failed', error: 'sitemap_regression', output: { shadow: true } });
  });

  it('static lastmod is the generation day (as live), also for a run of an earlier date', async () => {
    const h = setup(5);
    await go(h, { date: '2026-10-07' });
    const xml = h.p5.storage.uploads[0].xml;
    expect(xml).toContain('<lastmod>2026-10-08</lastmod>');
    expect(xml).not.toContain('<lastmod>2026-10-07</lastmod>');
  });

  it('within the guard: uploads', async () => {
    const h = setup(300);
    h.db.seed('agent_runs', [{ agent: 'content_daily.sitemap', trigger: 'cron', idempotency_key: 'content_daily.sitemap:2026-10-07', status: 'succeeded', started_at: '2026-10-07T09:00:00Z', output: { urls: 552, articles: 300 } }]);
    const { r } = await go(h);
    expect(r.outcome).toBe('succeeded');
  });

  it('shadow: XML only to R2 phase5-shadow/sitemaps/<date>/, no upload, no upsert, no alert', async () => {
    const h = setup();
    h.setFlag({ mode: 'shadow', value: { steps: ['sitemap'] } });
    const { r } = await go(h);
    expect(r.outcome).toBe('succeeded');
    expect(h.p5.storage.uploads).toEqual([]);
    expect(h.db.rows('gsc_monitored_urls')).toEqual([]);
    const key = `phase5-shadow/sitemaps/${DAY}/sitemap-complete.xml`;
    expect([...h.ports.bucket.objects.keys()]).toEqual([key]);
    expect(h.ports.bucket.text(key)).toBe(await liveXml());
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)!.output).toMatchObject({ uploaded: false, shadow_key: key, shadow: true });
  });

  it('S4 check: compare-sitemap.mjs finds the shadow copy equivalent to the live object of the next day, and not after a lost row', async () => {
    const h = setup();
    h.setFlag({ mode: 'shadow', value: { steps: ['sitemap'] } });
    await go(h);
    const shadow = h.ports.bucket.text(`phase5-shadow/sitemaps/${DAY}/sitemap-complete.xml`)!;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW + 86_400_000));
    const rows = sortLikeLive(sitemapFixture().filter((r) => r.status === 'published'));
    const nextDay: string = await oracle.generateSitemap(rows as never);
    const missing: string = await oracle.generateSitemap(rows.slice(1) as never);
    // one article with another updated_at day (its <lastmod> differs; nothing else does)
    const shifted = rows.map((r, i) => (i === 0 ? { ...r, updated_at: '2026-08-30T10:00:00+00:00' } : r));
    const otherLastmod: string = await oracle.generateSitemap(shifted as never);
    vi.useRealTimers();
    const dir = mkdtempSync(join(tmpdir(), 'c5-compare-'));
    const script = new URL('../../../../../scripts/phase5/compare-sitemap.mjs', import.meta.url).pathname;
    const different = (b: string): string => {
      try {
        execFileSync('node', [script, join(dir, 'a.xml'), join(dir, b)], { encoding: 'utf8' });
      } catch (e) {
        expect((e as { status: number }).status).toBe(1);
        return String((e as { stdout: string }).stdout);
      }
      throw new Error(`${b}: expected exit 1`);
    };
    try {
      writeFileSync(join(dir, 'a.xml'), shadow);
      writeFileSync(join(dir, 'b.xml'), nextDay);
      writeFileSync(join(dir, 'c.xml'), missing);
      writeFileSync(join(dir, 'd.xml'), otherLastmod);
      const ok = execFileSync('node', [script, join(dir, 'a.xml'), join(dir, 'b.xml')], { encoding: 'utf8' });
      expect(ok).toContain('bytes: different');
      expect(ok).toContain('entries differing in lastmod only: 252');
      expect(ok).toContain('generation day (static lastmod): a=2026-10-08 b=2026-10-09');
      expect(ok).toContain('RESULT: EQUIVALENT');
      expect(different('c.xml')).toContain('RESULT: DIFFERENT');
      const report = different('d.xml');
      expect(report).toContain('entries differing apart from lastmod: 0');
      expect(report).toContain('lastmod differences other than the generation day of static pages: 1');
      expect(report).toContain('RESULT: DIFFERENT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a failed upload is retried by the step, then the run fails with one alert (served object unchanged)', async () => {
    const h = setup(10);
    h.p5.storage.failWith = { status: 503, message: 'unavailable' };
    const { r, step } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'build-upload' });
    expect(step.calls.find((c) => c.name === 'build-upload')).toMatchObject({ attempts: 6, outcome: 'threw' });
    expect(h.ports.bucket.objects.size).toBe(0);
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'failed', error: 'build-upload: upload_failed 503' });
    expect(h.p5.telegramText.texts()).toEqual([sitemapAlerts.failed(DAY, 'build-upload', 'upload_failed 503')]);
  });

  it('flag off: skipped; a second instance after a final run exits', async () => {
    const h = setup(5);
    h.setFlag({ enabled: false });
    expect((await go(h)).r.outcome).toBe('flag_off');
    expect(runByKey(h, `content_daily.sitemap:${DAY}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off' } });
    h.setFlag({});
    const again = await go(h);
    expect(again.r.outcome).toBe('exists');
    expect(h.p5.storage.uploads).toEqual([]);
  });

  it('invalid params are refused', async () => {
    const h = setup(1);
    await expect(go(h, { date: '2026-02-30' })).rejects.toThrow(/invalid_params/);
  });

  it('T0 sanity: the harness clock is the generation day', () => {
    expect(new Date(T0).toISOString().slice(0, 10)).toBe(DAY);
  });
});
