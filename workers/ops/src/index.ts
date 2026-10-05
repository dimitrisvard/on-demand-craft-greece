// microns-ops entry module.
//
//   OpsApi (named entrypoint)      RPC target of the site's service binding OPS: handle(request, call)
//   MailIngest (named entrypoint)  RPC target of the mail Worker's service binding OPS (Phase 4)
//   Workflows                      RfqIntakeWorkflow, QuoteWorkflow, PostOrderWorkflow (Phase 4)
//   Durable Objects                RfqThread, MaterialStock, CadRouter (Phase 4, migration tag v1)
//   default export                 fetch: the MCP host (MCP_HOSTNAME) -> remote MCP; every other request, and a call
//                                  without arguments, answers 404 with no body. queue: dispatch by queue name and
//                                  message envelope. scheduled: dispatch by cron expression.
//
// Rules for handle()
//   - The call must be a version 1 OpsCall with a function URL that is a path ("/…"), a known principal class and
//     string endpoint, action and requestId; anything else answers 500 text/plain. A breaking change of the call
//     shape adds a new version number, and this Worker accepts both versions for one release.
//   - The principal is taken from the call only; no request header can supply or change it.
//   - The request is re-addressed to the function URL (so the app routes on the function path, rewrite merged)
//     and its call is registered for the app's middleware.
//
// Rules for queue()
//   - "cad-jobs" -> cadJobsConsumer; "agent-events" -> agentEventsConsumer.
//   - "scrapes" (and any other queue): a non-empty batch whose every message is a DirectoryScanMessage ->
//     directoryScanConsumer; otherwise the Phase 2 scrapesConsumer, unchanged (batches hold one message).
//
// Rules for scheduled()
//   - '* * * * *' -> flagsSyncTick; the 10-minute cron -> dispatcherTick. Each job runs in ctx.waitUntil and a
//     failure is logged with the job name; one job never stops another. An unknown expression is logged only.

import { WorkerEntrypoint } from 'cloudflare:workers';
import { describeError } from '../../shared/src/compat/vercel-node';
import type { OpsApiRpc, OpsCall, PrincipalClass } from '../../shared/src/http/rpc';
import { textResponse } from '../../shared/src/http/json';
import { formatLogLine } from '../../shared/src/http/log';
import { app, registerCall } from './app';
import { dispatcherTick } from './cron/dispatcher';
import { flagsSyncTick } from './cron/flags-sync';
import { LOG_PREFIX, type OpsEnv } from './env';
import { handleMcp } from './mcp/index';
import { agentEventsConsumer } from './queues/agent-events';
import { cadJobsConsumer } from './queues/cad-jobs';
import { directoryScanConsumer } from './queues/directory-scan';
import { isDirectoryScanMessage, type AgentEventV1, type CadJobMessageV1, type DirectoryScanMessage, type ScrapeMessage } from './queues/messages';
import { scrapesConsumer } from './queues/scrapes';

export { MailIngest } from './entrypoints/mail-ingest';
export { RfqIntakeWorkflow } from './workflows/rfq-intake';
export { QuoteWorkflow } from './workflows/quote';
export { PostOrderWorkflow } from './workflows/post-order';
export { RfqThread } from './do/rfq-thread';
export { MaterialStock } from './do/material-stock';
export { CadRouter } from './do/cad-router';

const PRINCIPAL_CLASSES: ReadonlySet<PrincipalClass> = new Set(['ANON', 'CUSTOMER', 'PARTNER', 'STAFF', 'ADMIN', 'MACHINE']);

// Cron expressions of wrangler.jsonc triggers.crons. Not exported: the runtime accepts only classes, functions and
// handler objects as named exports of the entry module.
const CRON_EVERY_MINUTE = '* * * * *';
const CRON_EVERY_10_MINUTES = '*/10 * * * *';

/** Why `call` is not an acceptable OpsCall, or null when it is. */
export function invalidCallReason(call: unknown): string | null {
  if (typeof call !== 'object' || call === null) return 'missing call';
  const c = call as Partial<Record<keyof OpsCall, unknown>>;
  if (c.v !== 1) return 'unsupported call version';
  if (typeof c.functionUrl !== 'string' || !c.functionUrl.startsWith('/') || c.functionUrl.startsWith('//')) return 'invalid functionUrl';
  if (typeof c.endpoint !== 'string' || typeof c.action !== 'string' || typeof c.requestId !== 'string') return 'invalid call fields';
  const principal = c.principal as { class?: unknown } | null | undefined;
  if (typeof principal !== 'object' || principal === null || !PRINCIPAL_CLASSES.has(principal.class as PrincipalClass)) return 'invalid principal';
  return null;
}

export class OpsApi extends WorkerEntrypoint<OpsEnv> implements OpsApiRpc {
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  }

  async handle(request: Request, call: OpsCall): Promise<Response> {
    const invalid = invalidCallReason(call);
    if (invalid !== null) {
      console.error(formatLogLine(LOG_PREFIX, 'rpc call rejected', { reason: invalid }));
      return textResponse(500, 'Internal Server Error');
    }
    const inner = new Request(new URL(call.functionUrl, request.url), request);
    registerCall(inner, call);
    return app.fetch(inner, this.env, this.ctx);
  }
}

/** True when the request is addressed to the remote MCP host. */
function isMcpRequest(req: Request, env: OpsEnv): boolean {
  if (!env.MCP_HOSTNAME) return false;
  let hostname: string;
  try {
    hostname = new URL(req.url).hostname;
  } catch {
    return false;
  }
  return hostname === env.MCP_HOSTNAME;
}

/** Runs one scheduled job; a failure is logged with the job name and never rethrown. */
async function runJob(job: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(formatLogLine(LOG_PREFIX, 'cron job failed', { job }), describeError(error));
  }
}

async function fetchHandler(req?: Request, env?: OpsEnv, ctx?: ExecutionContext): Promise<Response> {
  if (req && env && ctx && isMcpRequest(req, env)) return handleMcp(req, env, ctx);
  return new Response(null, { status: 404 });
}

async function queueHandler(batch: MessageBatch<unknown>, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
  switch (batch.queue) {
    case 'cad-jobs':
      return cadJobsConsumer(batch as MessageBatch<CadJobMessageV1>, env, ctx);
    case 'agent-events':
      return agentEventsConsumer(batch as MessageBatch<AgentEventV1>, env, ctx);
    default:
      if (batch.messages.length > 0 && batch.messages.every((message) => isDirectoryScanMessage(message.body))) {
        return directoryScanConsumer(batch as MessageBatch<DirectoryScanMessage>, env, ctx);
      }
      return scrapesConsumer(batch as MessageBatch<ScrapeMessage>, env, ctx);
  }
}

async function scheduledHandler(controller: ScheduledController, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
  switch (controller.cron) {
    case CRON_EVERY_MINUTE:
      ctx.waitUntil(runJob('flags-sync', () => flagsSyncTick(env, controller)));
      return;
    case CRON_EVERY_10_MINUTES:
      ctx.waitUntil(runJob('dispatcher', () => dispatcherTick(env, controller)));
      return;
    default:
      console.error(formatLogLine(LOG_PREFIX, 'cron without a handler', { cron: controller.cron }));
  }
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
  scheduled: scheduledHandler,
} satisfies ExportedHandler<OpsEnv>;
