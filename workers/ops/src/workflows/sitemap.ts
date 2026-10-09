// SitemapWorkflow ('sitemap', instance sitemap-<YYYY-MM-DD>): builds sitemap-complete.xml as the deployed generator
// (version 19) does and writes it to the Supabase Storage object the site serves (sitemaps/sitemap-complete.xml),
// with a shadow copy in R2 microns-private sitemaps/sitemap-complete.xml; then upserts every article URL into
// gsc_monitored_urls. Started by content-daily (parent_run_id) or, in switch-over stage S4, by the schedule.
//
//   open-run              agent_runs content_daily.sitemap, key content_daily.sitemap:<date>; a final run exits
//   flag                  agent.content_daily off -> 'skipped' (flag_off)
//   build-upload          published articles (pages of 1,000, live order), XML; regression guard against the last
//                         succeeded run (urls < 252 + 0.95 x its articles -> no upload, text alert, run 'failed');
//                         assist/auto: Storage upload (upsert, application/xml, cache 3600) + R2 copy with
//                         {sha256, urls, generated_at}; shadow: R2 phase5-shadow/sitemaps/<date>/ only
//   sync-monitored-urls   assist/auto: gsc_monitored_urls upsert on url in chunks of 500
//   close-run             {urls, articles, bytes, sha256, uploaded, shadow_key, monitored_urls}
// Rules
//   - The XML never leaves build-upload (6 MB against the 1 MiB step-result limit); a retry rebuilds it.
//   - Side-effecting steps re-read the flag; a switched-off flag stops the run ('skipped', flag_off).
//   - A failed upload is retried by the step (5 retries), then the run closes 'failed' with one text alert; the
//     served object stays as it was.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { closeRun, EMPTY_USAGE, isFinal, openRun } from '../agents/runs';
import { CONTENT_FLAG, errorCode, isDay, mustHalt, snapshotFlag, tenantOf } from '../content/flag';
import { exactBuffer, selectAll } from '../content/paged';
import { buildSitemapXml, monitoredUrlRows, SITEMAP_ARTICLE_COLUMNS, sortLikeLive, STATIC_URL_COUNT, type SitemapArticle } from '../content/sitemap-xml';
import { LOG_PREFIX, type OpsEnv, type SitemapParams } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import { DB, NOTIFY } from './steps';

const AGENT = 'content_daily.sitemap' as const;
export const SITEMAP_OBJECT = 'sitemap-complete.xml' as const;
export const SITEMAP_R2_KEY = 'sitemaps/sitemap-complete.xml';
export const MONITORED_CHUNK = 500;
/** Build and upload of a 6 MB document. */
export const BUILD_UPLOAD_STEP: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' };
export const SYNC_STEP: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' };

export interface SitemapDeps {
  env: OpsEnv;
  ports: Ports;
  p5: P5Ports;
  step: WorkflowStep;
}

export interface SitemapResult {
  outcome: 'exists' | 'flag_off' | 'succeeded' | 'regression' | 'failed';
  run_id: string;
  failed_step?: string;
}

export const sitemapAlerts = {
  regression: (date: string, urls: number, min: number) =>
    `Sitemap ${date}: ${urls} URLs, expected at least ${min}; not uploaded (the served sitemap is unchanged).`,
  failed: (date: string, step: string, code: string) => `Sitemap ${date}: run failed at step ${step} (${code}).`,
};

export class SitemapWorkflow extends WorkflowEntrypoint<OpsEnv, SitemapParams> {
  async run(event: Readonly<WorkflowEvent<SitemapParams>>, step: WorkflowStep): Promise<unknown> {
    return runSitemap(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), p5: makeP5Ports(this.env), step });
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function publishedArticles(db: Ports['db']): Promise<SitemapArticle[]> {
  const rows = await selectAll<SitemapArticle & { id: string }>(db, 'articles', { columns: SITEMAP_ARTICLE_COLUMNS, filters: [['status', 'eq', 'published']] });
  return sortLikeLive(rows);
}

