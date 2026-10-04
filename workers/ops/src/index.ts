// microns-ops entry module.
//
//   OpsApi (named entrypoint)  RPC target of the site's service binding OPS: handle(request, call)
//   default export             fetch answers 404 (no public surface: workers_dev and preview_urls are off and
//                              there are no routes); queue consumes "scrapes"
//
// Rules for handle()
//   - The call must be a version 1 OpsCall with a function URL that is a path ("/…"), a known principal class and
//     string endpoint, action and requestId; anything else answers 500 text/plain. A breaking change of the call
//     shape adds a new version number, and this Worker accepts both versions for one release.
//   - The principal is taken from the call only; no request header can supply or change it.
//   - The request is re-addressed to the function URL (so the app routes on the function path, rewrite merged)
//     and its call is registered for the app's middleware.

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { OpsApiRpc, OpsCall, PrincipalClass } from '../../shared/src/http/rpc';
import { textResponse } from '../../shared/src/http/json';
import { formatLogLine } from '../../shared/src/http/log';
import { app, registerCall } from './app';
import { LOG_PREFIX, type OpsEnv } from './env';
import type { ScrapeMessage } from './queues/messages';
import { scrapesConsumer } from './queues/scrapes';

const PRINCIPAL_CLASSES: ReadonlySet<PrincipalClass> = new Set(['ANON', 'CUSTOMER', 'PARTNER', 'STAFF', 'ADMIN', 'MACHINE']);

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

export default {
  fetch: () => new Response(null, { status: 404 }),
  queue: scrapesConsumer,
} satisfies ExportedHandler<OpsEnv, ScrapeMessage>;
