// C5: ContentDailyWorkflow over FakeStep: a full day (enqueue, claim, generate, publish, fan-out with backfill, the
// translations-done wait, 13 fix-links passes, sitemap, SEO purge, report), a no_titles day (no 6 h wait), a failed
// generation (3 attempts, queue job failed, alert, backfill still sent), the 6 h timeout path, flag off, a flag switched
// off mid-run, shadow with and without shadow_generate, 23505 on publish, replay after eviction, and a final run.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateSlug, todaysSilo } from '../../../src/content/generate-en';
import { TARGET_LANGS } from '../../../src/content/languages';
import { translateRunKey } from '../../../src/content/report';
import { failText, okText } from '../../../src/ports/p5-stub/index';
import type { TranslationMessageV1 } from '../../../src/queues/messages';
import { contentAlerts, runContentDaily, waitTimeoutOf, type ContentDailyResult } from '../../../src/workflows/content-daily';
import { FakeStep } from '../../helpers/fake-step';
import { articleHtml, modelJson } from './fixtures';
import { contentHarness, DATE, HookedStep, runByKey, T0, uuid, type ContentHarness } from './helpers';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

const INSTANCE = `content-daily-${DATE}`;
const TITLE_1 = 'Sheet Metal Bending Radii for 1.5 mm Steel';
const TITLE_2 = 'Die Casting Draft Angles';

function setup(o: { titles?: boolean; answer?: string; groups?: number } = {}): ContentHarness {
  const h = contentHarness();
  if (o.titles !== false) {
    h.db.seed('article_titles', [
      { id: uuid('a1', 1), title: TITLE_1, silo_category: 'Sheet Metal & Fabrication', processed: false, created_at: '2026-09-01T00:00:00Z' },
      { id: uuid('a1', 2), title: TITLE_2, silo_category: 'Die Casting & Metal Casting', processed: false, created_at: '2026-09-02T00:00:00Z' },
      { id: uuid('a1', 3), title: 'Done', silo_category: 'Sheet Metal & Fabrication', processed: true, created_at: '2026-08-01T00:00:00Z' },
    ]);
  }
  // older English articles; group k has translations for the first k languages only
  const rows: Array<Record<string, unknown>> = [];
  for (let k = 1; k <= (o.groups ?? 3); k++) {
    const tid = uuid('70', k);
    rows.push({ id: uuid('e0', k), title: `Older ${k}`, slug: `older-${k}`, language: 'en', status: 'published', translation_id: tid, content: '<p>x</p>', created_at: `2026-09-1${k}T07:00:00Z`, updated_at: `2026-09-1${k}T07:00:00Z` });
    TARGET_LANGS.slice(0, k * 4).forEach((lang, i) =>
      rows.push({ id: uuid(`d${k}`, i + 1), title: `t ${lang}`, slug: `older-${k}-${lang}`, language: lang, status: 'published', translation_id: tid, content: `<p><a href="/${lang}/blog/older-${(k % 3) + 1}">x</a></p>`, created_at: `2026-09-1${k}T08:00:00Z`, updated_at: `2026-09-1${k}T08:00:00Z` }),
    );
  }
  h.db.seed('articles', rows);
  h.seo.store.set('seo:v1:list:en', '{}');
  h.seo.store.set('seo:v1:list:de', '{}');
  h.seo.store.set('seo:v1:article:de:keep', '{}');
  const answer = o.answer ?? modelJson(articleHtml(2400, { seed: 5, blogSlugs: ['older-1'] }));
  h.p5.textLlm.setScript((call) => okText(answer, { model: call.model, usage: { input_tokens: 3000, output_tokens: 6000, cost_usd: 0.066 } }));
  return h;
}

async function run(h: ContentHarness, step = new FakeStep({ now: T0 }), trigger: 'cron' | 'manual' = 'cron'): Promise<{ r: ContentDailyResult; step: FakeStep }> {
  const r = await runContentDaily({ date: DATE, trigger }, INSTANCE, { env: h.env, ports: h.ports, p5: h.p5, step });
  return { r, step };
}