export async function runSitemap(p: SitemapParams, instanceId: string, d: SitemapDeps): Promise<SitemapResult> {
  if (!p || !isDay(p.date)) throw new NonRetryableError('invalid_params');
  const { env, ports, p5, step } = d;
  const db = ports.db;
  const date = p.date;
  const acc = { ...EMPTY_USAGE, by_step: {} };
  let current = 'open-run';
  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
    current = name;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };

  const opened = await run('open-run', DB, () =>
    openRun(db, {
      agent: AGENT,
      trigger: p.parent_run_id ? 'workflow' : 'cron',
      idempotency_key: `${AGENT}:${date}`,
      workflow_name: 'sitemap',
      workflow_instance_id: instanceId,
      ...(p.parent_run_id ? { parent_run_id: p.parent_run_id } : {}),
      tenant_id: tenantOf(env),
    }),
  );
  const runId = opened.run_id;
  if (!opened.created && isFinal(opened.status)) return { outcome: 'exists', run_id: runId };

  let shadow = false;
  try {
    const flag = await run('flag', DB, async () => snapshotFlag(await readFlag(env, CONTENT_FLAG)));
    if (!flag.enabled) {
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { reason: 'flag_off' } }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }
    const mode = flag.mode;
    shadow = mode === 'shadow';

    const built = await run('build-upload', BUILD_UPLOAD_STEP, async () => {
      if (mustHalt(mode, snapshotFlag(await readFlag(env, CONTENT_FLAG)))) return null;
      const articles = await publishedArticles(db);
      const today = ports.clock.now().toISOString().split('T')[0];
      const build = buildSitemapXml(articles, { siteUrl: env.SITE_ORIGIN.replace(/\/+$/, ''), today });
      const bytes = new TextEncoder().encode(build.xml);
      const sha256 = await sha256Hex(bytes);
      const generated_at = ports.clock.now().toISOString();
      const summary = { urls: build.urls, articles: build.articles, bytes: bytes.length, sha256 };

      const previous = await db.select<{ id: string; output: Record<string, unknown> | null }>('agent_runs', {
        columns: 'id,output',
        filters: [['agent', 'eq', AGENT], ['status', 'eq', 'succeeded']],
        order: [{ column: 'started_at', ascending: false }],
        limit: 2,
      });
      const prev = previous.find((r) => r.id !== runId);
      const prevArticles = typeof prev?.output?.articles === 'number' ? (prev.output.articles as number) : null;
      if (prevArticles !== null) {
        const min = Math.ceil(STATIC_URL_COUNT + 0.95 * prevArticles);
        if (build.urls < min) return { ...summary, regression: true as const, min, uploaded: false, shadow_key: null as string | null };
      }

      if (shadow) {
        const key = `phase5-shadow/sitemaps/${date}/${SITEMAP_OBJECT}`;
        await ports.blob.put(key, exactBuffer(bytes), { contentType: 'application/xml', sha256, meta: { urls: String(build.urls), generated_at } });
        return { ...summary, regression: false as const, min: null, uploaded: false, shadow_key: key };
      }
      const up = await p5.storage.upload(SITEMAP_OBJECT, build.xml, { contentType: 'application/xml', cacheControl: '3600' });
      if (!up.ok) throw new Error(`upload_failed ${up.status}`);
      await ports.blob.put(SITEMAP_R2_KEY, exactBuffer(bytes), { contentType: 'application/xml', sha256, meta: { urls: String(build.urls), generated_at } });
      return { ...summary, regression: false as const, min: null, uploaded: true, shadow_key: SITEMAP_R2_KEY };
    });
    if (!built) {
      await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { reason: 'flag_off', halted_at: 'build-upload' } }, acc));
      return { outcome: 'flag_off', run_id: runId };
    }
    const output: Record<string, unknown> = { urls: built.urls, articles: built.articles, bytes: built.bytes, sha256: built.sha256, uploaded: built.uploaded, shadow_key: built.shadow_key };
    if (shadow) output.shadow = true;

    if (built.regression) {
      if (!shadow) {
        await run('alert-regression', NOTIFY, async () => {
          await p5.telegramText.send(sitemapAlerts.regression(date, built.urls, built.min ?? 0));
          return true;
        });
      }
      await run('close-run', DB, () => closeRun(db, runId, { status: 'failed', error: 'sitemap_regression', output: { ...output, min_urls: built.min } }, acc));
      return { outcome: 'regression', run_id: runId };
    }

    if (!shadow) {
      const synced = await run('sync-monitored-urls', SYNC_STEP, async () => {
        if (mustHalt(mode, snapshotFlag(await readFlag(env, CONTENT_FLAG)))) return null;
        const rows = monitoredUrlRows(await publishedArticles(db), env.SITE_ORIGIN.replace(/\/+$/, ''));
        for (let i = 0; i < rows.length; i += MONITORED_CHUNK) {
          await db.insert('gsc_monitored_urls', rows.slice(i, i + MONITORED_CHUNK), { onConflict: ['url'], ignoreDuplicates: false });
        }
        return { upserted: rows.length };
      });
      if (!synced) {
        await run('close-run', DB, () => closeRun(db, runId, { status: 'skipped', output: { ...output, reason: 'flag_off', halted_at: 'sync-monitored-urls' } }, acc));
        return { outcome: 'flag_off', run_id: runId };
      }
      output.monitored_urls = synced.upserted;
    }

    await run('close-run', DB, () => closeRun(db, runId, { status: 'succeeded', output }, acc));
    console.log(formatLogLine(LOG_PREFIX, 'sitemap done', { date, urls: built.urls, uploaded: built.uploaded }));
    return { outcome: 'succeeded', run_id: runId };
  } catch (e) {
    const failedStep = current;
    const code = errorCode(e);
    console.error(formatLogLine(LOG_PREFIX, 'sitemap failed', { date, step: failedStep, code }));
    await run('close-failed', DB, () => closeRun(db, runId, { status: 'failed', error: `${failedStep}: ${code}`, output: shadow ? { shadow: true } : undefined }, acc));
    if (!shadow) {
      await run('alert-failed', NOTIFY, async () => {
        await p5.telegramText.send(sitemapAlerts.failed(date, failedStep, code));
        return true;
      });
    }
    return { outcome: 'failed', run_id: runId, failed_step: failedStep };
  }
}
