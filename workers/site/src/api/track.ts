// /api/marketing?action=track and /api/track in microns-site: the unchanged Vercel handler api/marketing.js, run
// through the shared @vercel/node shim with a 30 s deadline. Only its track branch runs here (the router sends
// every other marketing action to microns-ops), so tracking pixels, click redirects and the unsubscribe page keep
// the handler's exact bytes and headers.
//
// The module is imported lazily on the first tracking request (api/marketing.js creates its Supabase client at
// module scope); a module-scope failure fails only this route, and is not retried within the isolate (see
// ./emails.ts).

import { runNodeHandler } from '../../../shared/src/compat/vercel-node';
import { LOG_PREFIX } from '../env';
import { LOCAL_TIMEOUT_MS, syncProcessEnv, type HandlerModule, type LocalInput } from './emails';

let marketingModule: Promise<HandlerModule> | undefined;

function loadMarketing(): Promise<HandlerModule> {
  marketingModule ??= import('../../../../api/marketing.js') as Promise<HandlerModule>;
  return marketingModule;
}

export async function handleTrack(i: LocalInput): Promise<Response> {
  syncProcessEnv(i.env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const mod = await loadMarketing();
  return runNodeHandler(mod.default, {
    request: i.request,
    functionUrl: i.functionUrl,
    body: i.body,
    ctx: i.ctx,
    timeoutMs: LOCAL_TIMEOUT_MS,
    logPrefix: LOG_PREFIX,
  });
}
