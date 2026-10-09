// Consumer of the queue "translations" (Phase 5): one English article into one language per message, with the
// live Gemini model chain, IndexNow and the 'translations-done' event of content-daily. Replaces the
// translate-article calls of auto-translate-articles (live version 81 of the translation itself).
//
// Per message
//   1. run    content_daily.translate, key content_daily.translate:<translation_id>:<lang>:<for_date>,
//             parent_run_id; an existing final run -> ack; an existing running run at the first delivery that
//             started < 30 min ago -> ack (a concurrent duplicate, e.g. a daily and a backfill message); any other
//             running run is this message's own retry or a redelivery -> continue under it
//   2. flag   agent.content_daily enabled, not shadow, 'translate' in value.steps; else ack and close 'skipped'
//             with reason flag_off or shadow
//   3. exists the language row of the group exists -> ack, 'skipped' (reason exists)
//   4. master the English article (language en); missing -> ack, 'failed' (master_missing)
//   5. translate content/translate.ts over content/gemini-chain.ts (90 s per call, model chain)
//   6. insert articles; 23505 with the language row of the group present = success (a concurrent duplicate, as
//      live); 23505 with the row still missing (the slug belongs to another article of the language) -> ack, run
//      'failed' with error slug_conflict, one text alert, no IndexNow (the backfill holds the pair for 7 days)
//   7. IndexNow [English URL, new language URL] when INDEXNOW_KEY is set (else 'not_configured')
//   8. origin daily and all 13 languages present -> CONTENT_DAILY.get('content-daily-<for_date>')
//      .sendEvent('translations-done') (buffered when early; a second event is harmless)
//   9. close 'succeeded' with usage and cost; ack
// Retries (max_retries 5, so the 6th delivery is the last): every model overloaded -> retry(120 s x attempts);
// any other failure (parse, length guard, database) -> retry(); the last delivery closes the run 'failed', sends one
// text alert and retries into translations-dlq. The next daily backfill queues a still missing language again.

import { formatLogLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { addUsage, checkpointRun, closeRun, EMPTY_USAGE, isFinal, openRun, usageFromRow, type UsageAcc } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import { BACKFILL_HOLD_DAYS, SLUG_CONFLICT } from '../content/backfill';
import { CONTENT_FLAG, errorCode, snapshotFlag, tenantOf } from '../content/flag';
import { callGemini, geminiFailureUsage, isGeminiOverloaded } from '../content/gemini-chain';
import { submitIndexNow, translationUrls, type IndexNowResult } from '../content/indexnow';
import { isTargetLang, LANGUAGE_NAMES, TARGET_LANGS } from '../content/languages';
import { translateRunKey } from '../content/report';
import { TRANSLATE_PROMPT_ID, TRANSLATE_TABLE_PROMPT_ID, translateToLanguage } from '../content/translate';
import { DbError } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import type { TranslationMessageV1 } from './messages';

/** max_retries of the consumer (wrangler.jsonc): deliveries 1..6. */
export const TRANSLATION_MAX_RETRIES = 5;
export const OVERLOAD_DELAY_S = 120;
export const DUPLICATE_WINDOW_MS = 30 * 60_000;

export interface TranslationsDeps {
  ports?: Ports;
  p5?: P5Ports;
  /** Waits between same-model attempts and table chunks (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Clock in ms (table budget, duplicate window); default Date.now. */
  now?: () => number;
}

export const translationAlerts = {
  failed: (lang: string, slug: string, code: string) =>
    `Translation ${lang} failed for ${slug} after ${TRANSLATION_MAX_RETRIES + 1} attempts (${code}). The next daily backfill queues it again.`,
  slugConflict: (lang: string, slug: string, translatedSlug: string) =>
    `Translation ${lang} for ${slug} not saved: the slug ${translatedSlug} is already used by another ${lang} article. The daily backfill leaves this pair out for ${BACKFILL_HOLD_DAYS} days.`,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTranslationMessage(b: unknown): b is TranslationMessageV1 {
  const x = b as Record<string, unknown> | null;
  return (
    typeof x === 'object' && x !== null && x.v === 1 &&
    typeof x.translation_id === 'string' && UUID.test(x.translation_id) &&
    typeof x.en_article_id === 'string' && UUID.test(x.en_article_id) &&
    isTargetLang(x.language) &&
    (x.origin === 'daily' || x.origin === 'backfill' || x.origin === 'manual') &&
    typeof x.for_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.for_date) &&
    typeof x.parent_run_id === 'string' && UUID.test(x.parent_run_id)
  );
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

export async function translationsConsumer(
  batch: MessageBatch<TranslationMessageV1>,
  env: OpsEnv,
  ctx: ExecutionContext,
  deps?: TranslationsDeps,
): Promise<void> {
  void ctx;
  let ports = deps?.ports;
  let p5 = deps?.p5;
  for (const msg of batch.messages) {
    if (!isTranslationMessage(msg.body)) {
      log('translation message invalid', { id: msg.id });
      msg.ack();
      continue;
    }
    ports ??= makePorts(env);
    p5 ??= makeP5Ports(env);
    await handleTranslation(msg, env, ports, p5, deps ?? {});
  }
}

class Done {
  constructor(readonly status: 'succeeded' | 'skipped' | 'failed', readonly output: Record<string, unknown>, readonly error?: string) {}
}

async function handleTranslation(msg: Message<TranslationMessageV1>, env: OpsEnv, ports: Ports, p5: P5Ports, deps: TranslationsDeps): Promise<void> {
  const m = msg.body;
  const db = ports.db;
  const now = deps.now ?? (() => Date.now());
  const final = msg.attempts > TRANSLATION_MAX_RETRIES;
  const fields = { language: m.language, origin: m.origin, attempt: msg.attempts };

  // 1 run row (a continued run keeps the usage its earlier deliveries recorded)
  let runId: string;
  let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  try {
    const opened = await openRun(db, {
      agent: 'content_daily.translate',
      trigger: 'queue',
      idempotency_key: translateRunKey(m.translation_id, m.language, m.for_date),
      parent_run_id: m.parent_run_id,
      subject_type: 'article',
      subject_id: m.en_article_id,
      tenant_id: tenantOf(env),
    });
    runId = opened.run_id;
    if (!opened.created) {
      if (isFinal(opened.status)) {
        msg.ack();
        return;
      }
      const row = await getRun(db, runId);
      if (msg.attempts === 1) {
        const started = row ? Date.parse(row.started_at) : NaN;
        if (Number.isFinite(started) && now() - started < DUPLICATE_WINDOW_MS) {
          log('translation duplicate', fields);
          msg.ack();
          return;
        }
      }
      if (row) acc = usageFromRow(row);
    }
  } catch (e) {
    log('translation run open failed', { ...fields, code: errorCode(e) });
    msg.retry();
    return;
  }

  let slug = m.en_article_id;
  try {
    // 2 flag
    const flag = snapshotFlag(await readFlag(env, CONTENT_FLAG));
    if (!flag.enabled || !flag.steps.includes('translate')) throw new Done('skipped', { language: m.language, origin: m.origin, reason: 'flag_off' });
    if (flag.mode === 'shadow') throw new Done('skipped', { language: m.language, origin: m.origin, reason: 'shadow' });

    // 3 exists
    const existing = await db.select<{ id: string }>('articles', { columns: 'id', filters: [['translation_id', 'eq', m.translation_id], ['language', 'eq', m.language]], limit: 1 });
    if (existing.length > 0) throw new Done('skipped', { language: m.language, origin: m.origin, reason: 'exists' });

    // 4 master
    const masters = await db.select<{ id: string; title: string; slug: string; content: string | null; excerpt: string | null; meta_title: string | null; meta_description: string | null; translation_id: string | null; featured_image: string | null; featured_image_alt: string | null }>('articles', {
      columns: 'id,title,slug,content,excerpt,meta_title,meta_description,translation_id,featured_image,featured_image_alt',
      filters: [['id', 'eq', m.en_article_id], ['language', 'eq', 'en']],
      limit: 1,
    });
    const master = masters[0];
    if (!master || !master.translation_id) throw new Done('failed', { language: m.language, origin: m.origin }, 'master_missing');
    slug = master.slug;

    // 5 translate
    const meta = (step: string, prompt: string) => ({ agent: 'content_daily.translate', run_id: runId, tenant_id: tenantOf(env), step, prompt });
    let modelUsed: string | null = null;
    const translation = await translateToLanguage(
      {
        title: master.title,
        content: master.content ?? '',
        excerpt: master.excerpt || '',
        metaTitle: master.meta_title || master.title,
        metaDescription: master.meta_description || '',
      },
      LANGUAGE_NAMES[m.language],
      m.language,
      {
        call: async (prompt, kind) => {
          const usageStep = kind === 'main' ? 'translate' : 'translate-table';
          let answer: Awaited<ReturnType<typeof callGemini>>;
          try {
            answer = await callGemini(p5.textLlm, prompt, {
              meta: kind === 'main' ? meta(`translate-${m.language}`, TRANSLATE_PROMPT_ID) : meta(`translate-table-${m.language}`, TRANSLATE_TABLE_PROMPT_ID),
              sleep: deps.sleep,
            });
          } catch (e) {
            // an answered call that failed is billed: its usage joins the run before the failure path stores it
            for (const u of geminiFailureUsage(e)) acc = addUsage(acc, u, usageStep);
            throw e;
          }
          for (const u of answer.usage) acc = addUsage(acc, u, usageStep);
          if (kind === 'main') modelUsed = answer.model;
          return answer.text;
        },
        now,
        sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      },
    );

    // 6 insert (23505 = success when the group's row exists; else the slug is taken by another article)
    let inserted = true;
    try {
      await db.insert('articles', {
        title: translation.title,
        slug: translation.slug,
        content: translation.content,
        excerpt: translation.excerpt,
        language: m.language,
        status: 'published',
        meta_title: translation.metaTitle,
        meta_description: translation.metaDescription,
        translation_id: master.translation_id,
        featured_image: master.featured_image,
        featured_image_alt: master.featured_image_alt,
      });
    } catch (e) {
      if (!(e instanceof DbError && e.code === '23505')) throw e;
      inserted = false;
      const landed = await db.select<{ id: string }>('articles', { columns: 'id', filters: [['translation_id', 'eq', master.translation_id], ['language', 'eq', m.language]], limit: 1 });
      if (landed.length === 0) {
        await p5.telegramText.send(translationAlerts.slugConflict(m.language, master.slug, translation.slug));
        throw new Done('failed', { language: m.language, origin: m.origin, slug: translation.slug, model: modelUsed, tables_translated: translation.tablesTranslated }, SLUG_CONFLICT);
      }
    }

    // 7 IndexNow
    const indexnow: IndexNowResult = await submitIndexNow(p5.sources, {
      key: env.INDEXNOW_KEY,
      siteOrigin: env.SITE_ORIGIN,
      urls: translationUrls(env.SITE_ORIGIN, master.slug, m.language, inserted ? translation.slug : null),
    });

    // 8 translations-done
    let done_event = false;
    if (m.origin === 'daily') {
      const langs = await db.select<{ language: string }>('articles', { columns: 'language', filters: [['translation_id', 'eq', m.translation_id]] });
      const present = new Set(langs.map((r) => r.language));
      if (TARGET_LANGS.every((l) => present.has(l)) && env.CONTENT_DAILY) {
        try {
          const instance = await env.CONTENT_DAILY.get(`content-daily-${m.for_date}`);
          await instance.sendEvent({ type: 'translations-done', payload: { translation_id: m.translation_id } });
          done_event = true;
        } catch (e) {
          log('translations-done not delivered', { ...fields, code: errorCode(e) });
        }
      }
    }

    // 9 close
    throw new Done('succeeded', {
      language: m.language,
      origin: m.origin,
      slug: translation.slug,
      duplicate: !inserted,
      indexnow,
      model: modelUsed,
      tables_translated: translation.tablesTranslated,
      done_event,
    });
  } catch (e) {
    if (e instanceof Done) {
      try {
        await closeRun(db, runId, { status: e.status, output: e.output, ...(e.error ? { error: e.error } : {}) }, acc);
      } catch (closeError) {
        log('translation run close failed', { ...fields, code: errorCode(closeError) });
        msg.retry();
        return;
      }
      log('translation done', { ...fields, status: e.status });
      msg.ack();
      return;
    }
    const code = errorCode(e);
    const overloaded = isGeminiOverloaded(e);
    log('translation failed', { ...fields, code, overloaded });
    if (final) {
      try {
        await closeRun(db, runId, { status: 'failed', error: code, output: { language: m.language, origin: m.origin, attempts: msg.attempts } }, acc);
      } catch {
        // the alert and the DLQ still follow
      }
      await p5.telegramText.send(translationAlerts.failed(m.language, slug, code));
      msg.retry();
      return;
    }
    try {
      await checkpointRun(db, runId, acc);
    } catch {
      // usage of this delivery is lost; the retry still follows
    }
    if (overloaded) msg.retry({ delaySeconds: OVERLOAD_DELAY_S * msg.attempts });
    else msg.retry();
  }
}
