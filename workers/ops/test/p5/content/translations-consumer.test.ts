// C5: consumer of the queue translations: idempotency (exists -> ack; 23505 -> success; a concurrent duplicate at the
// first delivery -> ack; this message's own retry continues under the same run), retry rules (all models overloaded
// -> 120 s x attempts; parse failure -> retry(); last delivery -> run failed, one alert, DLQ), flag off / shadow ->
// 'skipped', IndexNow ('not_configured' without the key), the translations-done event, the inserted row and the run.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TARGET_LANGS } from '../../../src/content/languages';
import { translateRunKey } from '../../../src/content/report';
import { okText, failText } from '../../../src/ports/p5-stub/index';
import type { TranslationMessageV1 } from '../../../src/queues/messages';
import { translationAlerts, translationsConsumer } from '../../../src/queues/translations';
import { testContext } from '../../helpers/ops';
import { delimiterAnswer } from './fixtures';
import { batchOf, contentHarness, DATE, INDEXNOW_TEST_KEY, message, runByKey, SITE, T0, uuid, type ContentHarness } from './helpers';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

const TID = uuid('7', 1);
const EN = uuid('e', 1);
const PARENT = uuid('9', 1);
const CONTENT = `<p>${'Anodised aluminium tolerances explained in detail. '.repeat(30)}</p>`;

function body(o: Partial<TranslationMessageV1> = {}): TranslationMessageV1 {
  return { v: 1, translation_id: TID, en_article_id: EN, language: 'de', origin: 'daily', for_date: DATE, parent_run_id: PARENT, ...o };
}

function setup(o: { indexnow?: boolean } = {}): ContentHarness {
  const h = contentHarness(o);
  h.db.seed('articles', [
    { id: EN, title: 'Anodising Guide', slug: 'anodising-guide', content: CONTENT, excerpt: 'Ex', meta_title: 'Anodising | Microns Hub', meta_description: 'Md', language: 'en', status: 'published', translation_id: TID, featured_image: 'https://img.example/x.png', featured_image_alt: 'x', created_at: '2026-10-08T07:05:00Z' },
  ]);
  h.p5.textLlm.setScript((call) => {
    if (call.meta.prompt === 'content_daily.translate@v1') {
      const lang = /into ([A-Za-z]+)\./.exec(call.input)![1];
      return okText(delimiterAnswer({ title: `${lang} Eloxieren`, slug: `${lang}-eloxieren-anleitung`, content: CONTENT.replace('Anodised', 'Eloxiert') }), { model: call.model, stop: 'STOP', usage: { input_tokens: 1000, output_tokens: 900, cost_usd: 0.0004 } });
    }
    return failText('other', { status: 400 });
  });
  h.p5.sources.route({ method: 'POST', match: 'https://indexnow.test/indexnow', respond: new Response('', { status: 200 }) });
  return h;
}

async function deliver(h: ContentHarness, b: TranslationMessageV1, attempts = 1) {
  const m = message(b, attempts);
  await translationsConsumer(batchOf('translations', m), h.env, testContext(), { ports: h.ports, p5: h.p5, sleep: async () => {}, now: () => h.clock.now().getTime() });
  return m;
}

