// Background directory scans on the queue "scrapes" (envelope DirectoryScanMessage; the Phase 2 ScrapeMessage and
// its consumer stay unchanged). sendDirectoryScan is the only typed send of this envelope (size checked as
// enqueueScrape does); src/index.ts routes a batch whose every message is a DirectoryScanMessage here.
//
// Rules
//   - The producer opens the agent_runs row first (agent 'growth.scrapers', idempotency key
//     'directory-scan:<scan request uuid>') and sends its id as run_id; the consumer works on that row.
//   - Per message: a body that is not a valid v1 envelope (url string, source europages|wlw, max_pages 1..10,
//     enrich_profiles boolean, saved_search_id uuid when present, run_id uuid) runs nothing and is retried, so it
//     ends in scrapes-dlq for inspection; a missing run row is retried the same way; a run that is already final
//     is acknowledged without work (redelivery).
//   - Flag agent.growth.scrapers off -> the run closes 'skipped' (error 'flag_off'); a URL outside the directory
//     hosts -> 'failed' ('url_not_allowed'); both acknowledged.
//   - The scan runs through the scraper module (robots gate, crawler identity, page delays, host pause); companies
//     are upserted, scan_logs written, the saved search marked. Outcome: robots refusal -> 'skipped'
//     ('robots_disallowed'); host paused -> 'failed' ('host_blocked'); otherwise 'succeeded'. Acknowledged.
//   - A thrown error: retry({delaySeconds: 300}); after max_retries (3) the run is closed 'failed' and the message
//     goes to scrapes-dlq.
//   - One log line per delivery: source, pages, found, stored, outcome, run_id, attempts (never URLs' queries or
//     company data).

import { directoryTargetAllowed } from '../../../shared/src/auth/scrape-rules';
import { formatLogLine, logLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { EMPTY_USAGE, closeRun, isFinal } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { scraperBrowser } from '../scrapers/browser';
import { MAX_PAGES, scraperDeps, type ScraperDeps } from '../scrapers/context';
import { runDirectoryJob } from '../scrapers/service';
import { MAX_MESSAGE_BYTES, isDirectoryScanMessage, type DirectoryScanMessage, type ScrapeMessage } from './messages';
import { MAX_RETRIES, RETRY_DELAY_SECONDS } from './scrapes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendDirectoryScan(env: OpsEnv, m: Omit<DirectoryScanMessage, 'v' | 'kind' | 'enqueued_at'>): Promise<void> {
  const message: DirectoryScanMessage = { v: 1, kind: 'directory-scan', params: m.params, run_id: m.run_id, enqueued_at: new Date().toISOString(), requested_by: m.requested_by };
  const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  if (size > MAX_MESSAGE_BYTES) throw new Error(`scrapes message too large: ${size} bytes`);
  // The queue binding is typed with the Phase 2 envelope; this is the one place a directory-scan envelope is sent.
  await env.SCRAPES.send(message as unknown as ScrapeMessage, { contentType: 'json' });
  logLine(LOG_PREFIX, 'scrapes enqueued', { kind: 'directory-scan', run_id: message.run_id, requested_by: m.requested_by });
}

/** Why a body is not a valid directory-scan message, or null. */
export function invalidDirectoryScanReason(body: unknown): string | null {
  if (!isDirectoryScanMessage(body)) return 'not a directory-scan envelope';
  const p = body.params as unknown as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null) return 'params not an object';
  if (typeof p.url !== 'string' || p.url.length > 2048) return 'invalid url';
  if (p.source !== 'europages' && p.source !== 'wlw') return 'invalid source';
  if (typeof p.max_pages !== 'number' || !Number.isInteger(p.max_pages) || p.max_pages < 1 || p.max_pages > MAX_PAGES) return 'invalid max_pages';
  if (typeof p.enrich_profiles !== 'boolean') return 'invalid enrich_profiles';
  if (p.saved_search_id !== undefined && (typeof p.saved_search_id !== 'string' || !UUID_RE.test(p.saved_search_id))) return 'invalid saved_search_id';
  if (typeof body.run_id !== 'string' || !UUID_RE.test(body.run_id)) return 'invalid run_id';
  return null;
}

