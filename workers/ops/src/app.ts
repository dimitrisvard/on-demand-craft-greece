// Hono app of microns-ops. Requests reach it only through OpsApi.handle (service binding OPS, RPC), which registers
// the OpsCall the site built for the request; the verified principal and the function URL are read from that call,
// never from a request header.
//
// Rules
//   - A request without a registered call answers 500 text/plain (it can only come from a wiring bug).
//   - Every route is app.all(<function path>), so OPTIONS and every method reach the handler, as on Vercel.
//   - A path with no route answers 404 text/plain (only reachable through a site bug).
//   - One error boundary: a throw that no handler answered becomes 500 text/plain "Internal Server Error".
//   - One log line per call with endpoint, action, status, duration, principal class and requestId (never a
//     query string, header, body or e-mail address).
//   - The action appears in a log line only as a sentinel ('#' + [a-z0-9-]) or a short [a-z0-9-] value of at most
//     40 characters; any other action is written as 'invalid' (inv-* actions come from the request body), the same
//     rule as the site's log lines.

import { Hono } from 'hono';
import type { OpsCall } from '../../shared/src/http/rpc';
import { textResponse } from '../../shared/src/http/json';
import { formatLogLine, logLine } from '../../shared/src/http/log';
import { describeError } from '../../shared/src/compat/vercel-node';
import { LOG_PREFIX, type OpsHono } from './env';
import { register as registerFundedStartups } from './routes/funded-startups';
import { register as registerGsc } from './routes/gsc';
import { register as registerMarketing } from './routes/marketing';
import { register as registerNotifications } from './routes/notifications';
import { register as registerScanDirectory } from './routes/scan-directory';
import { register as registerScrape } from './routes/scrape';
import { register as registerTenderScan } from './routes/tender-scan';
import { register as registerTenders } from './routes/tenders';

const calls = new WeakMap<Request, OpsCall>();

const LOGGABLE_ACTION = /^#?[a-z0-9-]{1,40}$/;

/** The action as it may appear in a log line: a sentinel or a short [a-z0-9-] value, else 'invalid'. */
function actionForLog(action: string): string {
  return LOGGABLE_ACTION.test(action) ? action : 'invalid';
}

/** Registers the call for exactly this Request object; the app reads it back in its first middleware. */
export function registerCall(request: Request, call: OpsCall): void {
  calls.set(request, call);
}

// strict: false so that a trailing slash reaches the same function as on Vercel.
export const app: Hono<OpsHono> = new Hono<OpsHono>({ strict: false });

app.use('*', async (c, next) => {
  const call = calls.get(c.req.raw);
  if (!call) {
    console.error(formatLogLine(LOG_PREFIX, 'request without a registered call', { method: c.req.method }));
    return textResponse(500, 'Internal Server Error');
  }
  c.set('call', call);
  const started = Date.now();
  await next();
  logLine(LOG_PREFIX, 'api', {
    endpoint: call.endpoint,
    action: actionForLog(call.action),
    status: c.res.status,
    ms: Date.now() - started,
    principal: call.principal.class,
    requestId: call.requestId,
  });
});

registerMarketing(app);
registerNotifications(app);
registerGsc(app);
registerTenders(app);
registerTenderScan(app);
registerFundedStartups(app);
registerScrape(app);
registerScanDirectory(app);

app.notFound(() => textResponse(404, 'Not Found'));

app.onError((error, c) => {
  const call = c.get('call') as OpsCall | undefined;
  console.error(
    formatLogLine(LOG_PREFIX, 'handler failed', { endpoint: call?.endpoint, action: call ? actionForLog(call.action) : undefined, requestId: call?.requestId }),
    describeError(error),
  );
  return textResponse(500, 'Internal Server Error');
});
