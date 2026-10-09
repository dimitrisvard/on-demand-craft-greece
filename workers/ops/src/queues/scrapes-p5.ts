// Consumer of the Phase 5 envelope on the queue "scrapes" (P5ScrapeMessage): the scheduled collectors and the
// Xometry scan. src/queues/scrapes.ts (Phase 2) stays unchanged; src/index.ts routes a scrapes message here when its
// kind is one of P5_SCRAPE_KINDS.
//
// Rules
//   - Kind table (fixed import paths and names): reddit-tier -> handleRedditTier, hn-scan -> handleHnScan,
//     tender-scheduled -> handleTenderScheduled, xometry-scan -> handleXometryScan. Each handler acks or retries
//     its own message; messages of a batch are handled one after another.
//   - A body that is not a valid P5ScrapeMessage is logged (message id only) and acked (it can never succeed).
//   - A handler that throws instead of settling its message: reddit-tier, hn-scan and xometry-scan close their run
//     'failed' with error 'handler_error' when it is still 'running' and ack (the next slot is the retry);
//     tender-scheduled retries after 300 s (its handler's own rule for a throw).
//   - sendP5Scrape is the typed send on env.SCRAPES: v 1, enqueued_at now, requested_by 'schedule' unless given;
//     params are checked against the kind and the JSON body stays under MAX_MESSAGE_BYTES, else it throws before
//     sending.
//   - Log lines carry kind, run id and message id only, never params or bodies.

import { formatLogLine, logLine } from '../../../shared/src/http/log';
import { closeRun, EMPTY_USAGE } from '../agents/runs';
import { handleHnScan } from '../collectors/hn';
import { handleRedditTier } from '../collectors/reddit';
import { handleTenderScheduled } from '../collectors/tenders';
import { getRun } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';
import type { P5Ports } from '../ports/p5';
import { handleXometryScan } from '../xometry/queue';
import { isP5ScrapeMessage, MAX_MESSAGE_BYTES, type P5ScrapeKind, type P5ScrapeMessage } from './messages';

/** Handles one message; the handler acks or retries it. */
export type P5ScrapeHandler = (
  msg: Message<P5ScrapeMessage>,
  env: OpsEnv,
  ctx: ExecutionContext,
  deps?: { ports?: Ports; p5?: P5Ports },
) => Promise<void>;

/** The kind table. */
export const P5_SCRAPE_HANDLERS: Readonly<Record<P5ScrapeKind, P5ScrapeHandler>> = Object.freeze({
  'reddit-tier': handleRedditTier,
  'hn-scan': handleHnScan,
  'tender-scheduled': handleTenderScheduled,
  'xometry-scan': handleXometryScan,
});

/** Delay of a tender-scheduled redelivery after a throw (the Phase 2 scrapes rule). */
export const TENDER_RETRY_DELAY_S = 300;

const SLOT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when params have the shape of the kind (RedditTierParams, HnScanParams, TenderScheduledParams,
 *  XometryScanParams). */
export function p5ScrapeParamsValid(kind: P5ScrapeKind, params: unknown): boolean {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const p = params as Record<string, unknown>;
  switch (kind) {
    case 'reddit-tier':
      return (p.tier === 1 || p.tier === 2 || p.tier === 3) && p.max === 40 && typeof p.slot === 'string' && SLOT.test(p.slot);
    case 'hn-scan':
    case 'xometry-scan':
      return typeof p.slot === 'string' && SLOT.test(p.slot);
    case 'tender-scheduled':
      return typeof p.country_code === 'string' && /^[A-Za-z]{2,3}$/.test(p.country_code) && typeof p.date === 'string' && DATE.test(p.date);
  }
}

/** Typed send on env.SCRAPES. */
export async function sendP5Scrape(
  env: OpsEnv,
  m: Omit<P5ScrapeMessage, 'v' | 'enqueued_at' | 'requested_by'> & { requested_by?: 'schedule' | 'manual' },
): Promise<void> {
  const message: P5ScrapeMessage = {
    v: 1,
    kind: m.kind,
    params: m.params,
    run_id: m.run_id,
    enqueued_at: new Date().toISOString(),
    requested_by: m.requested_by ?? 'schedule',
  };
  if (!isP5ScrapeMessage(message) || !p5ScrapeParamsValid(message.kind, message.params) || typeof message.run_id !== 'string' || message.run_id === '') {
    throw new Error(`invalid ${String(m.kind)} message`);
  }
  const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  if (size > MAX_MESSAGE_BYTES) throw new Error(`scrapes message too large: ${size} bytes`);
  // The binding is typed with the Phase 2 envelope; the queue carries both envelopes (routed by kind in index.ts).
  await (env.SCRAPES as unknown as Queue<P5ScrapeMessage>).send(message, { contentType: 'json' });
  logLine(LOG_PREFIX, 'scrapes enqueued', { kind: message.kind, run_id: message.run_id, requested_by: message.requested_by });
}

export interface ScrapesP5ConsumerOptions {
  /** Handler table (default P5_SCRAPE_HANDLERS). */
  handlers?: Readonly<Record<P5ScrapeKind, P5ScrapeHandler>>;
  /** Ports of the fallback close (default makePorts(env), built only when a handler throws). */
  ports?: (env: OpsEnv) => Ports;
}

/** Closes the run of a message whose handler threw, when that run is still 'running'. */
async function closeAfterThrow(ports: Ports, runId: string): Promise<void> {
  const run = await getRun(ports.db, runId);
  if (run?.status !== 'running') return;
  await closeRun(ports.db, runId, { status: 'failed', error: 'handler_error' }, { ...EMPTY_USAGE, by_step: {} });
}

/** The consumer with its handler table and fallback ports (tests pass their own). */
export function makeScrapesP5Consumer(o: ScrapesP5ConsumerOptions = {}): (batch: MessageBatch<unknown>, env: OpsEnv, ctx: ExecutionContext) => Promise<void> {
  const handlers = o.handlers ?? P5_SCRAPE_HANDLERS;
  const portsOf = o.ports ?? ((env: OpsEnv) => makePorts(env));
  return async (batch, env, ctx) => {
    for (const msg of batch.messages) {
      if (!isP5ScrapeMessage(msg.body)) {
        console.error(formatLogLine(LOG_PREFIX, 'scrapes-p5 invalid message acked', { message_id: msg.id }));
        msg.ack();
        continue;
      }
      const message = msg as Message<P5ScrapeMessage>;
      const { kind, run_id } = message.body;
      try {
        await handlers[kind](message, env, ctx);
      } catch (error) {
        const name = error instanceof Error ? error.name : 'error';
        console.error(formatLogLine(LOG_PREFIX, 'scrapes-p5 handler threw', { kind, run_id, message_id: msg.id, error: name }));
        if (kind === 'tender-scheduled') {
          message.retry({ delaySeconds: TENDER_RETRY_DELAY_S });
          continue;
        }
        try {
          await closeAfterThrow(portsOf(env), run_id);
        } catch (closeError) {
          console.error(formatLogLine(LOG_PREFIX, 'scrapes-p5 run close failed', { kind, run_id, error: closeError instanceof Error ? closeError.name : 'error' }));
        }
        message.ack();
      }
    }
  };
}

export const scrapesP5Consumer: (batch: MessageBatch<unknown>, env: OpsEnv, ctx: ExecutionContext) => Promise<void> = makeScrapesP5Consumer();
