// /api/* router of microns-site (runs when the flag api.forward_to_vercel is off, src/api/forward.ts).
//
//   1 Path      endpointOfPath(), on the canonical spelling of the path (src/api/resolve.ts); a path outside the
//               catalogue is forwarded to Vercel with its body unread
//   2 Body      non-GET/HEAD bodies are buffered once (at most 4.5 MiB, else 413 {"error":"payload_too_large"});
//               from here on every consumer gets these bytes, the request body is never read again
//   3 Resolve   endpoint, function URL (vercel.json rewrite merged), action (src/api/resolve.ts)
//   4 Names     the bindings, vars and secrets of the dispatch target (NAMES_BY_TARGET); a missing name answers
//               500 for this request only, never for other targets
//   5 Sentinel  OPTIONS / 405 / 400 / 500 answers of the handler itself: dispatched ungated as ANON
//   6 Gate      applyGate() (src/auth/gate.ts): deny / respond answer here; allow may override the function URL
//               and the body bytes, and carries the principal, file constraints and the OAuth opener origin
//   7 Dispatch  local (emails, s3 files API, marketing track) / ops (microns-ops over OPS) / forward
//   8 Log       one line per request: endpoint, action, action id, target, status, ms, principal class, request id
//   9 Return    the response goes back to src/index.ts, where finalise() adds the CORS headers (as vercel.json
//               does on every /api/* answer), noindex and the HEAD handling
// Errors: a throw in steps 3-7 (gate, handler before res.end(), module load) answers 500 text/plain "Internal
// Server Error" and is logged with the endpoint and request id; handler answers are never rewritten.
//
// Endpoint 'agent' (Phase 4, /api/agent/*; src/api/resolve.ts): step 2 caps the body at AGENT_BODY_MAX_BYTES
// (65,536; 413 {"error":"payload_too_large"}); its sentinels are answered here and never dispatched (#unknown: 404
// {"error":"not_found"}, #method: 405 {"error":"method_not_allowed"} with Allow); every agent answer carries
// Cache-Control: no-store unless the answer sets its own (file downloads: private, no-store). The target is always
// microns-ops, never the forward.

import { describeError, MAX_FUNCTION_BODY_BYTES, parseQuery, parseVercelBody } from '../../../shared/src/compat/vercel-node';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { apiError, textResponse } from '../../../shared/src/http/json';
import { formatLogLine, logLine } from '../../../shared/src/http/log';
import type { EndpointId, OpsApiRpc, Principal } from '../../../shared/src/http/rpc';
import { applyGate } from '../auth/gate';
import { NO_FILE_CONSTRAINTS, type FileConstraints } from '../auth/constraints';
import type { Env } from '../env';
import { LOG_PREFIX } from '../env';
import { handleEmails } from './emails';
import { handleFiles, type FilesEnv } from './files';
import { forwardToVercel } from './forward';
import { callOps } from './ops-client';
import { actionForLog, AGENT_METHODS, cataloguePathOf, endpointOfPath, isSentinel, resolveApi, type ResolvedApi } from './resolve';
import { handleTrack } from './track';
import type { AgentAction } from '../../../shared/src/agent-api';

/** Request body cap of /api/agent/* (bytes). */
export const AGENT_BODY_MAX_BYTES = 65_536;