const sent = (h: ContentHarness): TranslationMessageV1[] => h.translations.sent.map((s) => s.body);

describe('ContentDailyWorkflow', () => {
  it('full day: article published, 13 daily + backfill, wait done, 13 fix-links, sitemap, purge, report', async () => {
    const h = setup();
    const step = new FakeStep({ now: T0 });
    for (let k = 1; k <= 3; k++) h.seo.store.set(`seo:v1:translations:${uuid('70', k)}`, '{}');
    h.seo.store.set(`seo:v1:translations:${uuid('79', 9)}`, '{}');
    step.onWait = () => {
      // the consumer published the German translation and gave up on French while the Workflow waited
      const en = h.db.rows('articles').find((a) => a.language === 'en' && a.title === TITLE_1)!;
      h.db.seed('articles', [{ id: uuid('dd', 1), title: 'de', slug: 'de-today', language: 'de', status: 'published', translation_id: en.translation_id, created_at: `${DATE}T08:01:00Z` }]);
      h.db.seed('agent_runs', [{ agent: 'content_daily.translate', trigger: 'queue', idempotency_key: translateRunKey(String(en.translation_id), 'fr', DATE), status: 'failed', error: 'GeminiOverloadedError' }]);
      h.seo.store.set(`seo:v1:translations:${en.translation_id}`, '{}');
      step.sendEvent('translations-done', { translation_id: en.translation_id });
    };
    const { r } = await run(h, step);
    expect(r.outcome).toBe('succeeded');

    const en = h.db.rows('articles').find((a) => a.language === 'en' && a.title === TITLE_1)!;
    expect(en).toMatchObject({ slug: generateSlug(TITLE_1), status: 'published', meta_title: 'Guide | Microns Hub' });
    expect(typeof en.translation_id).toBe('string');
    expect(h.db.rows('article_titles').find((t) => t.title === TITLE_1)).toMatchObject({ processed: true });
    expect(h.db.rows('article_generation_queue')).toMatchObject([{ status: 'completed', title_id: uuid('a1', 1) }]);
    expect(h.db.rows('article_generation_logs')[0].summary_data).toMatchObject({ title: TITLE_1, master_article_id: en.id, status: 'published', translations_pending: true, silo_category: 'Sheet Metal & Fabrication', scheduled_silo: todaysSilo(DATE), matched_scheduled_silo: todaysSilo(DATE) === 'Sheet Metal & Fabrication' });

    const msgs = sent(h);
    const daily = msgs.filter((m) => m.origin === 'daily');
    expect(daily.map((m) => m.language)).toEqual([...TARGET_LANGS]);
    expect(daily.every((m) => m.translation_id === en.translation_id && m.en_article_id === en.id && m.for_date === DATE)).toBe(true);
    const backfill = msgs.filter((m) => m.origin === 'backfill');
    // group 1 lacks 9 languages, group 2 lacks 5, group 3 lacks 1: per language at most 5, oldest first
    expect(backfill.length).toBe(9 + 5 + 1);
    expect(backfill.filter((m) => m.language === 'fi').map((m) => m.translation_id)).toEqual([uuid('70', 1), uuid('70', 2), uuid('70', 3)]);
    const runRow = runByKey(h, `content_daily:${DATE}`)!;
    expect(msgs.every((m) => m.parent_run_id === runRow.id)).toBe(true);

    expect(step.trace()).toContain('wait-translations:ok');
    expect(step.trace().filter((t) => t.startsWith('fix-links-'))).toHaveLength(13);
    expect(h.sitemap.created).toEqual([{ id: `sitemap-${DATE}`, params: { date: DATE, parent_run_id: runRow.id } }]);
    // list keys of today's languages, today's group and every back-filled group are purged; others stay
    expect([...h.seo.store.keys()].sort()).toEqual(['seo:v1:article:de:keep', `seo:v1:translations:${uuid('79', 9)}`]);

    expect(runRow).toMatchObject({ agent: 'content_daily', trigger: 'cron', status: 'succeeded', workflow_name: 'content-daily', workflow_instance_id: INSTANCE, llm_calls: 1, input_tokens: 3000, output_tokens: 6000 });
    expect(runRow.output).toMatchObject({ article_id: en.id, slug: en.slug, no_titles: false, generate: 'published', daily_queued: 13, backfilled: 15, translations_wait: 'done', sitemap: { instance: `sitemap-${DATE}`, created: true, urls: null } });
    const out = runRow.output as Record<string, Record<string, unknown>>;
    expect(Object.keys(out.translations)).toEqual([...TARGET_LANGS]);
    expect(out.translations.de).toBe('ok');
    expect(out.translations.fr).toBe('failed');
    expect(out.translations.es).toBe('missing');
    expect(out.lag_days).toMatchObject({ de: 0, fr: 25, hu: 25, fi: null });
    expect(Object.keys(out.fix_links)).toEqual([...TARGET_LANGS]);
    expect(h.p5.telegramText.messages).toEqual([]);
    const call = h.p5.textLlm.calls[0];
    expect(call).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 16384, timeoutMs: 310_000, gatewayTimeoutMs: 300_000, meta: { agent: 'content_daily', run_id: runRow.id, step: 'generate-en', prompt: 'content_daily.generate_en@v1' } });
    expect(call.input).toContain(`Task: Write a definitive, comprehensive technical guide on: "${TITLE_1}"`);
  });

  it('no titles: one alert, generation skipped, no 6 h wait, backfill, fix-links and sitemap still run', async () => {
    const h = setup({ titles: false });
    const { r, step } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(h.p5.telegramText.texts()).toEqual([contentAlerts.noTitles(DATE)]);
    expect(h.p5.textLlm.calls).toEqual([]);
    expect(sent(h).every((m) => m.origin === 'backfill')).toBe(true);
    expect(step.calls.some((c) => c.kind === 'waitForEvent')).toBe(false);
    expect(step.now - T0).toBeLessThan(60 * 60_000);
    expect(h.sitemap.created).toHaveLength(1);
    expect(runByKey(h, `content_daily:${DATE}`)!.output).toMatchObject({ no_titles: true, generate: 'none', daily_queued: 0 });
  });

  it('generation under 2,000 words: 3 attempts, queue job failed, alert, backfill without daily messages, run failed', async () => {
    const h = setup({ answer: modelJson(articleHtml(1200, { seed: 3 })) });
    const { r, step } = await run(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'generate-en' });
    expect(step.calls.find((c) => c.name === 'generate-en')).toMatchObject({ attempts: 3, outcome: 'threw' });
    expect(h.p5.textLlm.calls).toHaveLength(3);
    expect(h.db.rows('article_generation_queue')).toMatchObject([{ status: 'failed', retry_count: 1 }]);
    expect(String(h.db.rows('article_generation_queue')[0].error_message)).toMatch(/^Article too short: \d+ words/);
    expect(h.db.rows('article_titles').find((t) => t.title === TITLE_1)).toMatchObject({ processed: false });
    expect(h.db.rows('articles').some((a) => a.title === TITLE_1)).toBe(false);
    expect(h.p5.telegramText.texts()).toEqual([contentAlerts.generateFailed(DATE, 'ArticleRejectedError')]);
    expect(sent(h).length).toBe(15);
    expect(sent(h).every((m) => m.origin === 'backfill')).toBe(true);
    expect(step.calls.some((c) => c.kind === 'waitForEvent')).toBe(false);
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'failed', error: 'generate_failed' });
  });

  it('every answered attempt is billed: three rejected answers (under 2,000 words) count 3 calls on the failed run', async () => {
    const h = setup({ answer: modelJson(articleHtml(1200, { seed: 3 })) });
    const { r, step } = await run(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'generate-en' });
    expect(step.trace()).toContain('generate-en-usage:ok');
    const row = runByKey(h, `content_daily:${DATE}`)!;
    expect(row).toMatchObject({ status: 'failed', error: 'generate_failed', llm_calls: 3, input_tokens: 9000, output_tokens: 18000 });
    expect(Number(row.cost_cents)).toBeCloseTo(19.8, 6);
  });

  it('every answered attempt is billed: max_tokens twice, then a good answer, counts 3 calls on the succeeded run', async () => {
    const h = setup();
    const good = modelJson(articleHtml(2400, { seed: 5, blogSlugs: ['older-1'] }));
    const usage = { input_tokens: 3000, output_tokens: 16384, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.17, model: 'claude-sonnet-5' };
    let n = 0;
    h.p5.textLlm.setScript((call) => (++n <= 2 ? failText('other', { status: 200, message: 'anthropic: stopped at max_tokens', usage }) : okText(good, { model: call.model, usage: { input_tokens: 3000, output_tokens: 6000, cost_usd: 0.066 } })));
    const step = new FakeStep({ now: T0 });
    step.onWait = () => {
      const en = h.db.rows('articles').find((a) => a.language === 'en' && a.title === TITLE_1)!;
      step.sendEvent('translations-done', { translation_id: en.translation_id });
    };
    const { r } = await run(h, step);
    expect(r.outcome).toBe('succeeded');
    expect(step.calls.find((c) => c.name === 'generate-en')).toMatchObject({ attempts: 3 });
    const row = runByKey(h, `content_daily:${DATE}`)!;
    expect(row).toMatchObject({ status: 'succeeded', llm_calls: 3, input_tokens: 9000, output_tokens: 2 * 16384 + 6000 });
    expect(Number(row.cost_cents)).toBeCloseTo(40.6, 6);
  });

  it('an unanswered failure (provider 5xx) is not billed: the failed run counts no call', async () => {
    const h = setup();
    h.p5.textLlm.setScript(() => failText('server', { status: 529 }));
    const { r } = await run(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'generate-en' });
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'failed', llm_calls: 0 });
  });

  it('no translations-done within 6 h: the wait times out and the run continues', async () => {
    const h = setup();
    const { r, step } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(step.trace()).toContain('wait-translations:timed_out');
    expect(step.now - T0).toBeGreaterThanOrEqual(6 * 3_600_000);
    expect(runByKey(h, `content_daily:${DATE}`)!.output).toMatchObject({ translations_wait: 'timeout' });
    expect(h.sitemap.created).toHaveLength(1);
  });

  it('T2-only CONTENT_WAIT_TIMEOUT_S shortens the translations-done wait; anything but 1-21600 seconds keeps 6 h', async () => {
    expect(waitTimeoutOf({})).toBe('6 hours');
    expect(waitTimeoutOf({ CONTENT_WAIT_TIMEOUT_S: '20' })).toBe('20 seconds');
    expect(waitTimeoutOf({ CONTENT_WAIT_TIMEOUT_S: '21600' })).toBe('21600 seconds');
    for (const bad of ['', '0', '-5', '1.5', '20s', ' 20', '021', '21601', '99999', 'six hours']) expect(waitTimeoutOf({ CONTENT_WAIT_TIMEOUT_S: bad }), bad).toBe('6 hours');
    const h = setup();
    h.env.CONTENT_WAIT_TIMEOUT_S = '30';
    const { r, step } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(step.trace()).toContain('wait-translations:timed_out');
    expect(step.now - T0).toBeGreaterThanOrEqual(30_000);
    expect(step.now - T0).toBeLessThan(3_600_000);
    expect(runByKey(h, `content_daily:${DATE}`)!.output).toMatchObject({ translations_wait: 'timeout' });
  });

  it('flag off: run skipped, nothing else happens', async () => {
    const h = setup();
    h.setFlag({ enabled: false });
    const { r, step } = await run(h);
    expect(r.outcome).toBe('flag_off');
    expect(step.trace()).toEqual(['open-run:ok', 'flag:ok', 'close-run:ok']);
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off' } });
    expect(h.db.rows('article_generation_queue')).toEqual([]);
  });

  it('flag switched off during the run: the next side-effecting step stops it (skipped, flag_off)', async () => {
    const h = setup();
    const answer = modelJson(articleHtml(2400, { seed: 5 }));
    h.p5.textLlm.setScript((call) => {
      h.setFlag({ enabled: false });
      return okText(answer, { model: call.model });
    });
    const { r } = await run(h);
    expect(r.outcome).toBe('flag_off');
    expect(h.db.rows('articles').some((a) => a.title === TITLE_1)).toBe(true); // the claimed job ran to the end
    expect(sent(h)).toEqual([]);
    expect(h.sitemap.created).toEqual([]);
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'fan-out', generate: 'published' } });
  });

  it('shadow: no queue row, no article, no message, no text; fix-links count only; sitemap created; R2 untouched', async () => {
    const h = setup();
    h.setFlag({ mode: 'shadow', value: { steps: ['generate', 'translate', 'fix_links', 'sitemap'] } });
    const { r } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(h.p5.textLlm.calls).toEqual([]);
    expect(h.db.rows('article_generation_queue')).toEqual([]);
    expect(sent(h)).toEqual([]);
    expect(h.p5.telegramText.messages).toEqual([]);
    const writes = h.db.calls.filter((c) => c.method === 'insert' || c.method === 'update' || (c.method === 'rpc' && c.target !== 'agent_run_begin'));
    expect(writes.every((c) => c.target === 'agent_runs')).toBe(true);
    expect(h.sitemap.created).toHaveLength(1);
    const out = runByKey(h, `content_daily:${DATE}`)!.output as Record<string, unknown>;
    expect(out).toMatchObject({ shadow: true, generate: 'skipped' });
    expect((out.fix_links as Record<string, { updated: number }>).de.updated).toBeGreaterThan(0);
    expect(h.ports.bucket.objects.size).toBe(0);
    expect(h.seo.store.size).toBe(3);
  });

  it('shadow with shadow_generate: the model is called and the article goes to R2 phase5-shadow only', async () => {
    const h = setup();
    h.setFlag({ mode: 'shadow', value: { steps: ['generate'], shadow_generate: true } });
    const { r } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(h.p5.textLlm.calls).toHaveLength(1);
    const key = `phase5-shadow/content-daily/${DATE}/en.json`;
    expect([...h.ports.bucket.objects.keys()]).toEqual([key]);
    expect(JSON.parse(h.ports.bucket.text(key)!)).toMatchObject({ title: TITLE_1, slug: generateSlug(TITLE_1) });
    expect(h.db.rows('articles').some((a) => a.title === TITLE_1)).toBe(false);
    expect(h.db.rows('article_titles').find((t) => t.title === TITLE_1)).toMatchObject({ processed: false });
  });

  it('23505 on publish: the existing English row is used for the daily group', async () => {
    const h = setup();
    h.db.seed('articles', [{ id: uuid('e9', 1), title: TITLE_1, slug: generateSlug(TITLE_1), language: 'en', status: 'published', translation_id: uuid('79', 1), created_at: '2026-10-07T07:00:00Z' }]);
    const { r } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(h.db.rows('articles').filter((a) => a.slug === generateSlug(TITLE_1) && a.language === 'en')).toHaveLength(1);
    expect(sent(h).filter((m) => m.origin === 'daily').every((m) => m.translation_id === uuid('79', 1) && m.en_article_id === uuid('e9', 1))).toBe(true);
    expect(h.db.rows('article_generation_queue')).toMatchObject([{ status: 'completed' }]);
  });

  it('replay after an eviction: cached steps are not repeated (one article, one queue row)', async () => {
    const h = setup();
    const first = new FakeStep({ now: T0 });
    await run(h, first);
    const partial = new Map([...first.cache].filter(([k]) => ['open-run#1', 'flag#1', 'enqueue#1', 'claim#1', 'generate-en#1', 'publish-en#1', 'publish-en-log#1', 'publish-en-done#1'].includes(k)));
    const replay = new FakeStep({ now: first.now, cache: partial });
    const { r } = await run(h, replay);
    expect(r.outcome).toBe('succeeded');
    expect(h.db.rows('articles').filter((a) => a.title === TITLE_1)).toHaveLength(1);
    expect(h.db.rows('article_generation_queue')).toHaveLength(1);
    expect(h.p5.textLlm.calls).toHaveLength(1);
    expect(replay.trace().slice(0, 8).every((t) => t.endsWith(':cached'))).toBe(true);
  });

  it('a second instance for a finished day exits without work', async () => {
    const h = setup();
    await run(h);
    const before = h.db.calls.length;
    const { r, step } = await run(h, new FakeStep({ now: T0 + 86_400_000 }), 'manual');
    expect(r.outcome).toBe('exists');
    expect(step.trace()).toEqual(['open-run:ok']);
    expect(h.db.calls.length - before).toBe(1);
  });

  it('a missing binding fails the step after its retries: run failed with the step and code, one alert', async () => {
    const h = setup();
    h.env.TRANSLATIONS = undefined;
    const { r } = await run(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'fan-out' });
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'failed', error: 'fan-out: config_missing: TRANSLATIONS' });
    expect(h.p5.telegramText.texts()).toEqual([contentAlerts.runFailed(DATE, 'fan-out', 'config_missing: TRANSLATIONS')]);
  });

  it('fan-out: a recent slug conflict holds the pair, another recent failure plans it after the rest, an older conflict no longer holds', async () => {
    const h = setup();
    h.setFlag({ value: { steps: ['translate'], backfill_per_language_per_day: 1 } });
    const failed = (tid: string, lang: string, day: string, error: string) => ({ agent: 'content_daily.translate', trigger: 'queue', idempotency_key: translateRunKey(tid, lang, day), status: 'failed', error, started_at: `${day}T07:30:00Z` });
    h.db.seed('agent_runs', [
      failed(uuid('70', 1), 'nl', '2026-10-05', 'slug_conflict'), // nl is missing in group 1 only
      failed(uuid('70', 1), 'nb', '2026-10-07', 'GeminiOverloadedError'), // nb is missing in groups 1 and 2
      failed(uuid('70', 1), 'pl', '2026-09-30', 'slug_conflict'), // older than 7 days
    ]);
    const { r } = await run(h);
    expect(r.outcome).toBe('succeeded');
    const by = (lang: string) => sent(h).filter((m) => m.language === lang).map((m) => m.translation_id);
    expect(by('nl')).toEqual([]);
    expect(by('nb')).toEqual([uuid('70', 2)]);
    expect(by('pl')).toEqual([uuid('70', 1)]);
    expect(by('fi')).toEqual([uuid('70', 1)]);
  });

  it('flag switched off, or to shadow during an assist run, right before enqueue: skipped, no queue row, no model call', async () => {
    for (const flip of [{ enabled: false }, { mode: 'shadow' as const, value: { steps: ['generate', 'translate', 'fix_links', 'sitemap'] } }]) {
      const h = setup();
      const step = new HookedStep({ now: T0 });
      step.before.set('enqueue', () => h.setFlag(flip));
      const { r } = await run(h, step);
      expect(r.outcome).toBe('flag_off');
      expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'enqueue' } });
      expect(h.db.rows('article_generation_queue')).toEqual([]);
      expect(h.db.calls.some((c) => c.method === 'rpc' && c.target === 'enqueue_next_article')).toBe(false);
      expect(h.p5.textLlm.calls).toEqual([]);
      expect(sent(h)).toEqual([]);
      expect(h.sitemap.created).toEqual([]);
    }
  });

  it('flag switched off before a fix-links step: the run stops there (no PATCH for that or later languages, no sitemap)', async () => {
    const h = setup();
    h.setFlag({ value: { steps: ['fix_links', 'sitemap'] } });
    const step = new HookedStep({ now: T0 });
    step.before.set('fix-links-fr', () => h.setFlag({ enabled: false }));
    const { r } = await run(h, step);
    expect(r.outcome).toBe('flag_off');
    const out = runByKey(h, `content_daily:${DATE}`)!.output as Record<string, unknown>;
    expect(out).toMatchObject({ reason: 'flag_off', halted_at: 'fix-links-fr' });
    expect(Object.keys(out.fix_links as object)).toEqual(['de']);
    const patched = h.db.calls.filter((c) => c.method === 'update' && c.target === 'articles').length;
    const de = (out.fix_links as Record<string, { updated: number }>).de.updated;
    expect(patched).toBe(de);
    expect(h.sitemap.created).toEqual([]);
  });

  it('flag switched off, or to shadow during an assist run, right before the sitemap step: no sitemap instance, skipped', async () => {
    for (const flip of [{ enabled: false }, { mode: 'shadow' as const, value: { steps: ['sitemap'] } }]) {
      const h = setup();
      h.setFlag({ value: { steps: ['sitemap'] } });
      const step = new HookedStep({ now: T0 });
      step.before.set('sitemap', () => h.setFlag(flip));
      const { r } = await run(h, step);
      expect(r.outcome).toBe('flag_off');
      expect(h.sitemap.created).toEqual([]);
      expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'sitemap' } });
    }
  });

  it('shadow: a failed step closes the run failed without any Telegram text', async () => {
    const h = setup();
    h.setFlag({ mode: 'shadow', value: { steps: ['sitemap'] } });
    h.env.SITEMAP = undefined;
    const { r } = await run(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'sitemap' });
    expect(runByKey(h, `content_daily:${DATE}`)).toMatchObject({ status: 'failed', error: 'sitemap: config_missing: SITEMAP' });
    expect(h.p5.telegramText.messages).toEqual([]);
  });

  it('a claimed title already processed (generated by hand meanwhile): no model call, queue job failed, alert, run failed', async () => {
    const h = setup();
    const step = new HookedStep({ now: T0 });
    step.before.set('generate-en', () => {
      const t = h.db.tables.article_titles.find((x) => x.title === TITLE_1)!;
      t.processed = true;
    });
    const { r } = await run(h, step);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'generate-en' });
    expect(h.p5.textLlm.calls).toEqual([]);
    expect(step.calls.find((c) => c.name === 'generate-en')).toMatchObject({ attempts: 1, outcome: 'threw' });
    expect(h.db.rows('article_generation_queue')).toMatchObject([{ status: 'failed' }]);
    expect(h.db.rows('articles').some((a) => a.title === TITLE_1)).toBe(false);
    expect(h.p5.telegramText.texts()).toEqual([contentAlerts.generateFailed(DATE, 'title_processed')]);
  });

  it('report: sitemap urls only from a succeeded sitemap run (null while it runs or after it failed)', async () => {
    for (const [status, urls] of [['running', null], ['failed', null], ['succeeded', 2616]] as const) {
      const h = setup({ titles: false });
      h.setFlag({ value: { steps: ['sitemap'] } });
      h.db.seed('agent_runs', [{ agent: 'content_daily.sitemap', trigger: 'workflow', idempotency_key: `content_daily.sitemap:${DATE}`, status, output: { urls: 2616, articles: 2364 } }]);
      await run(h);
      expect((runByKey(h, `content_daily:${DATE}`)!.output as Record<string, { urls: number | null }>).sitemap.urls).toBe(urls);
    }
  });

  it('steps subset: only fix_links runs the 13 passes (no queue, no generation, no sitemap)', async () => {
    const h = setup();
    h.setFlag({ value: { steps: ['fix_links'] } });
    const { r, step } = await run(h);
    expect(r.outcome).toBe('succeeded');
    expect(step.trace().map((t) => t.split(':')[0])).toEqual(['open-run', 'flag', ...TARGET_LANGS.map((l) => `fix-links-${l}`), 'report', 'close-run']);
    expect(sent(h)).toEqual([]);
    const updated = h.db.calls.filter((c) => c.method === 'update' && c.target === 'articles').length;
    expect(updated).toBeGreaterThan(0);
  });
});