describe('translations consumer', () => {
  it('translates, inserts the row, submits IndexNow, closes the run with usage', async () => {
    const h = setup();
    const m = await deliver(h, body());
    expect(m.acked).toBe(true);
    expect(m.retried).toEqual([]);
    const de = h.db.rows('articles').find((a) => a.language === 'de')!;
    expect(de).toMatchObject({ title: 'German Eloxieren', slug: 'german-eloxieren-anleitung', status: 'published', translation_id: TID, featured_image: 'https://img.example/x.png', featured_image_alt: 'x', meta_title: 'German Eloxieren | Microns Hub' });
    expect(String(de.content)).toContain('Eloxiert');
    const run = runByKey(h, translateRunKey(TID, 'de', DATE))!;
    expect(run).toMatchObject({ agent: 'content_daily.translate', trigger: 'queue', status: 'succeeded', parent_run_id: PARENT, subject_type: 'article', subject_id: EN, llm_calls: 1, input_tokens: 1000, output_tokens: 900 });
    expect(run.output).toMatchObject({ language: 'de', origin: 'daily', slug: 'german-eloxieren-anleitung', indexnow: true, model: 'gemini-2.5-flash-lite', tables_translated: null, duplicate: false, done_event: false });
    expect(Number(run.cost_cents)).toBeCloseTo(0.04, 6);
    const req = h.p5.sources.requests[0];
    expect(JSON.parse(req.body!)).toEqual({ host: 'www.micronshub.eu', key: INDEXNOW_TEST_KEY, keyLocation: `${SITE}/indexnow_key.txt`, urlList: [`${SITE}/en/blog/anodising-guide`, `${SITE}/de/blog/german-eloxieren-anleitung`] });
    expect(h.p5.textLlm.calls.map((c) => c.meta.step)).toEqual(['translate-de']);
    expect(h.p5.telegramText.messages).toEqual([]);
  });

  it('IndexNow URL uses the language blog segment (sv -> blogg, fi -> blogi)', async () => {
    const h = setup();
    await deliver(h, body({ language: 'sv' }));
    await deliver(h, body({ language: 'fi' }));
    expect(h.p5.sources.requests.map((r) => JSON.parse(r.body!).urlList[1])).toEqual([`${SITE}/sv/blogg/swedish-eloxieren-anleitung`, `${SITE}/fi/blogi/finnish-eloxieren-anleitung`]);
  });

  it('missing INDEXNOW_KEY: translation succeeds, indexnow not_configured, nothing posted', async () => {
    const h = setup({ indexnow: false });
    await deliver(h, body());
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))!.output).toMatchObject({ indexnow: 'not_configured' });
    expect(h.p5.sources.requests).toEqual([]);
    expect(h.db.rows('articles').some((a) => a.language === 'de')).toBe(true);
  });

  it('existing translation: ack, run skipped (exists), no model call', async () => {
    const h = setup();
    h.db.seed('articles', [{ id: uuid('d', 1), slug: 'de-x', language: 'de', translation_id: TID, status: 'published' }]);
    const m = await deliver(h, body());
    expect(m.acked).toBe(true);
    expect(h.p5.textLlm.calls).toEqual([]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'skipped', output: { reason: 'exists' } });
  });

  it('23505 on insert with the group row present (a concurrent duplicate) counts as success; IndexNow gets the English URL only', async () => {
    const h = setup();
    const answer = okText(delimiterAnswer({ title: 'German Eloxieren', slug: 'german-eloxieren-anleitung', content: CONTENT.replace('Anodised', 'Eloxiert') }), { model: 'gemini-2.5-flash-lite', stop: 'STOP' });
    h.p5.textLlm.setScript(() => {
      // the other delivery of this pair saves its row while this one is still translating
      if (!h.db.rows('articles').some((a) => a.language === 'de')) {
        h.db.seed('articles', [{ id: uuid('d', 3), slug: 'german-eloxieren-anleitung', language: 'de', translation_id: TID, status: 'published' }]);
      }
      return answer;
    });
    const m = await deliver(h, body());
    expect(m.acked).toBe(true);
    expect(m.retried).toEqual([]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'succeeded', output: { duplicate: true } });
    expect(JSON.parse(h.p5.sources.requests[0].body!).urlList).toEqual([`${SITE}/en/blog/anodising-guide`]);
    expect(h.p5.telegramText.messages).toEqual([]);
  });

  it('23505 on insert with the group row still missing (slug used by another article): run failed slug_conflict, one alert, ack, no IndexNow', async () => {
    const h = setup();
    h.db.seed('articles', [{ id: uuid('d', 2), slug: 'german-eloxieren-anleitung', language: 'de', translation_id: uuid('7', 2), status: 'published' }]);
    const m = await deliver(h, body());
    expect(m.acked).toBe(true);
    expect(m.retried).toEqual([]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'failed', error: 'slug_conflict', output: { language: 'de', origin: 'daily', slug: 'german-eloxieren-anleitung' } });
    expect(h.db.rows('articles').filter((a) => a.translation_id === TID && a.language === 'de')).toEqual([]);
    expect(h.p5.sources.requests).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([translationAlerts.slugConflict('de', 'anodising-guide', 'german-eloxieren-anleitung')]);
  });

  it('a concurrent duplicate at the first delivery is acked without work; its own retry continues under the same run', async () => {
    const h = setup();
    h.db.seed('agent_runs', [{ agent: 'content_daily.translate', trigger: 'queue', idempotency_key: translateRunKey(TID, 'de', DATE), status: 'running', started_at: new Date(T0 - 5 * 60_000).toISOString(), llm_calls: 1, input_tokens: 10, output_tokens: 5, cost_cents: 0.01 }]);
    const dup = await deliver(h, body());
    expect(dup.acked).toBe(true);
    expect(h.p5.textLlm.calls).toEqual([]);
    const retry = await deliver(h, body(), 2);
    expect(retry.acked).toBe(true);
    const runs = h.db.rows('agent_runs').filter((r) => r.agent === 'content_daily.translate');
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded', llm_calls: 2, input_tokens: 1010 });
  });

  it('a running run older than 30 min at the first delivery (crash) continues', async () => {
    const h = setup();
    h.db.seed('agent_runs', [{ agent: 'content_daily.translate', trigger: 'queue', idempotency_key: translateRunKey(TID, 'de', DATE), status: 'running', started_at: new Date(T0 - 31 * 60_000).toISOString() }]);
    const m = await deliver(h, body());
    expect(m.acked).toBe(true);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))!.status).toBe('succeeded');
  });

  it('a final run acks at once', async () => {
    const h = setup();
    h.db.seed('agent_runs', [{ agent: 'content_daily.translate', trigger: 'queue', idempotency_key: translateRunKey(TID, 'de', DATE), status: 'failed' }]);
    const m = await deliver(h, body(), 3);
    expect(m.acked).toBe(true);
    expect(h.p5.textLlm.calls).toEqual([]);
  });

  it('every model 5xx -> retry with 120 s x attempts, run stays running with the usage so far', async () => {
    const h = setup();
    h.p5.textLlm.setScript(() => failText('server', { status: 503 }));
    const m1 = await deliver(h, body(), 1);
    expect(m1.retried).toEqual([{ delaySeconds: 120 }]);
    expect(m1.acked).toBe(false);
    expect(h.p5.textLlm.calls.length).toBe(15);
    const m3 = await deliver(h, body(), 3);
    expect(m3.retried).toEqual([{ delaySeconds: 360 }]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))!.status).toBe('running');
  });

  it('parse failure -> retry() without delay', async () => {
    const h = setup();
    h.p5.textLlm.setScript((c) => okText('no delimiters here', { model: c.model }));
    const m = await deliver(h, body(), 2);
    expect(m.retried).toEqual([undefined]);
    expect(m.acked).toBe(false);
  });

  it('the 5th delivery is not the last one: retry with delay, run still running, no alert', async () => {
    const h = setup();
    h.p5.textLlm.setScript(() => failText('server', { status: 503 }));
    const m = await deliver(h, body(), 5);
    expect(m.retried).toEqual([{ delaySeconds: 600 }]);
    expect(m.acked).toBe(false);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))!.status).toBe('running');
    expect(h.p5.telegramText.messages).toEqual([]);
  });

  it('usage of a failed delivery is stored on the run before the retry and kept by the next delivery', async () => {
    const h = setup();
    const usage = { input_tokens: 700, output_tokens: 300, cost_usd: 0.0002 };
    h.p5.textLlm.setScript((c) => okText('no delimiters here', { model: c.model, usage }));
    const m2 = await deliver(h, body(), 2);
    expect(m2.retried).toEqual([undefined]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'running', llm_calls: 1, input_tokens: 700, output_tokens: 300 });
    const m3 = await deliver(h, body(), 3);
    expect(m3.retried).toEqual([undefined]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'running', llm_calls: 2, input_tokens: 1400, output_tokens: 600 });
  });

  it('an answered Gemini call that fails (blocked, with usage) is billed: its usage is stored on the run before the retry and on the final close', async () => {
    const h = setup();
    const usage = { input_tokens: 900, output_tokens: 5, cost_usd: 0.0003 };
    h.p5.textLlm.setScript(() => failText('blocked', { status: 200, usage: { ...usage, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'gemini-2.5-flash-lite' } }));
    const m2 = await deliver(h, body(), 2);
    expect(m2.retried).toEqual([undefined]);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'running', llm_calls: 1, input_tokens: 900, output_tokens: 5 });
    const m6 = await deliver(h, body(), 6);
    expect(m6.retried).toEqual([undefined]);
    const run = runByKey(h, translateRunKey(TID, 'de', DATE))!;
    expect(run).toMatchObject({ status: 'failed', error: 'GeminiCallError', llm_calls: 2, input_tokens: 1800, output_tokens: 10 });
    expect(Number(run.cost_cents)).toBeCloseTo(0.06, 6);
  });

  it('last delivery: run failed, one alert, retry into the DLQ', async () => {
    const h = setup();
    h.p5.textLlm.setScript(() => failText('rate_limited', { status: 429 }));
    const m = await deliver(h, body(), 6);
    expect(m.retried).toEqual([undefined]);
    const run = runByKey(h, translateRunKey(TID, 'de', DATE))!;
    expect(run).toMatchObject({ status: 'failed', error: 'GeminiOverloadedError' });
    expect(h.p5.telegramText.texts()).toEqual([translationAlerts.failed('de', 'anodising-guide', 'GeminiOverloadedError')]);
  });

  it('flag off / shadow / translate not in steps: ack, run skipped with the reason, no model call', async () => {
    for (const [flag, reason] of [
      [{ enabled: false }, 'flag_off'],
      [{ mode: 'shadow' as const, value: { steps: ['translate'] } }, 'shadow'],
      [{ value: { steps: ['generate', 'sitemap'] } }, 'flag_off'],
    ] as const) {
      const h = setup();
      h.setFlag(flag);
      const m = await deliver(h, body());
      expect(m.acked).toBe(true);
      expect(h.p5.textLlm.calls).toEqual([]);
      expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'skipped', output: { reason } });
    }
  });

  it('missing English master: ack, run failed (master_missing)', async () => {
    const h = setup();
    const m = await deliver(h, body({ en_article_id: uuid('e', 9) }));
    expect(m.acked).toBe(true);
    expect(runByKey(h, translateRunKey(TID, 'de', DATE))).toMatchObject({ status: 'failed', error: 'master_missing' });
  });

  it('invalid body: logged and acked', async () => {
    const h = setup();
    const m = await deliver(h, { ...body(), language: 'xx' as never });
    expect(m.acked).toBe(true);
    expect(h.db.rows('agent_runs')).toEqual([]);
  });

  it('translations-done when the 13th language of a daily group lands (not for backfill); a second event is harmless', async () => {
    const h = setup();
    h.contentDaily.ensure(`content-daily-${DATE}`);
    const others = TARGET_LANGS.filter((l) => l !== 'fi');
    h.db.seed('articles', others.map((l, i) => ({ id: uuid('c', i + 1), slug: `${l}-x`, language: l, translation_id: TID, status: 'published' })));
    await deliver(h, body({ language: 'fi', origin: 'backfill' }));
    expect(h.contentDaily.instances.get(`content-daily-${DATE}`)!.calls).toEqual([]);
    // remove fi again and deliver the daily message
    h.db.tables.articles = h.db.tables.articles.filter((a) => a.language !== 'fi');
    await deliver(h, body({ language: 'fi', origin: 'daily', for_date: '2026-10-07' }));
    h.contentDaily.ensure('content-daily-2026-10-07');
    h.db.tables.articles = h.db.tables.articles.filter((a) => a.language !== 'fi');
    h.db.tables.agent_runs = [];
    await deliver(h, body({ language: 'fi', origin: 'daily' }));
    h.db.tables.articles = h.db.tables.articles.filter((a) => a.language !== 'fi');
    h.db.tables.agent_runs = [];
    await deliver(h, body({ language: 'fi', origin: 'daily' }));
    const calls = h.contentDaily.instances.get(`content-daily-${DATE}`)!.calls;
    expect(calls).toEqual([
      { method: 'sendEvent', args: { type: 'translations-done', payload: { translation_id: TID } } },
      { method: 'sendEvent', args: { type: 'translations-done', payload: { translation_id: TID } } },
    ]);
    expect(runByKey(h, translateRunKey(TID, 'fi', DATE))!.output).toMatchObject({ done_event: true });
  });
});