export interface DirectoryScanConsumerDeps {
  ports: (env: OpsEnv) => Ports;
  scraper: (env: OpsEnv, ports: Ports) => ScraperDeps;
  now: () => Date;
}

const defaultConsumerDeps: DirectoryScanConsumerDeps = {
  ports: (env) => makePorts(env, { browser: scraperBrowser(env) ?? undefined }),
  scraper: (env, ports) => scraperDeps(env, { db: ports.db }),
  now: () => new Date(),
};

const ZERO = () => ({ ...EMPTY_USAGE, by_step: {} });

async function processMessage(message: Message<unknown>, env: OpsEnv, deps: DirectoryScanConsumerDeps): Promise<void> {
  const invalid = invalidDirectoryScanReason(message.body);
  if (invalid !== null) {
    console.error(formatLogLine(LOG_PREFIX, 'directory-scan rejected message', { id: message.id, reason: invalid, attempts: message.attempts }));
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }
  const body = message.body as DirectoryScanMessage;
  const p = body.params;
  const tail = { run_id: body.run_id, attempts: message.attempts };
  const ports = deps.ports(env);
  try {
    const run = await getRun(ports.db, body.run_id);
    if (!run) {
      console.error(formatLogLine(LOG_PREFIX, 'directory-scan run missing', tail));
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      return;
    }
    if (isFinal(run.status)) {
      logLine(LOG_PREFIX, 'directory-scan', { source: p.source, ...tail, outcome: 'ack', note: 'already_final' });
      message.ack();
      return;
    }
    const flag = await readFlag(env, 'agent.growth.scrapers');
    if (!flag.enabled) {
      await closeRun(ports.db, body.run_id, { status: 'skipped', error: 'flag_off', output: { source: p.source } }, ZERO());
      logLine(LOG_PREFIX, 'directory-scan', { source: p.source, ...tail, outcome: 'ack', note: 'flag_off' });
      message.ack();
      return;
    }
    if (!directoryTargetAllowed(p.url)) {
      await closeRun(ports.db, body.run_id, { status: 'failed', error: 'url_not_allowed', output: { source: p.source } }, ZERO());
      message.ack();
      return;
    }
    const scraper = deps.scraper(env, ports);
    const job = await runDirectoryJob(scraper, ports.db, { url: p.url, source: p.source, maxPages: p.max_pages, enrichProfiles: p.enrich_profiles, savedSearchId: p.saved_search_id }, deps.now);
    const r = job.result;
    const output: Record<string, unknown> = {
      source: p.source,
      pages: r.pages,
      companies_found: r.companies.length,
      stored: job.stored,
      enriched: job.enriched,
      stopped: r.stopped,
      robots: r.robots?.reason ?? null,
      errors: r.errors.length,
    };
    if (r.robots?.permission) output.permission = r.robots.permission;
    const outcome = r.stopped === 'robots' && r.pages === 0
      ? { status: 'skipped' as const, error: 'robots_disallowed' }
      : r.paused ? { status: 'failed' as const, error: 'host_blocked' } : { status: 'succeeded' as const };
    await closeRun(ports.db, body.run_id, { ...outcome, output }, ZERO());
    logLine(LOG_PREFIX, 'directory-scan', { source: p.source, pages: r.pages, found: r.companies.length, stored: job.stored, status: outcome.status, ...tail, outcome: 'ack' });
    message.ack();
  } catch (error) {
    const last = message.attempts > MAX_RETRIES;
    logLine(LOG_PREFIX, 'directory-scan', { source: p.source, status: 'threw', error: error instanceof Error ? error.name : typeof error, ...tail, outcome: last ? 'dead-letter' : 'retry' });
    if (last) {
      await closeRun(ports.db, body.run_id, { status: 'failed', error: 'consumer_failed' }, ZERO()).catch(() => {});
    }
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
  }
}

export async function directoryScanConsumer(
  batch: MessageBatch<DirectoryScanMessage>,
  env: OpsEnv,
  _ctx: ExecutionContext,
  deps: DirectoryScanConsumerDeps = defaultConsumerDeps,
): Promise<void> {
  for (const message of batch.messages) await processMessage(message as Message<unknown>, env, deps);
}
