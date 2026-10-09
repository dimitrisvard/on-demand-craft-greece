// ContentDailyWorkflow ('content-daily', instance content-daily-<YYYY-MM-DD>): the daily content chain that replaces
// the pg_cron jobs enqueue-daily-article, process-article-queue, auto-translate-daily-articles and
// auto-fix-article-links (and starts the sitemap, which replaces auto-update-sitemap).
//
//   open-run           agent_runs content_daily, key content_daily:<date>; a final run exits
//   flag               agent.content_daily off -> run 'skipped' (flag_off); the mode and steps of the run
//   enqueue            [generate] rpc enqueue_next_article; none -> no_titles (one text alert), generation skipped
//   claim              [generate] rpc get_next_queue_job (shadow: the oldest unprocessed title, no claim)
//   generate-en        [generate] frozen prompt content_daily.generate_en@v1, value.model, max_tokens 16384, live
//                      parser and 2,000-word guard; 3 attempts 5 min apart, timeout 10 min; after the last attempt
//                      rpc mark_queue_job_failed and one text alert, then on to fan-out (shadow: only with
//                      value.shadow_generate, the result goes to R2 phase5-shadow/content-daily/<date>/en.json)
//   publish-en(-log, -done)  insert articles (23505 on slug and language -> the existing row), the generation log,
//                      title processed, rpc mark_queue_job_completed
//   seo-purge-en       KV SEO_CACHE seo:v1:list:en (best effort)
//   fan-out            [translate] 13 'daily' messages for today's group + backfill (oldest first, value cap per
//                      language) on the queue translations
//   wait-translations  'translations-done' for up to 6 h, only when daily messages went out; a timeout continues
//   fix-links-<lang>   [fix_links] one step per language (pages of 200; shadow scans and counts only)
//   sitemap            [sitemap] SITEMAP.create sitemap-<date> (already exists = done); runs in shadow too
//   seo-purge          [translate] seo:v1:list:<lang> of today's languages, seo:v1:translations:<id> of today's and
//                      back-filled groups
//   report, close-run  translation status, lag per language, the sitemap run's url count when it has finished
// Rules
//   - Every side-effecting step re-reads the flag first; a switched-off flag (or a switch to shadow during an
//     assist run) stops the run, which closes 'skipped' with reason 'flag_off' and what was done so far.
//   - shadow writes nothing to business tables, sends no queue message and no Telegram text (R2 phase5-shadow/
//     only); the sitemap Workflow reads the same flag and runs in shadow as well.
//   - A failed generation closes the run 'failed' (error generate_failed) after translations, fix-links and the
//     sitemap have run; any other failure closes it 'failed' with the step and an error code and one text alert.
//   - Step results are compact (the article text is the largest, well under 1 MiB) and carry no addresses.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { need } from '../agents/config';
import { readFlag } from '../agents/flags';
import { addUsage, closeRun, EMPTY_USAGE, isAlreadyExists, isFinal, openRun, type UsageAcc } from '../agents/runs';
import { englishMasters, planBackfill, presentLanguages } from '../content/backfill';
import { CONTENT_FLAG, errorCode, isDay, mustHalt, snapshotFlag, tenantOf, type ContentFlagSnap } from '../content/flag';
import { buildSlugMapping, fixLinksForLanguage } from '../content/fix-links';
import {
  fetchSiloNeighbors,
  formatSiloArticlesForPrompt,
  generateSlug,
  GENERATE_GATEWAY_TIMEOUT_MS,
  GENERATE_MAX_TOKENS,
  GENERATE_PROMPT_ID,
  GENERATE_TIMEOUT_MS,
  parseMasterArticle,
  renderGeneratePrompt,
  rotationIndices,
  todaysSilo,
} from '../content/generate-en';
import { TARGET_LANGS } from '../content/languages';
import { exactBuffer, selectAll } from '../content/paged';
import { lagDays, translationStatus, type TranslationState } from '../content/report';
import { listKey, purgeSeoKeys, translationsKey } from '../content/seo-purge';
import { DbError } from '../db/postgrest';
import { LOG_PREFIX, type ContentDailyParams, type OpsEnv } from '../env';
import { makePorts, type LlmUsage, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import type { TargetLang, TranslationMessageV1 } from '../queues/messages';
import { DB, NOTIFY, BLOB } from './steps';

const AGENT = 'content_daily' as const;
export const WAIT_TIMEOUT = '6 hours' as const;
/** 3 attempts (limit counts retries), 5 minutes apart, 10 minutes each (D-22). */
export const GENERATE_STEP: WorkflowStepConfig = { retries: { limit: 2, delay: '5 minutes', backoff: 'constant' }, timeout: '10 minutes' };
/** A full language pass of fix-links: paged reads and writes. */
export const FIX_LINKS_STEP: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '10 minutes' };
/** Queues sendBatch: at most 100 messages per call. */
export const SEND_BATCH_MAX = 100;

