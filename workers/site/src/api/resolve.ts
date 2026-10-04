// /api endpoint catalogue and action resolution. The resolver follows each handler's own precedence exactly, so
// the gate decides on the same action the handler will run. Values starting with '#' are sentinels: the handler
// answers them before any side effect, so they are dispatched without a gate.
//
//   #options       the handler answers OPTIONS itself, before any branch
//   #method        the handler answers 405 for this method
//   #unknown       the handler answers 400 for an unknown action
//   #unknown-step  marketing google-auth: the handler answers 400 for an unknown step
//   #throws        the handler fails before any side effect (body getter throws, non-string action): 500
//
// Body values are read exactly as the handlers read req.body (@vercel/node semantics, parseVercelBody), from the
// same bytes the handler will receive.

import { parseQuery, parseVercelBody, type BodyView } from '../../../shared/src/compat/vercel-node';
import { functionUrlFor } from '../../../shared/src/compat/vercel-rewrite';
import type { EndpointId } from '../../../shared/src/http/rpc';

export type Sentinel = '#options' | '#method' | '#unknown' | '#unknown-step' | '#throws';

export interface ResolvedApi {
  endpoint: EndpointId;
  /** url.pathname as requested. */
  publicPath: string;
  /** functionUrlFor(url).functionUrl */
  functionUrl: string;
  /** Upper case. */
  method: string;
  /** parseQuery of functionUrl. */
  query: Record<string, string | string[]>;
  /** parseVercelBody(Content-Type, bodyBytes). */
  body: BodyView;
  /** Empty for GET/HEAD. */
  bodyBytes: Uint8Array;
  /** Normalised action, or a sentinel. */
  action: string | Sentinel;
  /** The value the handler switches on. */
  rawAction: unknown;
  /** s3 only. */
  scope?: 'rfq' | 'articles';
  /** marketing google-auth: 'error' | 'authorize' | 'callback' | 'refresh'. */
  step?: string;
}

// Public path -> endpoint. A request path names a catalogue endpoint when its canonical spelling
// (cataloguePathOf below) is one of these paths; it is then resolved, gated and dispatched exactly as that path,
// and the handler sees the catalogue path in its function URL. Only paths outside the catalogue are forwarded,
// with their body unread.
const CATALOGUE: ReadonlyMap<string, EndpointId> = new Map<string, EndpointId>([
  ['/api/emails', 'emails'],
  ['/api/s3', 's3'],
  ['/api/marketing', 'marketing'],
  ['/api/track', 'marketing'],
  ['/api/notifications', 'notifications'],
  ['/api/gsc', 'gsc'],
  ['/api/tenders', 'tenders'],
  ['/api/connector-status', 'tenders'],
  ['/api/tender-scan', 'tender-scan'],
  ['/api/funded-startups', 'funded-startups'],
  ['/api/scrape-website', 'scrape-website'],
  ['/api/scrape-company-profile', 'scrape-company-profile'],
  ['/api/scan-directory', 'scan-directory'],
]);

/** Every public path of the catalogue (14). */
export const CATALOGUE_PATHS: readonly string[] = [...CATALOGUE.keys()];

const SENTINELS: ReadonlySet<string> = new Set(['#options', '#method', '#unknown', '#unknown-step', '#throws']);

const S3_ACTIONS: ReadonlySet<string> = new Set(['presign-upload', 'presign-download', 'delete', 'delete-folder', 'list']);
const OAUTH_STEPS: ReadonlySet<string> = new Set(['authorize', 'callback', 'refresh']);

const SCRIPT_EXTENSION = /\.(?:js|mjs|cjs|ts)$/;
const TRAILING_SLASHES = /\/+$/;

/** Canonical spelling of a request path: percent-decoded once (a malformed escape stays as it is), backslashes as
 *  slashes, repeated slashes collapsed, dot segments resolved, lower case, and without trailing slashes or a
 *  trailing script extension (.js, .mjs, .cjs, .ts; repeated). */
export function canonicalApiPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw form
  }
  path = `/${path}`.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  path = new URL(path, 'http://localhost').pathname.toLowerCase();
  for (;;) {
    const next = path.replace(TRAILING_SLASHES, '').replace(SCRIPT_EXTENSION, '');
    if (next === path) return path;
    path = next;
  }
}

/** The catalogue path a request path names (itself, or the catalogue path of its canonical spelling); null when
 *  it names none. */
export function cataloguePathOf(pathname: string): string | null {
  if (CATALOGUE.has(pathname)) return pathname;
  const canonical = canonicalApiPath(pathname);
  return CATALOGUE.has(canonical) ? canonical : null;
}

/** Catalogue lookup by path only (incl. /api/track and /api/connector-status and every spelling of a catalogue
 *  path); null: forward with the body unread. */