/** An agent answer with Cache-Control: no-store unless it already sets Cache-Control. */
export function agentNoStore(response: Response): Response {
  if (response.headers.has('cache-control')) return response;
  const out = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

/** The site's own answer to an agent sentinel: 404 for an unknown action, 405 with Allow for another method. */
function agentSentinelAnswer(r: ResolvedApi): Response {
  if (r.action === '#method') {
    const allow = AGENT_METHODS[r.rawAction as AgentAction] ?? 'GET';
    return apiError(405, 'method_not_allowed', { Allow: allow });
  }
  return apiError(404, 'not_found');
}

export type Target = 'local' | 'ops' | 'forward';

/** Where each endpoint runs. 'by-action': marketing track runs locally, every other marketing action in ops.
 *  An endpoint whose port is not finished is set to 'forward' here (the table, not a flag, records that state). */
export type EndpointTarget = Target | 'by-action';
export type TargetTable = Readonly<Record<EndpointId, EndpointTarget>>;

export const ENDPOINT_TARGETS: TargetTable = {
  emails: 'local',
  s3: 'local',
  marketing: 'by-action',
  notifications: 'ops',
  gsc: 'ops',
  tenders: 'ops',
  'tender-scan': 'ops',
  'funded-startups': 'ops',
  'scrape-website': 'ops',
  'scrape-company-profile': 'ops',
  'scan-directory': 'ops',
  agent: 'ops',
};

/** Dispatch key: the concrete module behind a target. */
export type Dispatch = 'emails' | 'files' | 'track' | 'ops' | 'forward';

/** Names each dispatch target needs (step 4). Gate checks declare their own names (src/auth/gate.ts). */
export const NAMES_BY_TARGET: Readonly<Record<Dispatch, readonly (keyof Env)[]>> = {
  // api/emails.js builds its Resend client at module scope.
  emails: ['RESEND_API_KEY'],
  // api/marketing.js builds its Supabase client at module scope; nothing else is needed for tracking.
  track: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_ORIGIN'],
  // FilesEnv (src/api/files.ts).
  files: [
    'PRIVATE_FILES',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'LEGACY_S3_REGION',
    'LEGACY_S3_RFQ_BUCKET',
    'LEGACY_S3_ARTICLES_BUCKET',
    'LEGACY_AWS_ACCESS_KEY_ID',
    'LEGACY_AWS_SECRET_ACCESS_KEY',
  ],
  ops: ['OPS'],
  // The forward answers 502 itself on a bad API_FORWARD_ORIGIN.
  forward: [],
};

function targetIn(table: TargetTable, r: ResolvedApi): Target {
  const target = table[r.endpoint];
  if (target !== 'by-action') return target;
  return r.action === 'track' ? 'local' : 'ops';
}

/** Target of a resolved request: marketing track -> local, other marketing actions -> ops. */
export function targetOf(r: ResolvedApi): Target {
  return targetIn(ENDPOINT_TARGETS, r);
}

function dispatchOf(r: ResolvedApi, target: Target): Dispatch {
  if (target !== 'local') return target;
  if (r.endpoint === 'emails') return 'emails';
  if (r.endpoint === 's3') return 'files';
  if (r.endpoint === 'marketing' && r.action === 'track') return 'track';
  throw new Error(`api router: no local handler for endpoint ${r.endpoint}`);
}

const EMPTY: Uint8Array = new Uint8Array(0);
const ANON: Principal = { class: 'ANON' };

type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false };

// Upper bound of an oversized body that is read and discarded before the 413 answer.
const DRAIN_LIMIT_BYTES = 128 * 1024 * 1024;

// Reads the rest of an oversized body without keeping it, so that the 413 goes out after the client has sent its
// request (a client still uploading would otherwise see the connection drop instead of the answer).
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, alreadyRead: number): Promise<void> {
  let total = alreadyRead;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    total += value.byteLength;
    if (total > DRAIN_LIMIT_BYTES) {
      reader.cancel().catch(() => {});
      return;
    }
  }
}