export interface ContentDailyDeps {
  env: OpsEnv;
  ports: Ports;
  p5: P5Ports;
  step: WorkflowStep;
}

export type ContentDailyOutcome = 'exists' | 'flag_off' | 'succeeded' | 'failed';

export interface ContentDailyResult {
  outcome: ContentDailyOutcome;
  run_id: string;
  failed_step?: string;
}

export interface ContentDailyOutput {
  article_id: string | null;
  slug: string | null;
  words: number | null;
  no_titles: boolean;
  generate: 'published' | 'failed' | 'skipped' | 'shadow' | 'none';
  translations: Partial<Record<TargetLang, TranslationState>>;
  backfilled: number;
  daily_queued: number;
  translations_wait?: 'done' | 'timeout';
  lag_days: Partial<Record<TargetLang, number | null>>;
  fix_links: Partial<Record<TargetLang, { scanned: number; updated: number }>>;
  sitemap: { instance: string; created: boolean; urls: number | null } | null;
  shadow?: true;
  reason?: string;
  halted_at?: string;
}

interface Job {
  queue_id: string | null;
  title_id: string;
  title: string;
  silo_category: string | null;
}

interface Generated {
  title_id: string;
  title: string;
  silo_category: string | null;
  slug: string;
  content: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
  words: number;
  model: string;
  usage: LlmUsage;
  silo_neighbors_used: number;
}

class Halt {
  constructor(readonly at: string) {}
}

export class ContentDailyWorkflow extends WorkflowEntrypoint<OpsEnv, ContentDailyParams> {
  async run(event: Readonly<WorkflowEvent<ContentDailyParams>>, step: WorkflowStep): Promise<unknown> {
    return runContentDaily(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), p5: makeP5Ports(this.env), step });
  }
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

/** Telegram texts (plain, no parse mode). */
export const contentAlerts = {
  noTitles: (date: string) => `Content daily ${date}: article titles exhausted, no English article today. Add titles in the dashboard (Auto Blog).`,
  generateFailed: (date: string, code: string) =>
    `Content daily ${date}: English article generation failed after 3 attempts (${code}). The queue job is marked failed and the title stays unprocessed.`,
  runFailed: (date: string, step: string, code: string) => `Content daily ${date}: run failed at step ${step} (${code}).`,
};

