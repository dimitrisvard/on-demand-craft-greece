// /api/tender-scan -> api/tender-scan.js, with a queue for machine callers.
//
// Rules
//   - A MACHINE principal (from the OpsCall, never from a header) sending POST gets an immediate answer and the
//     scan runs in the queue consumer: the machine callers abort long requests, and a scan takes seconds to
//     minutes. The answer is today's 200 body with every count at zero plus `queued: true` and `run_id`, with the
//     handler's own CORS headers.
//   - Before anything is queued, the request is validated exactly as the handler validates it: a falsy
//     country_code answers 400 {"error":"country_code is required"}; an unknown code answers 400
//     {"error":"No connector for country: <CC>"} (the handler's code list). Any body the handler would reject in
//     another way (unparsable JSON, a non-string country_code) runs the handler synchronously, which answers before
//     any write. So the queue only receives valid jobs.
//   - Every other caller and method runs the handler synchronously, unchanged.

import type { Context, Hono } from 'hono';
import { parseVercelBody, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { requestBytes, runVercel } from '../compat/express-shim';
import { LOG_PREFIX, type OpsHono } from '../env';
import { enqueueScrape } from '../queues/messages';

/** Country codes with a connector, in the order of the CONNECTORS table of api/tender-scan.js (a test compares). */
export const TENDER_SCAN_COUNTRY_CODES: readonly string[] = [
  'NL', 'IE', 'FR', 'DE', 'ES',
  'IT', 'PL', 'BE', 'SE', 'AT', 'DK', 'FI', 'PT', 'RO', 'EE', 'NO', 'CZ', 'HU', 'HR', 'SK', 'SI', 'BG', 'LT', 'LV',
  'CY', 'LU', 'MT', 'CH',
  'EU', 'GR',
];

const KNOWN_CODES: ReadonlySet<string> = new Set(TENDER_SCAN_COUNTRY_CODES);

const loadHandler = (): Promise<{ default: VercelHandler }> => import('../../../../api/tender-scan.js');

// The CORS headers api/tender-scan.js sets on every answer (its setCors).
function setHandlerCors(res: { setHeader(name: string, value: unknown): void }): void {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
  );
}

/** A fixed JSON answer produced through the shim, so it carries exactly the headers of the handler's res.json(). */
function answer(c: Context<OpsHono>, status: number, body: unknown): Promise<Response> {
  const fixed: VercelHandler = (_req, res) => {
    setHandlerCors(res);
    return res.status(status).json(body);
  };
  return runVercel(c, fixed, { body: null });
}

async function runHandler(c: Context<OpsHono>, body: Uint8Array | null): Promise<Response> {
  const { default: handler } = await loadHandler();
  return runVercel(c, handler, { body });
}

async function tenderScan(c: Context<OpsHono>): Promise<Response> {
  const call = c.var.call;
  const body = await requestBytes(c);
  if (call.principal.class !== 'MACHINE' || c.req.method.toUpperCase() !== 'POST') return runHandler(c, body);

  const bytes = body ?? new Uint8Array(0);
  const view = parseVercelBody(c.req.header('content-type') ?? null, bytes);
  if (!view.ok) return runHandler(c, bytes);
  // `const { country_code } = req.body || {}` in the handler.
  const source: unknown = view.value || {};
  const countryCode = (Object(source) as Record<string, unknown>).country_code;
  if (!countryCode) return answer(c, 400, { error: 'country_code is required' });
  if (typeof countryCode !== 'string') return runHandler(c, bytes);
  const code = countryCode.toUpperCase();
  if (!KNOWN_CODES.has(code)) return answer(c, 400, { error: `No connector for country: ${code}` });

  const missing = missingNames(c.env, ['SCRAPES']);
  if (missing.length) return configError(LOG_PREFIX, missing);
  const runId = await enqueueScrape(c.env, 'tender-scan', { country_code: code }, `MACHINE:${call.principal.machine ?? 'unknown'}`);
  return answer(c, 200, {
    success: true,
    country_code: code,
    tenders_found: 0,
    tenders_new: 0,
    tenders_relevant: 0,
    errors: [],
    duration_ms: 0,
    queued: true,
    run_id: runId,
  });
}

export function register(app: Hono<OpsHono>): void {
  app.all('/api/tender-scan', tenderScan);
}
