// /api/cad/flat-pattern in microns-ops (Phase 5, unit D5): the compat path of the CAD edge functions to the CAD
// Container through CadRouter (priority 'interactive'). The site resolves the public path, checks the compat token
// (action CD-1, principal MACHINE:cad-compat) and sends the function URL /api/cad/flat-pattern without the token, so
// the token never reaches this Worker.
//
// Steps
//   1 Caller   only the principal MACHINE:cad-compat on endpoint 'cad-compat'; anything else answers 403 (a site
//              wiring bug). Only POST (else 405, Allow: POST).
//   2 Config   CAD_ROUTER, CAD_SHARED_SECRET, CAD_INPUT_HOSTS and the container (CAD_CONTAINER, or the T2
//              CAD_CONTAINER_BASE_URL) must be configured; else 502 {"detail":"CAD unavailable"} and a log line
//              naming what is missing (never a value).
//   3 Validate the body is a JSON object of at most MAX_COMPAT_BODY_BYTES (else 413 / 400 "Invalid JSON body");
//              file_url is an https: URL without credentials whose host is in CAD_INPUT_HOSTS (else 400 {"detail":
//              "file_url host not allowed"}); file_name, when present, is a string of 1-255 characters without '/',
//              '\', NUL and other control characters, and not '.' or '..' (else 400 {"detail":"Invalid
//              file_name"}); every other field (part_info, debug, …) passes through unchanged.
//   4 Acquire  CadRouter.acquire({job_id: 'compat:<uuid>', backend_candidates: ['container'], deadline_s: 110,
//              priority: 'interactive'}), retried every 2 s for up to 20 s; then 503 {"detail":"CAD busy"}.
//   5 Call     POST http://cad/flat-pattern on the lease's slot with content-type application/json, X-API-Key =
//              CAD_SHARED_SECRET and the body with file_url replaced by encodeInputUrl(<original>) (same key
//              order); the whole request, body read included, is aborted 110 s after it started (the edge
//              functions give up at 120 s). No answer in time, or a network error -> 502 {"detail":"CAD
//              unavailable"}.
//   6 Return   the container's status, content-type and body bytes unchanged.
//   7 Release  the lease with the outcome of the answer (ok for 2xx; backend_down for no answer or a down status;
//              recycle for the service's crash answer or a refused key); one Analytics Engine point
//              event 'cad_compat' (slot, status, duration, bytes); a key alert as the cad-jobs consumer sends it.
//              No agent_runs row (a request, not a scheduled run).
// Rules
//   - Every error inside the branch is caught here and answers 502 {"detail":"CAD unavailable"} (the FastAPI
//     error shape the edge functions already handle); nothing is forwarded.
//   - Log lines name the path as /api/cad/<redacted>/flat-pattern and carry codes, the slot and the status only
//     (never the input URL, the body or a key).

import type { Hono } from 'hono';
import type { OpsCall } from '../../../shared/src/http/rpc';
import { formatLogLine } from '../../../shared/src/http/log';
import { writeEvent, type AgentEventName, type AgentEventPoint } from '../agents/events';
import { sendCadAlert } from '../cad-container/alerts';
import { encodeInputUrl, isAllowedInputUrl } from '../cad-container/input-proxy';
import { ANSWER_PREFIX_BYTES, isBackendDown, serviceAnswerOutcome } from '../cad/backends/http-unfold';
import { CONTAINER_BASE_URL } from '../cad/backends/container';
import { missingContainerConfig } from '../cad/registry';
import { CAD_ROUTER_NAME } from '../cad/router-client';
import type { AcquireRequest, AcquireResult, ReleaseOutcome } from '../cad/types';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';
import { makeP5Ports, type ContainerPort, type TelegramTextPort } from '../ports/p5';

/** Function URL of the compat path (the site sends it without the token). */
export const COMPAT_PATH = '/api/cad/flat-pattern';
/** The path as log lines name it. */
export const COMPAT_LOG_PATH = '/api/cad/<redacted>/flat-pattern';
/** Endpoint and machine name of the compat caller (site action CD-1). */
export const COMPAT_ENDPOINT = 'cad-compat';
export const COMPAT_MACHINE = 'cad-compat';
/** End-to-end deadline of one compat call. */
export const COMPAT_DEADLINE_MS = 110_000;
/** Lease deadline of a compat call, in seconds. */
export const COMPAT_LEASE_DEADLINE_S = 110;
/** Pause between two acquire attempts, and the longest wait for a slot. */
export const ACQUIRE_RETRY_MS = 2_000;
export const ACQUIRE_WAIT_MS = 20_000;
/** Largest request body (the site's body cap). */
export const MAX_COMPAT_BODY_BYTES = 4.5 * 1024 * 1024;
/** The container request URL. */
export const CONTAINER_FLAT_PATTERN_URL = `${CONTAINER_BASE_URL}/flat-pattern`;
/** Analytics Engine event of a compat call. */
export const COMPAT_EVENT = 'cad_compat' as string as AgentEventName;