// Step 2: reads the body once and refuses more than `limit` bytes (MAX_FUNCTION_BODY_BYTES; agent endpoint:
// AGENT_BODY_MAX_BYTES), a declared Content-Length above the limit or the first byte over it; nothing over the limit
// is kept in memory.
async function readBodyCapped(request: Request, limit: number = MAX_FUNCTION_BODY_BYTES): Promise<BodyRead> {
  if (!request.body) return { ok: true, bytes: EMPTY };
  const reader = request.body.getReader();
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await drain(reader, 0);
    return { ok: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await drain(reader, total);
      return { ok: false };
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return { ok: true, bytes: chunks[0] };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

// The resolved request as the handler will see it after a gate override (the decision itself is not re-taken).
function withOverrides(r: ResolvedApi, request: Request, functionUrl: string, bytes: Uint8Array): ResolvedApi {
  if (functionUrl === r.functionUrl && bytes === r.bodyBytes) return r;
  return {
    ...r,
    functionUrl,
    query: functionUrl === r.functionUrl ? r.query : parseQuery(functionUrl),
    body: bytes === r.bodyBytes ? r.body : parseVercelBody(request.headers.get('content-type'), bytes),
    bodyBytes: bytes,
  };
}

// A forward of a routed endpoint sends the request as received when its path is the catalogue path and the gate
// left the function URL unchanged; otherwise it sends the function URL the gate decided on.
function forwardRequestFor(request: Request, r: ResolvedApi, functionUrl: string): Request {
  if (functionUrl === r.functionUrl && cataloguePathOf(r.publicPath) === r.publicPath) return request;
  return new Request(new URL(functionUrl, request.url), { method: request.method, headers: request.headers, redirect: 'manual' });
}

interface LogFields {
  endpoint?: string;
  action?: string;
  actionId?: string;
  target?: string;
  principal?: string;
}

/** routeApi with another endpoint target table (tests, and endpoints whose port is not finished). */
export function createRouteApi(table: TargetTable): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  return async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const fields: LogFields = {};
    const done = (answer: Response): Response => {
      const response = fields.endpoint === 'agent' ? agentNoStore(answer) : answer;
      // Step 8.
      logLine(LOG_PREFIX, 'api', {
        endpoint: fields.endpoint,
        action: fields.action,
        actionId: fields.actionId,
        target: fields.target,
        status: response.status,
        ms: Date.now() - started,
        principal: fields.principal,
        requestId,
      });
      return response;
    };

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 1. Path: unknown /api/* paths are forwarded as they are (Vercel answers them, oversize bodies included).
    const endpoint = endpointOfPath(url.pathname);
    if (endpoint === null) {
      fields.target = 'forward';
      return done(await forwardToVercel(request, env));
    }
    fields.endpoint = endpoint;

    // 2. Body, buffered once.
    let bytes = EMPTY;
    if (method !== 'GET' && method !== 'HEAD') {
      const read = await readBodyCapped(request, endpoint === 'agent' ? AGENT_BODY_MAX_BYTES : MAX_FUNCTION_BODY_BYTES);
      if (!read.ok) return done(apiError(413, 'payload_too_large'));
      bytes = read.bytes;
    }

    try {
      // 3. Resolve.
      const r = resolveApi(request, bytes);
      fields.action = actionForLog(r.action);
      // Agent sentinels: answered by the site, never dispatched.
      if (r.endpoint === 'agent' && isSentinel(r.action)) return done(agentSentinelAnswer(r));
      const target = targetIn(table, r);
      fields.target = target;
      const dispatch = dispatchOf(r, target);

      // 4. Names of this target only.
      const missing = missingNames(env, NAMES_BY_TARGET[dispatch]);
      if (missing.length > 0) return done(configError(LOG_PREFIX, missing));

      // 5-6. Sentinels go ungated as ANON; everything else through the gate.
      let principal = ANON;
      let functionUrl = r.functionUrl;
      let body = r.bodyBytes;
      let constraints: FileConstraints = NO_FILE_CONSTRAINTS;
      let openerOrigin: string | undefined;
      if (!isSentinel(r.action)) {
        const outcome = await applyGate(r, request, env, ctx);
        fields.actionId = outcome.actionId;
        if (outcome.kind !== 'allow') return done(outcome.response);
        principal = outcome.principal;
        if (outcome.functionUrl !== undefined) functionUrl = outcome.functionUrl;
        if (outcome.body !== undefined) body = outcome.body;
        if (outcome.constraints !== undefined) constraints = outcome.constraints;
        openerOrigin = outcome.openerOrigin;
      }
      fields.principal = principal.class;
      const handlerBody = method === 'GET' || method === 'HEAD' ? null : body;

      // 7. Dispatch.
      switch (dispatch) {
        case 'emails':
          return done(await handleEmails({ request, env, ctx, functionUrl, body: handlerBody, principal }));
        case 'track':
          return done(await handleTrack({ request, env, ctx, functionUrl, body: handlerBody, principal }));
        case 'files':
          return done(await handleFiles({
            resolved: withOverrides(r, request, functionUrl, body),
            principal,
            constraints,
            env: env as Env & FilesEnv,
            ctx,
          }));
        case 'ops':
          return done(await callOps(env as Env & { OPS: Fetcher & OpsApiRpc }, request, r, {
            functionUrl,
            body: handlerBody,
            principal,
            requestId,
            openerOrigin,
          }));
        case 'forward':
          return done(await forwardToVercel(forwardRequestFor(request, r, functionUrl), env, handlerBody));
      }
    } catch (err) {
      console.error(formatLogLine(LOG_PREFIX, 'api handler error', { endpoint, requestId }), describeError(err));
      return done(textResponse(500, 'Internal Server Error'));
    }
  };
}

export const routeApi: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> = createRouteApi(ENDPOINT_TARGETS);
