// Consumer of the queue "scrapes". Each message runs the same Vercel handler as the synchronous route, through the
// shared shim, with a synthetic `POST /api/<function>` request whose JSON body is the message params. There is no
// second implementation of a scan.
//
// Rules
//   - Handler answer 2xx or 4xx (any status below 500): ack(). The scan ran, or the job can never succeed.
//   - Handler answer 5xx (incl. the shim's 504 after 840,000 ms), a thrown error or a module that fails to load:
//     retry({delaySeconds: 300}). After max_retries (3, wrangler.jsonc) the platform moves the message to
//     scrapes-dlq.
//   - A message that is not a valid v1 ScrapeMessage of a known kind runs no handler and is retried the same way,
//     so it ends in scrapes-dlq for inspection instead of being dropped.
//   - One log line per delivery: `[microns-ops] scrapes <kind> <params summary> status=<n> <counts> run_id=<uuid>
//     attempts=<n> outcome=<ack|retry|dead-letter>`; counts come from the handler's JSON body when present.

import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { formatLogLine, logLine } from '../../../shared/src/http/log';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { ScrapeMessage } from './messages';

/** Deadline of one consumer run: under the 15-minute consumer wall-time limit. */
export const CONSUMER_TIMEOUT_MS = 840_000;
/** Delay before a failed scan is delivered again. */
export const RETRY_DELAY_SECONDS = 300;
/** Must equal queues.consumers[0].max_retries in wrangler.jsonc (a config test checks it). */
export const MAX_RETRIES = 3;

/** Function path each kind runs (the handler's own route). */
export const SCRAPE_FUNCTION_PATHS: Readonly<Record<ScrapeMessage['kind'], string>> = {
  'tender-scan': '/api/tender-scan',
  'funded-scan': '/api/funded-startups',
};

// The synthetic request never leaves the isolate; the host only gives the handler an absolute URL.
const SYNTHETIC_ORIGIN = 'https://microns-ops.internal';

type HandlerLoaders = Record<ScrapeMessage['kind'], () => Promise<{ default: VercelHandler }>>;
type Fields = Record<string, string | number | boolean | undefined>;

function isKind(value: unknown): value is ScrapeMessage['kind'] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCRAPE_FUNCTION_PATHS, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why a message body is not a valid v1 ScrapeMessage, or null when it is. */
export function invalidMessageReason(body: unknown): string | null {
  if (!isPlainObject(body)) return 'not an object';
  if (body.v !== 1) return 'unsupported version';
  if (!isKind(body.kind)) return 'unknown kind';
  if (!isPlainObject(body.params)) return 'params not an object';
  if (typeof body.run_id !== 'string' || body.run_id === '') return 'missing run_id';
  return null;
}

function scalar(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,32}$/.test(value)) return value;
  return undefined;
}

function runIdField(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : 'invalid';
}

function paramsSummary(kind: ScrapeMessage['kind'], params: Record<string, unknown>): Fields {
  return kind === 'tender-scan' ? { country_code: scalar(params.country_code) } : { priority: scalar(params.priority) };
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function resultCounts(kind: ScrapeMessage['kind'], response: Response): Promise<Fields> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return {};
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {};
  }
  if (!isPlainObject(data)) return {};
  if (kind === 'tender-scan') {
    return {
      found: count(data.tenders_found),
      new: count(data.tenders_new),
      relevant: count(data.tenders_relevant),
      errors: Array.isArray(data.errors) ? data.errors.length : undefined,
    };
  }
  return {
    feeds: count(data.feeds_scanned),
    articles: count(data.articles_found),
    relevant: count(data.articles_relevant),
    new: count(data.startups_new),
  };
}

function retryOutcome(message: Message<unknown>): 'retry' | 'dead-letter' {
  // attempts counts deliveries from 1; the delivery after the last retry is the final one.
  return message.attempts > MAX_RETRIES ? 'dead-letter' : 'retry';
}

async function processMessage(message: Message<unknown>, handlers: HandlerLoaders, ctx: ExecutionContext): Promise<void> {
  const body = message.body;
  const invalid = invalidMessageReason(body);
  if (invalid !== null) {
    const outcome = retryOutcome(message);
    console.error(formatLogLine(LOG_PREFIX, 'scrapes rejected message', { id: message.id, reason: invalid, attempts: message.attempts, outcome }));
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }
  const job = body as ScrapeMessage;
  const functionPath = SCRAPE_FUNCTION_PATHS[job.kind];
  const base: Fields = { ...paramsSummary(job.kind, job.params) };
  const tail: Fields = { run_id: runIdField(job.run_id), attempts: message.attempts };

  let response: Response;
  try {
    const { default: handler } = await handlers[job.kind]();
    const request = new Request(`${SYNTHETIC_ORIGIN}${functionPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    response = await runNodeHandler(handler, {
      request,
      functionUrl: functionPath,
      body: new TextEncoder().encode(JSON.stringify(job.params)),
      ctx,
      timeoutMs: CONSUMER_TIMEOUT_MS,
      logPrefix: LOG_PREFIX,
    });
  } catch (error) {
    const outcome = retryOutcome(message);
    const name = error instanceof Error ? error.name : typeof error;
    logLine(LOG_PREFIX, `scrapes ${job.kind}`, { ...base, status: 'threw', error: name, ...tail, outcome });
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }

  const counts = await resultCounts(job.kind, response.clone());
  if (response.status < 500) {
    logLine(LOG_PREFIX, `scrapes ${job.kind}`, { ...base, status: response.status, ...counts, ...tail, outcome: 'ack' });
    message.ack();
    return;
  }
  const outcome = retryOutcome(message);
  logLine(LOG_PREFIX, `scrapes ${job.kind}`, { ...base, status: response.status, ...counts, ...tail, outcome });
  message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
}

export function createScrapesConsumer(
  handlers: Record<ScrapeMessage['kind'], () => Promise<{ default: VercelHandler }>>,
): (batch: MessageBatch<ScrapeMessage>, env: OpsEnv, ctx: ExecutionContext) => Promise<void> {
  return async (batch, _env, ctx) => {
    // One scan at a time per batch (max_batch_size is 1); each message is acked or retried on its own.
    for (const message of batch.messages) await processMessage(message as Message<unknown>, handlers, ctx);
  };
}

/** tender-scan -> api/tender-scan.js, funded-scan -> api/funded-startups.js (lazy, as the routes). */
export const scrapesConsumer: ReturnType<typeof createScrapesConsumer> = createScrapesConsumer({
  'tender-scan': () => import('../../../../api/tender-scan.js'),
  'funded-scan': () => import('../../../../api/funded-startups.js'),
});