/** Answer texts (FastAPI error shape). */
export const COMPAT_DETAIL = Object.freeze({
  hostNotAllowed: 'file_url host not allowed',
  invalidFileName: 'Invalid file_name',
  invalidJson: 'Invalid JSON body',
  tooLarge: 'Request body too large',
  busy: 'CAD busy',
  unavailable: 'CAD unavailable',
  forbidden: 'Forbidden',
  methodNotAllowed: 'Method Not Allowed',
});

/** The CadRouter calls of the compat path. */
export interface CompatRouter {
  acquire(r: AcquireRequest): Promise<AcquireResult>;
  release(lease_id: string, o: ReleaseOutcome): Promise<void>;
}

export interface CadCompatDeps {
  router?: CompatRouter;
  container?: ContainerPort;
  telegramText?: TelegramTextPort;
  /** Analytics Engine writer (default writeEvent on env.EVENTS). */
  event?: (p: AgentEventPoint) => void;
  /** Milliseconds since the epoch (default Date.now). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
}

function detail(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ detail: text }), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, { path: COMPAT_LOG_PATH, ...fields }));
}

/** Names of the configuration the compat path needs that is missing. */
export function missingCompatConfig(env: OpsEnv): string[] {
  const missing: string[] = [];
  if (!env.CAD_ROUTER) missing.push('CAD_ROUTER');
  for (const name of missingContainerConfig(env)) missing.push(name);
  if (!env.CAD_INPUT_HOSTS || env.CAD_INPUT_HOSTS.trim() === '') missing.push('CAD_INPUT_HOSTS');
  return missing;
}

/** True for a file_name the service may use as a plain file name. */
export function isPlainFileName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\\u0000-\u001f\u007f]/.test(name);
}

type Validated = { ok: true; body: Record<string, unknown>; fileUrl: string } | { ok: false; response: Response };

/** Step 3 of the header: the parsed body, or the 400 answer. */
export function validateCompatBody(text: string, hosts: string | undefined): Validated {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: detail(400, COMPAT_DETAIL.invalidJson) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, response: detail(400, COMPAT_DETAIL.invalidJson) };
  const body = parsed as Record<string, unknown>;
  const fileUrl = body.file_url;
  let url: URL | null = null;
  if (typeof fileUrl === 'string') {
    try {
      url = new URL(fileUrl);
    } catch {
      url = null;
    }
  }
  if (!url || !isAllowedInputUrl(url, hosts)) return { ok: false, response: detail(400, COMPAT_DETAIL.hostNotAllowed) };
  if ('file_name' in body && !isPlainFileName(body.file_name)) return { ok: false, response: detail(400, COMPAT_DETAIL.invalidFileName) };
  return { ok: true, body, fileUrl: fileUrl as string };
}

/** The container body: the caller's fields in their order, file_url replaced by its internal input URL. */
export function containerBody(body: Record<string, unknown>, fileUrl: string): string {
  return JSON.stringify({ ...body, file_url: encodeInputUrl(fileUrl) });
}