export async function runContentDaily(p: ContentDailyParams, instanceId: string, d: ContentDailyDeps): Promise<ContentDailyResult> {
  if (!p || !isDay(p.date)) throw new NonRetryableError('invalid_params');
  const { env, ports, p5, step } = d;
  const db = ports.db;
  const date = p.date;
  const tenant = tenantOf(env);
  let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  let current = 'open-run';
  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
    current = name;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };

  const opened = await run('open-run', DB, () =>
    openRun(db, {
      agent: AGENT,
      trigger: p.trigger === 'manual' ? 'manual' : 'cron',
      idempotency_key: `${AGENT}:${date}`,
      workflow_name: 'content-daily',
      workflow_instance_id: instanceId,
      subject_type: 'article',
      tenant_id: tenant,
    }),
  );
  const runId = opened.run_id;
  if (!opened.created && isFinal(opened.status)) return { outcome: 'exists', run_id: runId };

  /** Today's published English article (the 'daily' group). */
  let todays: { translation_id: string; article_id: string } | null = null;
  const out: ContentDailyOutput = {
    article_id: null,
    slug: null,
    words: null,
    no_titles: false,
    generate: 'none',
    translations: {},
    backfilled: 0,
    daily_queued: 0,
    lag_days: {},
    fix_links: {},
    sitemap: null,
  };

  try {
    // 1 flag
    const flag = await run('flag', DB, async () => snapshotFlag(await readFlag(env, CONTENT_FLAG)));
    if (!flag.enabled) {
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { reason: 'flag_off' } }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }
    const mode = flag.mode;
    const shadow = mode === 'shadow';
    if (shadow) out.shadow = true;
    const steps = new Set(flag.steps);
    /** The live flag inside a side-effecting step; null when the run must stop. */
    const live = async (): Promise<ContentFlagSnap | null> => {
      const f = snapshotFlag(await readFlag(env, CONTENT_FLAG));
      return mustHalt(mode, f) ? null : f;
    };

    // 2-6 generation
    if (steps.has('generate')) {
      let job: Job | null = null;
      if (!shadow) {
        const enq = await run('enqueue', DB, async () => {
          if (!(await live())) return { halted: true as const, queue_id: null };
          const id = await db.rpc<unknown>('enqueue_next_article', {});
          return { halted: false as const, queue_id: typeof id === 'string' && id ? id : null };
        });
        if (enq.halted) throw new Halt('enqueue');
        if (!enq.queue_id) {
          out.no_titles = true;
          await run('alert-no-titles', NOTIFY, async () => {
            await p5.telegramText.send(contentAlerts.noTitles(date));
            return true;
          });
        } else {
          job = await run('claim', DB, async () => {
            const rows = await db.rpc<unknown>('get_next_queue_job', {});
            const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
            if (!row || typeof row.queue_id !== 'string' || typeof row.title_id !== 'string') return null;
            return { queue_id: row.queue_id, title_id: row.title_id, title: String(row.title ?? ''), silo_category: typeof row.silo_category === 'string' ? row.silo_category : null };
          });
        }
      } else {
        job = await run('claim', DB, async () => {
          const rows = await db.select<{ id: string; title: string; silo_category: string | null }>('article_titles', {
            columns: 'id,title,silo_category',
            filters: [['processed', 'eq', false]],
            order: [{ column: 'created_at', ascending: true }],
            limit: 1,
          });
          return rows[0] ? { queue_id: null, title_id: rows[0].id, title: rows[0].title, silo_category: rows[0].silo_category ?? null } : null;
        });
        if (!job) out.no_titles = true;
      }

      if (job && (!shadow || flag.shadow_generate)) {
        const claimed: Job = job;
        let generated: Generated | null = null;
        try {
          generated = await run('generate-en', GENERATE_STEP, () => generateEnglish(p5, db, claimed, { date, runId, tenant, model: flag.model, shadow }));
          acc = addUsage(acc, generated.usage, 'generate-en');
        } catch (e) {
          if (e instanceof Halt) throw e;
          out.generate = 'failed';
          const code = errorCode(e);
          log('content daily generation failed', { date, code });
          if (!shadow && claimed.queue_id) {
            const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
            await run('mark-failed', DB, async () => {
              await db.rpc('mark_queue_job_failed', { queue_job_id: claimed.queue_id, error_msg: message });
              return true;
            });
            await run('alert-generate-failed', NOTIFY, async () => {
              await p5.telegramText.send(contentAlerts.generateFailed(date, code));
              return true;
            });
          }
        }

        if (generated && shadow) {
          const g = generated;
          await run('shadow-en', BLOB, async () => {
            const body = new TextEncoder().encode(JSON.stringify({ title: g.title, slug: g.slug, content: g.content, excerpt: g.excerpt, meta_title: g.meta_title, meta_description: g.meta_description, words: g.words, model: g.model }));
            await ports.blob.put(`phase5-shadow/content-daily/${date}/en.json`, exactBuffer(body), { contentType: 'application/json' });
            return true;
          });
          out.generate = 'shadow';
          out.slug = g.slug;
          out.words = g.words;
        } else if (generated && claimed.queue_id) {
          const g = generated;
          const queueId = claimed.queue_id;
          const published = await run('publish-en', DB, () => publishEnglish(db, g));
          await run('publish-en-log', DB, async () => {
            await db.insert('article_generation_logs', {
              summary_data: {
                title: g.title,
                silo_category: g.silo_category,
                scheduled_silo: todaysSilo(date),
                matched_scheduled_silo: g.silo_category === todaysSilo(date),
                master_article_id: published.article_id,
                status: 'published',
                translations_pending: true,
                silo_neighbors_used: g.silo_neighbors_used,
              },
            });
            return true;
          });
          await run('publish-en-done', DB, async () => {
            await db.update('article_titles', { processed: true, processed_at: ports.clock.now().toISOString() }, { filters: [['id', 'eq', g.title_id]] });
            await db.rpc('mark_queue_job_completed', { queue_job_id: queueId, article_id: published.article_id });
            return true;
          });
          out.generate = 'published';
          out.article_id = published.article_id;
          out.slug = published.slug;
          out.words = g.words;
          await run('seo-purge-en', DB, () => purgeSeoKeys(env.SEO_CACHE, [listKey('en')]));
          todays = { translation_id: published.translation_id, article_id: published.article_id };
        }
      } else if (job) {
        out.generate = 'skipped';
      }
    }

    // 7 fan-out
    let backfillGroups: string[] = [];
    if (steps.has('translate') && !shadow) {
      const today = todays;
      const fan = await run('fan-out', DB, async () => {
        const f = await live();
        if (!f) return { halted: true as const, daily: 0, backfill: 0, groups: [] as string[] };
        need(env, 'TRANSLATIONS');
        const messages: TranslationMessageV1[] = [];
        if (today) {
          for (const language of TARGET_LANGS) {
            messages.push({ v: 1, translation_id: today.translation_id, en_article_id: today.article_id, language, origin: 'daily', for_date: date, parent_run_id: runId });
          }
        }
        const daily = messages.length;
        const [masters, present] = [await englishMasters(db), await presentLanguages(db)];
        const backfill = planBackfill(masters, present, {
          cap: f.backfill_per_language_per_day,
          exclude: new Set(today ? [today.translation_id] : []),
          for_date: date,
          parent_run_id: runId,
        });
        messages.push(...backfill);
        for (let i = 0; i < messages.length; i += SEND_BATCH_MAX) {
          await env.TRANSLATIONS.sendBatch(messages.slice(i, i + SEND_BATCH_MAX).map((body) => ({ body })));
        }
        return { halted: false as const, daily, backfill: backfill.length, groups: [...new Set(backfill.map((m) => m.translation_id))] };
      });
      if (fan.halted) throw new Halt('fan-out');
      out.daily_queued = fan.daily;
      out.backfilled = fan.backfill;
      backfillGroups = fan.groups;

      // 8 wait-translations
      if (fan.daily > 0) {
        try {
          await step.waitForEvent('wait-translations', { type: 'translations-done', timeout: WAIT_TIMEOUT });
          out.translations_wait = 'done';
        } catch {
          out.translations_wait = 'timeout';
        }
      }
    }

    // 9 fix-links
    if (steps.has('fix_links')) {
      for (const lang of TARGET_LANGS) {
        const r = await run(`fix-links-${lang}`, FIX_LINKS_STEP, async () => {
          if (!(await live())) return null;
          const mapping = await buildSlugMapping(db);
          return fixLinksForLanguage(db, lang, mapping, { write: !shadow });
        });
        if (!r) throw new Halt(`fix-links-${lang}`);
        out.fix_links[lang] = { scanned: r.scanned, updated: shadow ? r.changed : r.updated };
      }
    }

    // 10 sitemap
    if (steps.has('sitemap')) {
      const instance = `sitemap-${date}`;
      const s = await run('sitemap', DB, async () => {
        const f = snapshotFlag(await readFlag(env, CONTENT_FLAG));
        if (!f.enabled) return null;
        need(env, 'SITEMAP');
        try {
          await env.SITEMAP.create({ id: instance, params: { date, parent_run_id: runId } });
          return { created: true };
        } catch (e) {
          if (isAlreadyExists(e)) return { created: false };
          throw e;
        }
      });
      if (!s) throw new Halt('sitemap');
      out.sitemap = { instance, created: s.created, urls: null };
    }

    // 11 seo-purge
    if (steps.has('translate') && !shadow) {
      const today = todays;
      await run('seo-purge', DB, async () => {
        const rows = await selectAll<{ id: string; language: string; translation_id: string | null }>(db, 'articles', {
          columns: 'language,translation_id',
          filters: [['created_at', 'gte', `${date}T00:00:00Z`]],
        });
        const langs = new Set(rows.map((r) => r.language));
        const groups = new Set<string>(backfillGroups);
        if (today) groups.add(today.translation_id);
        const keys = [...[...langs].sort().map(listKey), ...[...groups].map(translationsKey)];
        return purgeSeoKeys(env.SEO_CACHE, keys);
      });
    }

    // 12 report + close-run
    const today = todays;
    const report = await run('report', DB, async () => {
      const translations = today ? await translationStatus(db, today.translation_id, date) : {};
      const lag = await lagDays(db);
      let urls: number | null = null;
      if (out.sitemap) {
        const rows = await db.select<{ status: string; output: Record<string, unknown> | null }>('agent_runs', {
          columns: 'status,output',
          filters: [['agent', 'eq', 'content_daily.sitemap'], ['idempotency_key', 'eq', `content_daily.sitemap:${date}`]],
          limit: 1,
        });
        const u = rows[0]?.status === 'succeeded' ? rows[0].output?.urls : null;
        urls = typeof u === 'number' ? u : null;
      }
      return { translations, lag, urls };
    });
    out.translations = report.translations;
    out.lag_days = report.lag;
    if (out.sitemap) out.sitemap.urls = report.urls;

    const failed = out.generate === 'failed';
    await run('close-run', DB, () =>
      closeRun(db, runId, failed ? { status: 'failed', error: 'generate_failed', output: out } : { status: 'succeeded', output: out }, acc),
    );
    log('content daily done', { date, generate: out.generate, daily: out.daily_queued, backfill: out.backfilled });
    return failed ? { outcome: 'failed', run_id: runId, failed_step: 'generate-en' } : { outcome: 'succeeded', run_id: runId };
  } catch (e) {
    if (e instanceof Halt) {
      out.reason = 'flag_off';
      out.halted_at = e.at;
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: out }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }
    const failedStep = current;
    const code = errorCode(e);
    log('content daily failed', { date, step: failedStep, code });
    await run('close-failed', DB, () => closeRun(db, runId, { status: 'failed', error: `${failedStep}: ${code}`, output: out }, acc));
    if (!out.shadow) {
      await run('alert-failed', NOTIFY, async () => {
        await p5.telegramText.send(contentAlerts.runFailed(date, failedStep, code));
        return true;
      });
    }
    return { outcome: 'failed', run_id: runId, failed_step: failedStep };
  }
}