export function endpointOfPath(pathname: string): EndpointId | null {
  const path = cataloguePathOf(pathname);
  return path === null ? null : (CATALOGUE.get(path) ?? null);
}

export function isSentinel(action: string): action is Sentinel {
  return SENTINELS.has(action);
}

const LOGGABLE_ACTION = /^[a-z0-9-]{1,40}$/;

/** The action as it may appear in a log line: a sentinel or a short [a-z0-9-] value, else 'invalid' (inv-* values
 *  come from the request body and are never logged otherwise). */
export function actionForLog(action: string): string {
  return isSentinel(action) || LOGGABLE_ACTION.test(action) ? action : 'invalid';
}

interface Resolution {
  action: string;
  rawAction: unknown;
  scope?: 'rfq' | 'articles';
  step?: string;
}

interface Input {
  method: string;
  functionUrl: string;
  query: Record<string, string | string[]>;
  body: BodyView;
}

/** req.body as the handler sees it; throws what the getter throws. */
function bodyValue(i: Input): unknown {
  if (!i.body.ok) throw i.body.error;
  return i.body.value;
}

/** `value?.action` with JavaScript's own property lookup (primitives included). */
function actionOf(value: unknown): unknown {
  return value === null || value === undefined ? undefined : (value as { action?: unknown }).action;
}

/** new URL(req.url, 'http://localhost').searchParams.get('action') */
function searchAction(functionUrl: string): string | null {
  return new URL(functionUrl, 'http://localhost').searchParams.get('action');
}

// api/emails.js: OPTIONS -> 200; method != POST -> 405; then inside try:
// body?.action || ?action || 'email'; contact / rfq / rfq-pdf, anything else runs the email branch.
function resolveEmails(i: Input): Resolution {
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: undefined };
  if (i.method !== 'POST') return { action: '#method', rawAction: undefined };
  let raw: unknown;
  try {
    raw = actionOf(bodyValue(i)) || searchAction(i.functionUrl) || 'email';
  } catch {
    return { action: '#throws', rawAction: undefined };
  }
  const action = raw === 'contact' || raw === 'rfq' || raw === 'rfq-pdf' ? raw : 'email';
  return { action, rawAction: raw };
}

// api/s3.js readBody: a falsy body -> {}; a string -> JSON.parse or {}; anything else as is.
function s3ReadBody(value: unknown): unknown {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

// api/s3.js: OPTIONS -> 204; action = query.action; then inside try: body = readBody(req) and
// scope = body.scope || query.scope || 'rfq' (a throw answers 500), then the action switch (default 400).
function resolveS3(i: Input): Resolution {
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: undefined };
  const raw = i.query.action;
  let scope: 'rfq' | 'articles';
  try {
    const body = s3ReadBody(bodyValue(i)) as { scope?: unknown };
    const own = body.scope || i.query.scope || 'rfq';
    scope = own === 'articles' ? 'articles' : 'rfq';
  } catch {
    return { action: '#throws', rawAction: raw };
  }
  const action = typeof raw === 'string' && S3_ACTIONS.has(raw) ? raw : '#unknown';
  return { action, rawAction: raw, scope };
}

// api/marketing.js: switch on query.action; google-auth answers ?error= first, then switches on ?step=;
// apollo-enrich answers OPTIONS 200 and every other non-POST method 405 inside its branch. Other branches have no
// method check: OPTIONS resolves like GET there.
function resolveMarketing(i: Input): Resolution {
  const raw = i.query.action;
  switch (raw) {
    case 'track':
    case 'webhook':
      return { action: raw, rawAction: raw };
    case 'google-auth': {
      if (i.query.error) return { action: raw, rawAction: raw, step: 'error' };
      const step = i.query.step;
      if (typeof step === 'string' && OAUTH_STEPS.has(step)) return { action: raw, rawAction: raw, step };
      return { action: '#unknown-step', rawAction: raw };
    }
    case 'apollo-enrich':
      if (i.method === 'OPTIONS') return { action: '#options', rawAction: raw };
      if (i.method !== 'POST') return { action: '#method', rawAction: raw };
      return { action: raw, rawAction: raw };
    default:
      return { action: '#unknown', rawAction: raw };
  }
}

// api/notifications.js: OPTIONS -> 200; then inside try: body?.action || ?action || 'partner'; a non-string
// throws at .startsWith; inv-* run for any method; otherwise POST only; nest / production-status, anything else
// runs the partner branch.
function resolveNotifications(i: Input): Resolution {
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: undefined };
  let raw: unknown;
  try {
    raw = actionOf(bodyValue(i)) || searchAction(i.functionUrl) || 'partner';
  } catch {
    return { action: '#throws', rawAction: undefined };
  }
  if (typeof raw !== 'string') return { action: '#throws', rawAction: raw };
  if (raw.startsWith('inv-')) return { action: raw, rawAction: raw };
  if (i.method !== 'POST') return { action: '#method', rawAction: raw };
  const action = raw === 'nest' || raw === 'production-status' ? raw : 'partner';
  return { action, rawAction: raw };
}