/** Reads at most max bytes of the request body; null when it is longer. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function defaultRouter(env: OpsEnv): CompatRouter {
  const ns = env.CAD_ROUTER as DurableObjectNamespace;
  return ns.get(ns.idFromName(CAD_ROUTER_NAME)) as unknown as CompatRouter;
}

/** The compat call (steps of the header). Never throws. */
export async function handleCadCompat(req: Request, env: OpsEnv, call: OpsCall, deps: CadCompatDeps = {}): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const machine = call.principal.machine as string | undefined;
  if (call.principal.class !== 'MACHINE' || machine !== COMPAT_MACHINE || (call.endpoint as string) !== COMPAT_ENDPOINT) {
    log('cad compat refused', { reason: 'principal', principal: call.principal.class });
    return detail(403, COMPAT_DETAIL.forbidden);
  }
  if (req.method !== 'POST') return detail(405, COMPAT_DETAIL.methodNotAllowed, { allow: 'POST' });

  const point = (p: Partial<AgentEventPoint>): void => {
    const write = deps.event ?? ((x: AgentEventPoint) => writeEvent(env.EVENTS, x));
    try {
      write({ event: COMPAT_EVENT, run_id: call.requestId, agent: 'cad', route: 'container', latency_ms: now() - started, ...p });
    } catch {
      // Analytics are best effort.
    }
  };

  let leaseId: string | null = null;
  let slot: string | undefined;
  let release: ReleaseOutcome = { ok: false, retryable: true };
  let router: CompatRouter | null = null;
  try {
    const missing = missingCompatConfig(env);
    if (missing.length > 0) {
      log('cad compat config missing', { missing: missing.join(',') });
      point({ outcome: 'config_missing' });
      return detail(502, COMPAT_DETAIL.unavailable);
    }
    const text = await readCapped(req, MAX_COMPAT_BODY_BYTES);
    if (text === null) {
      point({ outcome: 'too_large' });
      return detail(413, COMPAT_DETAIL.tooLarge);
    }
    const valid = validateCompatBody(text, env.CAD_INPUT_HOSTS);
    if (!valid.ok) {
      point({ outcome: 'invalid_input' });
      return valid.response;
    }

    // 4 Acquire
    router = deps.router ?? defaultRouter(env);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const request: AcquireRequest = {
      job_id: `compat:${(deps.uuid ?? (() => crypto.randomUUID()))()}`,
      backend_candidates: ['container'],
      deadline_s: COMPAT_LEASE_DEADLINE_S,
      priority: 'interactive',
    };
    for (;;) {
      const granted = await router.acquire(request);
      if (granted.granted) {
        leaseId = granted.lease_id;
        slot = granted.slot;
        break;
      }
      if (now() - started + ACQUIRE_RETRY_MS > ACQUIRE_WAIT_MS) {
        log('cad compat busy', { waited_ms: now() - started });
        point({ outcome: 'busy' });
        return detail(503, COMPAT_DETAIL.busy);
      }
      await sleep(ACQUIRE_RETRY_MS);
    }
    if (!slot) {
      log('cad compat lease without slot', {});
      point({ outcome: 'no_slot' });
      return detail(502, COMPAT_DETAIL.unavailable);
    }

    // 5 Call
    const remaining = COMPAT_DEADLINE_MS - (now() - started);
    if (remaining <= 0) {
      release = { ok: false, retryable: true };
      point({ step: slot, outcome: 'timeout' });
      return detail(502, COMPAT_DETAIL.unavailable);
    }
    const container = deps.container ?? makeP5Ports(env).container;
    const signal = AbortSignal.timeout(remaining);
    const upstream = new Request(CONTAINER_FLAT_PATTERN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': env.CAD_SHARED_SECRET as string },
      body: containerBody(valid.body, valid.fileUrl),
      signal,
    });
    let status: number;
    let contentType: string | null;
    let bytes: ArrayBuffer;
    try {
      const answer = await container.fetch(slot, upstream);
      status = answer.status;
      contentType = answer.headers.get('content-type');
      bytes = await answer.arrayBuffer();
    } catch (error) {
      const timedOut = signal.aborted || isAbort(error);
      release = { ok: false, retryable: true, backend_down: true };
      log('cad compat no answer', { slot, reason: timedOut ? 'timeout' : 'network' });
      point({ step: slot, outcome: timedOut ? 'timeout' : 'unreachable' });
      return detail(502, COMPAT_DETAIL.unavailable);
    }

    // 6 Return, 7 release (finally)
    if (status >= 200 && status < 300) release = { ok: true };
    else {
      const outcome = serviceAnswerOutcome(status, new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, ANSWER_PREFIX_BYTES))), 'container');
      release = { ok: false, retryable: outcome.retryable, backend_down: isBackendDown(outcome), ...(outcome.recycle ? { recycle: true } : {}) };
      if (outcome.alert) {
        let telegram = deps.telegramText;
        await sendCadAlert(() => (telegram ??= makeP5Ports(env).telegramText), outcome.alert, 'container', now());
      }
    }
    log('cad compat answered', { slot, status, ms: now() - started, bytes: bytes.byteLength });
    point({ step: slot, outcome: `status_${status}`, bytes: bytes.byteLength });
    const headers = new Headers();
    if (contentType) headers.set('content-type', contentType);
    return new Response(bytes, { status, headers });
  } catch (error) {
    log('cad compat failed', { error: error instanceof Error ? error.name : 'error' });
    point({ outcome: 'error', ...(slot ? { step: slot } : {}) });
    return detail(502, COMPAT_DETAIL.unavailable);
  } finally {
    if (leaseId && router) {
      try {
        await router.release(leaseId, release);
      } catch {
        log('cad compat release failed', { slot });
      }
    }
  }
}

export function register(app: Hono<OpsHono>): void {
  app.all(COMPAT_PATH, (c) => handleCadCompat(c.req.raw, c.env, c.var.call));
}