/** generate-en: load the title, neighbours and rotation, call the model, parse and guard (throws to retry). */
async function generateEnglish(
  p5: P5Ports,
  db: Ports['db'],
  job: Job,
  o: { date: string; runId: string; tenant: string; model: string; shadow: boolean },
): Promise<Generated> {
  const rows = await db.select<{ id: string; title: string; silo_category: string | null; processed: boolean | null }>('article_titles', {
    columns: 'id,title,silo_category,processed',
    filters: [['id', 'eq', job.title_id]],
    limit: 1,
  });
  const titleRow = rows[0];
  if (!titleRow) throw new NonRetryableError('title_missing');
  if (titleRow.processed && !o.shadow) throw new NonRetryableError('title_processed');
  const silo = titleRow.silo_category ?? null;
  const neighbours = await fetchSiloNeighbors(db, silo, titleRow.id);
  const { serviceIndex, quoteIndex } = await rotationIndices(db);
  const prompt = renderGeneratePrompt({ title: titleRow.title, siloCategory: silo, relatedArticles: formatSiloArticlesForPrompt(neighbours), serviceIndex, quoteIndex });
  const result = await p5.textLlm.anthropic({
    model: o.model,
    maxTokens: GENERATE_MAX_TOKENS,
    userText: prompt,
    timeoutMs: GENERATE_TIMEOUT_MS,
    gatewayTimeoutMs: GENERATE_GATEWAY_TIMEOUT_MS,
    meta: { agent: AGENT, run_id: o.runId, tenant_id: o.tenant, step: 'generate-en', prompt: GENERATE_PROMPT_ID },
  });
  if (!result.ok) throw new Error(`llm_${result.code}`);
  const article = parseMasterArticle(result.text, titleRow.title);
  return {
    title_id: titleRow.id,
    title: titleRow.title,
    silo_category: silo,
    slug: generateSlug(titleRow.title),
    content: article.content,
    excerpt: article.excerpt,
    meta_title: article.metaTitle,
    meta_description: article.metaDescription,
    words: article.words,
    model: result.model,
    usage: result.usage,
    silo_neighbors_used: neighbours.length,
  };
}