// api/gsc.js: OPTIONS -> 200; then requireAdmin before any action (the action is logged, not gated separately).
function resolveGsc(i: Input): Resolution {
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: undefined };
  let raw: unknown = i.query.action;
  if (!raw) {
    try {
      raw = actionOf(bodyValue(i));
    } catch {
      raw = undefined;
    }
  }
  return { action: 'gsc', rawAction: raw };
}

// api/tenders.js: OPTIONS -> 200; GET: connectors=true -> stats_only=true -> export=csv -> id -> list; PATCH;
// anything else 405. /api/connector-status arrives here with connectors=true merged in.
function resolveTenders(i: Input): Resolution {
  const q = i.query;
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: i.method };
  if (i.method === 'GET') {
    if (q.connectors === 'true') return { action: 'connectors', rawAction: i.method };
    if (q.stats_only === 'true') return { action: 'stats', rawAction: i.method };
    if (q.export === 'csv') return { action: 'export', rawAction: i.method };
    if (q.id) return { action: 'id', rawAction: i.method };
    return { action: 'list', rawAction: i.method };
  }
  if (i.method === 'PATCH') return { action: 'patch', rawAction: i.method };
  return { action: '#method', rawAction: i.method };
}

// api/funded-startups.js: OPTIONS -> 200; GET: action=stats -> feeds -> export -> id -> list; POST scan; PATCH;
// anything else 405.
function resolveFunded(i: Input): Resolution {
  const q = i.query;
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: i.method };
  if (i.method === 'GET') {
    if (q.action === 'stats' || q.action === 'feeds' || q.action === 'export') return { action: q.action, rawAction: q.action };
    if (q.id) return { action: 'id', rawAction: q.action };
    return { action: 'list', rawAction: q.action };
  }
  if (i.method === 'POST') return { action: 'scan', rawAction: i.method };
  if (i.method === 'PATCH') return { action: 'patch', rawAction: i.method };
  return { action: '#method', rawAction: i.method };
}

// api/tender-scan.js, api/scrape-website.js, api/scrape-company-profile.js, api/scan-directory.js:
// OPTIONS -> 200; method != POST -> 405.
function resolvePostOnly(i: Input, action: string): Resolution {
  if (i.method === 'OPTIONS') return { action: '#options', rawAction: i.method };
  if (i.method !== 'POST') return { action: '#method', rawAction: i.method };
  return { action, rawAction: i.method };
}

function resolveAction(endpoint: EndpointId, i: Input): Resolution {
  switch (endpoint) {
    case 'emails':
      return resolveEmails(i);
    case 's3':
      return resolveS3(i);
    case 'marketing':
      return resolveMarketing(i);
    case 'notifications':
      return resolveNotifications(i);
    case 'gsc':
      return resolveGsc(i);
    case 'tenders':
      return resolveTenders(i);
    case 'tender-scan':
      return resolvePostOnly(i, 'scan');
    case 'funded-startups':
      return resolveFunded(i);
    case 'scrape-website':
    case 'scrape-company-profile':
    case 'scan-directory':
      return resolvePostOnly(i, 'post');
  }
}

const EMPTY = new Uint8Array(0);

/** Called only when endpointOfPath() is not null. */
export function resolveApi(request: Request, bodyBytes: Uint8Array): ResolvedApi {
  const url = new URL(request.url);
  const path = cataloguePathOf(url.pathname);
  const endpoint = path === null ? undefined : CATALOGUE.get(path);
  if (path === null || endpoint === undefined) throw new Error(`resolveApi: ${url.pathname} is not an /api endpoint of the catalogue`);
  const method = request.method.toUpperCase();
  const bytes = method === 'GET' || method === 'HEAD' ? EMPTY : bodyBytes;
  // The function URL is built from the catalogue path, so every spelling reaches the handler (and the rewrite of
  // /api/track and /api/connector-status) as the catalogue path itself; the query is kept as sent.
  const routed = new URL(url.href);
  routed.pathname = path;
  const { functionUrl } = functionUrlFor(routed);
  const query = parseQuery(functionUrl);
  const body = parseVercelBody(request.headers.get('content-type'), bytes);
  const resolution = resolveAction(endpoint, { method, functionUrl, query, body });
  const resolved: ResolvedApi = {
    endpoint,
    publicPath: url.pathname,
    functionUrl,
    method,
    query,
    body,
    bodyBytes: bytes,
    action: resolution.action,
    rawAction: resolution.rawAction,
  };
  if (resolution.scope !== undefined) resolved.scope = resolution.scope;
  if (resolution.step !== undefined) resolved.step = resolution.step;
  return resolved;
}
