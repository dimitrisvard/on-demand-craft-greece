// T2 (profile 'jobs', real workerd): one content day end to end. A content-daily instance is started through the
// Local Explorer; the English article comes from the Anthropic stub (fixture for the exact prompt the Workflow
// sends), the 13 'daily' and the back-filled translations run in the local translations consumer against the Google
// AI Studio stub (gateway headers, no provider key), IndexNow goes to its stub, the 13th daily translation sends
// translations-done, the Workflow continues with fix-links and starts the sitemap Workflow, which uploads to the
// Storage stub and keeps the R2 copy. A second part runs the sitemap alone in shadow (switch-over stage S4).
// The 6 h timeout of wait-translations is covered by T1 (FakeStep), as real time cannot be skipped here.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatSiloArticlesForPrompt, generatePromptValues } from '../../src/content/generate-prompt';
import { TARGET_LANGS } from '../../src/content/languages';
import { renderTemplate } from '../../src/content/template';
import { call, flagValue, globalUrls, json, JSON_HEADERS, r2Get, restoreFlag, rows, seed, setFlag, startInstance, until, type Row, type Urls } from '../quote/t2-helpers';

const PROFILE = process.env.T2_PROFILE ?? '';
const ENABLED = Boolean(process.env.T2_STUB_URL) && PROFILE === 'jobs';

/** A day no other T2 file uses. */
const DAY = '2031-03-04';
const SHADOW_DAY = '2031-03-05';
const TEMPLATE = readFileSync(new URL('../../src/content/prompts/generate_en.v1.md', import.meta.url), 'utf8');