/** publish-en: insert the English article (a new translation_id); 23505 on (slug, language) -> the existing row. */
async function publishEnglish(db: Ports['db'], g: Generated): Promise<{ article_id: string; translation_id: string; slug: string; existed: boolean }> {
  const translationId = crypto.randomUUID();
  try {
    const rows = await db.insert<{ id: string; translation_id: string; slug: string }>(
      'articles',
      {
        title: g.title,
        slug: g.slug,
        content: g.content,
        excerpt: g.excerpt,
        language: 'en',
        status: 'published',
        meta_title: g.meta_title,
        meta_description: g.meta_description,
        translation_id: translationId,
      },
      { returning: 'id,translation_id,slug' },
    );
    const row = rows[0];
    if (!row) throw new Error('article insert returned no row');
    return { article_id: row.id, translation_id: row.translation_id ?? translationId, slug: row.slug ?? g.slug, existed: false };
  } catch (e) {
    if (!(e instanceof DbError && e.code === '23505')) throw e;
    const existing = await db.select<{ id: string; translation_id: string | null; slug: string }>('articles', {
      columns: 'id,translation_id,slug',
      filters: [['slug', 'eq', g.slug], ['language', 'eq', 'en']],
      limit: 1,
    });
    const row = existing[0];
    if (!row || !row.translation_id) throw e;
    return { article_id: row.id, translation_id: row.translation_id, slug: row.slug, existed: true };
  }
}
