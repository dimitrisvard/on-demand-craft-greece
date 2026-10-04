// /api/emails in microns-site: the unchanged Vercel handler api/emails.js, run through the shared @vercel/node shim
// (workers/shared/src/compat/vercel-node.ts) with a 30 s deadline.
//
// The module is imported lazily on the first /api/emails request, never at Worker startup: api/emails.js builds
// its Resend client at module scope (it throws without RESEND_API_KEY), and a module-scope failure must fail only
// this route, never the SEO paths or the other endpoints. A module whose evaluation failed is not evaluated again
// in this isolate: the cached import rejects with the same error on every later request (500), as configuration
// cannot change within an isolate (the bundler's lazy initialiser also rethrows its first error).

import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import type { Principal } from '../../../shared/src/http/rpc';
import type { Env } from '../env';
import { LOG_PREFIX } from '../env';

/** Deadline of a site-local handler, from the call to res.end(). */
export const LOCAL_TIMEOUT_MS = 30_000;

export interface LocalInput {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  /** Path + query the handler sees as req.url (rewrite merged, gate overrides applied). */
  functionUrl: string;
  /** Raw body bytes (null for GET/HEAD); the request body itself is never read. */
  body: Uint8Array | null;
  /** The verified caller; the Vercel handler itself never sees it. */
  principal: Principal;
}

export type HandlerModule = { default: VercelHandler };

/**
 * Copies these env values into process.env before a handler module is first evaluated. The runtime already fills
 * process.env from vars and secrets (nodejs_compat); the copy keeps the module-scope reads equal to `env` wherever
 * that population is not available (unit tests in Node). Values are never logged.
 */
export function syncProcessEnv(env: Env, names: readonly (keyof Env)[]): void {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) return;
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value !== '' && proc.env[name] !== value) proc.env[name] = value;
  }
}

let emailsModule: Promise<HandlerModule> | undefined;

function loadEmails(): Promise<HandlerModule> {
  emailsModule ??= import('../../../../api/emails.js') as Promise<HandlerModule>;
  return emailsModule;
}

export async function handleEmails(i: LocalInput): Promise<Response> {
  syncProcessEnv(i.env, ['RESEND_API_KEY']);
  const mod = await loadEmails();
  return runNodeHandler(mod.default, {
    request: i.request,
    functionUrl: i.functionUrl,
    body: i.body,
    ctx: i.ctx,
    timeoutMs: LOCAL_TIMEOUT_MS,
    logPrefix: LOG_PREFIX,
  });
}