const id = (p: string, n: number) => `${p.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TITLE = 'T2 Content Day: Laser Cutting Tolerances';
const TITLE_ID = id('c5a1', 1);
const GROUP_A = id('c5aa', 1);
const GROUP_B = id('c5bb', 1);

function words(n: number): string {
  const w = ['tolerance', 'laser', 'kerf', 'steel', 'nozzle', 'focus', 'assist', 'gas', 'edge', 'quality'];
  return Array.from({ length: n }, (_, i) => w[i % w.length]).join(' ');
}

const ARTICLE = `<div class='blog-post'>${Array.from({ length: 50 }, (_, i) => `<h2>Part ${i}</h2><p>${words(44)}.</p>`).join('\n')}</div>`;

/** The prompt the Workflow sends: same neighbours and rotation rules as content/generate-en.ts, over the stub rows. */
async function expectedPrompt(u: Urls): Promise<string> {
  const articles = (await rows(u, 'articles')).filter((a) => a.language === 'en' && a.status === 'published');
  const titles = await rows(u, 'article_titles');
  const silo = 'Sheet Metal & Fabrication';
  const recent = [...articles].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))).slice(0, 20);
  const neighbours: Array<{ title: string; slug: string }> = [];
  for (const a of recent) {
    if (neighbours.length >= 2) break;
    const match = titles.filter((t) => t.title === a.title && t.silo_category === silo);
    if (match.length === 1 && match[0].id !== TITLE_ID) neighbours.push({ title: String(a.title), slug: String(a.slug) });
  }
  return renderTemplate(TEMPLATE, generatePromptValues({ title: TITLE, siloCategory: silo, relatedArticles: formatSiloArticlesForPrompt(neighbours), serviceIndex: articles.length % 3, quoteIndex: articles.length % 5 }));
}

function translationAnswer(n: number): { text: string } {
  return {
    text: [
      '===TITLE===', `Translated title ${n}`, '===SLUG===', `translated-title-${n}`, '===CONTENT===',
      `<div class='blog-post'><p>${words(60)} ${n}.</p></div>`, '===EXCERPT===', 'Excerpt.', '===META_TITLE===', `Title ${n} | Microns Hub`,
      '===META_DESCRIPTION===', 'Description.', '===END===',
    ].join('\n'),
  };
}

describe.skipIf(!ENABLED)('content day in workerd (T2, profile jobs)', () => {
  const u = globalUrls();
  let savedFlag: string | null = null;
  const stub = async <T>(path: string): Promise<T> => json<T>(await call(`${u.stub}${path}`));

  beforeAll(async () => {
    savedFlag = await flagValue(u, 'agent.content_daily');
    const en = (n: string, tid: string, created: string): Row => ({ id: id(`c5e${n}`, 1), title: `Older ${n}`, slug: `t2-older-${n}`, content: '<p>older</p>', excerpt: 'x', meta_title: 'x', meta_description: 'x', language: 'en', status: 'published', translation_id: tid, created_at: created, updated_at: created });
    const tr = (lang: string, tid: string, n: number): Row => ({ id: id(`c5t${n}`, TARGET_LANGS.indexOf(lang as never) + 1), title: `t ${lang}`, slug: `t2-older-${n}-${lang}`, content: '<p>x</p>', language: lang, status: 'published', translation_id: tid, created_at: '2031-01-02T08:00:00Z', updated_at: '2031-01-02T08:00:00Z' });
    await seed(u, {
      article_titles: [{ id: TITLE_ID, title: TITLE, silo_category: 'Sheet Metal & Fabrication', processed: false, created_at: '2031-01-01T00:00:00Z' }],
      articles: [
        en('a', GROUP_A, '2031-01-01T07:00:00Z'),
        ...TARGET_LANGS.filter((l) => l !== 'pt').map((l) => tr(l, GROUP_A, 1)),
        en('b', GROUP_B, '2031-01-02T07:00:00Z'),
        tr('de', GROUP_B, 2),
      ],
    });
    const prompt = await expectedPrompt(u);
    const sha = createHash('sha256').update(JSON.stringify([{ text: prompt, type: 'text' }])).digest('hex');
    const response = {
      id: 'msg_t2_content',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: JSON.stringify({ content: ARTICLE, excerpt: 'Laser cutting tolerances for European buyers.', metaTitle: 'Laser Cutting Tolerances | Microns Hub', metaDescription: 'Kerf, focus and edge quality.', faqSchema: null }) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 2500, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
    const res = await call(`${u.stub}/__stub/anthropic/fixtures`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ prompt: 'content_daily.generate_en@v1', request_sha256: sha, response }) });
    expect(res.status).toBe(204);
    // distinct answers for every translation call (the first model of the chain), so no two rows share a slug
    const answers = Array.from({ length: 60 }, (_, i) => translationAnswer(i + 1));
    await call(`${u.stub}/__stub/google-ai-studio/script`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ models: { 'gemini-2.5-flash-lite': { answers } } }) });
    await setFlag(u, 'agent.content_daily', { enabled: true, mode: 'assist', value: { mode: 'assist', steps: ['generate', 'translate', 'fix_links', 'sitemap'], model: 'claude-sonnet-5', backfill_per_language_per_day: 1 }, rev: 501 });
  }, 120_000);

  afterAll(async () => {
    await restoreFlag(u, 'agent.content_daily', savedFlag);
  });

  it('one full day: article, 13 daily + backfill translations, translations-done, fix-links, sitemap upload', async () => {
    await startInstance(u, 'content-daily', `content-daily-${DAY}`, { date: DAY, trigger: 'manual' });
    const run = await until('the content_daily run closed', async () => {
      const r = (await rows(u, 'agent_runs')).find((x) => x.agent === 'content_daily' && x.idempotency_key === `content_daily:${DAY}`);
      return r && r.status !== 'running' ? r : null;
    }, 240_000);
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual', workflow_instance_id: `content-daily-${DAY}` });
    const out = run.output as Row;
    expect(out).toMatchObject({ generate: 'published', daily_queued: 13, backfilled: 12, translations_wait: 'done' });
    expect(Object.values(out.translations as Row).every((s) => s === 'ok')).toBe(true);

    // the back-filled translations do not block the day; wait until every message of the fan-out is settled
    const translateRuns = await until('25 settled translation runs', async () => {
      const list = (await rows(u, 'agent_runs')).filter((r) => r.agent === 'content_daily.translate' && String(r.idempotency_key).endsWith(`:${DAY}`));
      return list.length === 25 && list.every((r) => r.status !== 'running') ? list : null;
    }, 120_000);
    expect(translateRuns.every((r) => r.status === 'succeeded' && r.parent_run_id === run.id && (r.output as Row).indexnow === true)).toBe(true);

    const all = await rows(u, 'articles');
    const en = all.find((a) => a.title === TITLE)!;
    expect(en).toMatchObject({ language: 'en', status: 'published', slug: 't2-content-day-laser-cutting-tolerances' });
    expect(all.filter((a) => a.translation_id === en.translation_id && a.language !== 'en').map((a) => a.language).sort()).toEqual([...TARGET_LANGS].sort());
    expect(all.some((a) => a.translation_id === GROUP_A && a.language === 'pt')).toBe(true);
    expect(all.filter((a) => a.translation_id === GROUP_B).length).toBe(1 + 12);
    expect((await rows(u, 'article_titles')).find((t) => t.id === TITLE_ID)).toMatchObject({ processed: true });
    expect((await rows(u, 'article_generation_queue')).filter((q) => q.title_id === TITLE_ID)).toMatchObject([{ status: 'completed' }]);

    const gemini = await stub<Array<{ model: string; provider_key_sent: boolean; cf_aig_metadata_keys: string[]; temperature: number; maxOutputTokens: number }>>('/__stub/google-ai-studio/calls');
    expect(gemini.length).toBe(25);
    expect(gemini.every((c) => !c.provider_key_sent && c.temperature === 0.3 && c.maxOutputTokens === 8192 && c.cf_aig_metadata_keys.length === 5)).toBe(true);
    const indexnow = await stub<Array<{ body: { host: string; key: string; keyLocation: string; urlList: string[] } }>>('/__stub/indexnow/calls');
    expect(indexnow.length).toBeGreaterThanOrEqual(25);
    expect(indexnow.every((c) => c.body.key === process.env.T2_INDEXNOW_KEY && c.body.keyLocation.endsWith('/indexnow_key.txt') && c.body.urlList.length === 2)).toBe(true);

    const sitemapRun = await until('the sitemap run closed', async () => {
      const r = (await rows(u, 'agent_runs')).find((x) => x.agent === 'content_daily.sitemap' && x.idempotency_key === `content_daily.sitemap:${DAY}`);
      return r && r.status !== 'running' ? r : null;
    }, 120_000);
    expect(sitemapRun).toMatchObject({ status: 'succeeded', trigger: 'workflow', parent_run_id: run.id });
    // back-filled translations may still land while the sitemap is built (they do not block the day): the run counts
    // what it read, today's group included
    const sOut = sitemapRun.output as Row;
    expect(sOut.urls).toBe(252 + Number(sOut.articles));
    expect(Number(sOut.articles)).toBeGreaterThanOrEqual(2 + 12 + 1 + 1 + 14);
    const published = (await rows(u, 'articles')).filter((a) => a.status === 'published').length;
    const objects = await stub<Array<{ bucket: string; name: string; content_type: string; cache_control: string; upsert: boolean; sha256: string }>>('/__stub/storage/objects');
    const object = objects.find((o) => o.bucket === 'sitemaps' && o.name === 'sitemap-complete.xml')!;
    expect(object).toMatchObject({ content_type: 'application/xml', upsert: true });
    expect(object.sha256).toBe((sitemapRun.output as Row).sha256);
    const copy = await r2Get(u, 'sitemaps/sitemap-complete.xml');
    expect(copy && createHash('sha256').update(copy).digest('hex')).toBe(object.sha256);
    expect((await rows(u, 'gsc_monitored_urls')).length).toBe(sOut.monitored_urls);
    expect(Number(sOut.monitored_urls)).toBeLessThanOrEqual(published);
  }, 400_000);

  it('a day without titles: one plain-text alert, no translations-done wait, run succeeded with no_titles', async () => {
    const NO_TITLES_DAY = '2031-03-06';
    const before = (await call(`${u.stub}/__stub/telegram/calls`).then((r) => json<Array<{ method: string; body: Row }>>(r))).length;
    await startInstance(u, 'content-daily', `content-daily-${NO_TITLES_DAY}`, { date: NO_TITLES_DAY, trigger: 'manual' });
    const r = await until('the no-titles run closed', async () => {
      const x = (await rows(u, 'agent_runs')).find((y) => y.agent === 'content_daily' && y.idempotency_key === `content_daily:${NO_TITLES_DAY}`);
      return x && x.status !== 'running' ? x : null;
    }, 120_000);
    expect(r).toMatchObject({ status: 'succeeded' });
    expect(r.output).toMatchObject({ no_titles: true, generate: 'none', daily_queued: 0 });
    expect((r.output as Row).translations_wait).toBeUndefined();
    const texts = (await json<Array<{ method: string; body: Row }>>(await call(`${u.stub}/__stub/telegram/calls`))).slice(before).map((c) => c.body);
    expect(texts.filter((b) => String(b.text).startsWith(`Content daily ${NO_TITLES_DAY}: article titles exhausted`))).toHaveLength(1);
    expect(texts.every((b) => b.parse_mode === undefined && b.reply_markup === undefined)).toBe(true);
  }, 200_000);

  it('switch-over stage S4 rehearsal: sitemap alone in shadow writes only R2 phase5-shadow/', async () => {
    await setFlag(u, 'agent.content_daily', { enabled: true, mode: 'shadow', value: { mode: 'shadow', steps: ['sitemap'] }, rev: 502 });
    const before = (await stub<unknown[]>('/__stub/storage/objects')).length;
    await startInstance(u, 'sitemap', `sitemap-${SHADOW_DAY}`, { date: SHADOW_DAY });
    const r = await until('the shadow sitemap run closed', async () => {
      const x = (await rows(u, 'agent_runs')).find((y) => y.agent === 'content_daily.sitemap' && y.idempotency_key === `content_daily.sitemap:${SHADOW_DAY}`);
      return x && x.status !== 'running' ? x : null;
    }, 120_000);
    expect(r).toMatchObject({ status: 'succeeded', trigger: 'cron' });
    expect((r.output as Row).shadow).toBe(true);
    const key = `phase5-shadow/sitemaps/${SHADOW_DAY}/sitemap-complete.xml`;
    const xml = await r2Get(u, key);
    expect(xml && new TextDecoder().decode(xml).startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((await stub<unknown[]>('/__stub/storage/objects')).length).toBe(before);
  }, 200_000);
});
