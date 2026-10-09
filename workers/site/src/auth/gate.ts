// API gate: one decision per resolved /api request (action IDs of ./policy.ts). Each decision checks only the env
// names it needs (missingNames; a missing name answers 500 for that request only). Sentinels never reach the gate.
//
// Answers produced here (handler answers are never rewritten):
//   401 {"error":"unauthorized"}          no API credential where one is required
//   403 {"error":"forbidden"}             a valid credential of an insufficient class, or a data rule
//   403 {"error":"turnstile_failed"}      Turnstile token missing or rejected
//   429 {"error":"rate_limited"}          + Retry-After: 60
//   503 {"error":"auth_unavailable"}      Supabase Auth or a gate lookup unreachable (fail closed)
//   503 {"error":"turnstile_unavailable"} siteverify unreachable, or a test secret on a non-preview host
//   415 / 400 / 409 / 422                 body format and data rules (./body.ts, recipient checks, URL rules)
//   500 text/plain                        a name this decision needs is missing
// Report mode (API_GATES_MODE) turns a refusal of that class into a log line and lets the request through as the
// caller it is (ANON when it has no valid credential); body format rules and the always-on recipient rule of
// partner notifications are never reported.
//
// /api/agent/* (Phase 4, action IDs AG-1…AG-7 of ./policy.ts): a decision carrying a relay header is AG-2 (the
// relay path decides, a session is not considered), any other decision AG-1. Request bodies must have the exact
// shape of workers/shared/src/agent-api.ts, else 400 {"error":"bad_request"} (never reported): the dashboard never
// sends a raw approval token, and the relay never sends a token hash. AG-2 and AG-3 need AGENT_APPROVAL_SECRET
// (AgentSiteEnv, ./agent-hmac.ts): missing, they answer 500 for that request only; every other agent row works
// without it. A refused relay request answers 401 {"error":"unauthorized"}; a refused link or file key 403
// {"error":"forbidden"}, without detail. microns-ops checks the principal, the body and the key again.
//
// Phase 5 (action IDs MK-8 and CD-1 of ./policy.ts):
//   MK-8  /api/marketing?action=send-campaign: any method but POST answers 405 {"error":"method_not_allowed"} with
//         Allow: POST here (never dispatched); POST needs a STAFF or ADMIN session, rate key u:<uid>:send-campaign.
//   CD-1  /api/cad/<token>/flat-pattern (access 'cad-token'): a path of any other shape answers 404
//         {"error":"not_found"} and another method 405 {"error":"method_not_allowed"} with Allow: POST, here and
//         before the token is looked at; the token must equal CAD_COMPAT_TOKEN (./cad-compat.ts; missing secret ->
//         500 for that request only; a wrong token -> 401 {"error":"unauthorized"}, never reported); then the rate
//         key m:cad-compat; the principal is MACHINE:cad-compat. Nothing here logs the path or the token.

import {
  FLAG_EDIT_KEY_RE,
  isDecisionBodyDashboard,
  isDecisionBodyRelay,
  isFlagEditBody,
  isStartBody,
} from '../../../shared/src/agent-api';
import { rateKey } from '../../../shared/src/auth/rate-limit';
import { isAllowedOrigin } from '../../../shared/src/http/cors';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { apiError } from '../../../shared/src/http/json';
import type { Principal } from '../../../shared/src/http/rpc';
import type { ResolvedApi } from '../api/resolve';
import type { Env } from '../env';
import { machineAuth } from './access';
import { hasRelayHeaders, staffFileKey, verifyFileLink, verifyRelayRequest, type AgentSiteEnv } from './agent-hmac';
import { cadCompatTokenOf } from '../api/resolve';
import { checkCadCompatToken, type CadCompatEnv } from './cad-compat';
import { inventoryRequestRules, mailBodyRules } from './body';
import {
  ANONYMOUS_FILE_CONSTRAINTS,
  CUSTOMER_FILE_CONSTRAINTS,
  FOLDER_PREFIX_PATTERN,
  NO_FILE_CONSTRAINTS,
  STAFF_FOLDER_CONSTRAINTS,
  type FileConstraints,
} from './constraints';
import {
  RFQ_NUMBER_RE,
  SERVICE_NAMES,
  UUID_RE,
  activePartnerEmail,
  customerEmailById,
  myRfqIds,
  rfqByNumber,
  rfqCustomerEmail,
  rfqFileVisible,
  sameAddress,
  type RfqRow,
} from './db';
import {
  ACTION_RULES,
  actionIdOf as policyActionIdOf,
  machinesFor,
  parseGateModes,
  userScopeOf,
  type ActionId,
  type GateClass,
  type GateModes,
} from './policy';
import { checkRate } from './rate-limit';
import { userAuth, type UserAuth } from './supabase-jwt';
import { trackingGate } from './tracking';
import { allowlistFor, checkTurnstile } from './turnstile';

export type { ActionId } from './policy';

export type GateOutcome =
  | {
    kind: 'allow';
    actionId: ActionId;
    principal: Principal;
    /** Overrides the function URL the handler sees. */
    functionUrl?: string;
    /** Overrides the body bytes the handler sees. */
    body?: Uint8Array;
    constraints?: FileConstraints;
    openerOrigin?: string;
  }
  /** The gate answers on the handler's behalf. */
  | { kind: 'respond'; actionId: ActionId; response: Response }
  | { kind: 'deny'; actionId: ActionId; response: Response };

const LOG_PREFIX = '[microns-site]';
const ANON: Principal = { class: 'ANON' };
const RFQ_FRESH_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const CLASS_RANK: Readonly<Record<Principal['class'], number>> = { ANON: 0, CUSTOMER: 1, PARTNER: 2, STAFF: 3, ADMIN: 4, MACHINE: -1 };

interface Ctx {
  r: ResolvedApi;
  request: Request;
  env: Env;
  url: URL;
  id: ActionId;
  modes: GateModes;
  ip: string;
  functionUrl?: string;
  body?: Uint8Array;
}

/** null only for sentinels. */
export function actionIdOf(r: ResolvedApi): ActionId | null {
  return policyActionIdOf(r);
}

// ----- outcome helpers -----

function allowWith(c: Ctx, principal: Principal, extra: { constraints?: FileConstraints; openerOrigin?: string } = {}): GateOutcome {
  const out: Extract<GateOutcome, { kind: 'allow' }> = { kind: 'allow', actionId: c.id, principal };
  if (c.functionUrl !== undefined) out.functionUrl = c.functionUrl;
  if (c.body !== undefined) out.body = c.body;
  if (extra.constraints) out.constraints = extra.constraints;
  if (extra.openerOrigin) out.openerOrigin = extra.openerOrigin;
  return out;
}

function denyWith(c: Ctx, response: Response): GateOutcome {
  return { kind: 'deny', actionId: c.id, response };
}

function configDeny(c: Ctx, missing: readonly string[]): GateOutcome {
  return denyWith(c, configError(LOG_PREFIX, missing));
}

/** A refusal of gate class `cls`; null when that class is in report mode (logged, request goes on). */
function refuse(c: Ctx, cls: GateClass | null, status: number, code: string, headers?: HeadersInit): GateOutcome | null {
  if (cls && c.modes[cls] === 'report') {
    console.log(`${LOG_PREFIX} gate would deny ${c.id} ${code}`);
    return null;
  }
  return denyWith(c, apiError(status, code, headers));
}

async function rateCheck(c: Ctx, key: string): Promise<GateOutcome | null> {
  const result = await checkRate(c.env, key);
  if (result.kind === 'config') return configDeny(c, result.missing);
  if (result.kind === 'limited') return refuse(c, 'rate', 429, 'rate_limited', { 'Retry-After': '60' });
  return null;
}

function userRateKey(c: Ctx, principal: Principal): string | null {
  const scope = userScopeOf(c.id, c.r.method);
  return scope && principal.uid ? rateKey('u', principal.uid, scope) : null;
}

function bodyFields(r: ResolvedApi): Record<string, unknown> {
  const value = r.body.ok ? r.body.value : undefined;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function isFresh(createdAt: string | null): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  const now = Date.now();
  return Number.isFinite(created) && created >= now - RFQ_FRESH_MS && created <= now + CLOCK_SKEW_MS;
}

// ----- callers -----

type Caller = { kind: 'ok'; principal: Principal; rateKey: string | null; user: UserAuth } | { kind: 'stop'; outcome: GateOutcome };

/**
 * A signed-in user of at least `min`, or (where the action allows it) a machine caller. Refusals: 503 when Supabase
 * cannot be asked, 403 for a valid credential of the wrong class, else 401.
 */
async function requireCaller(c: Ctx, min: 'STAFF' | 'ADMIN', known?: UserAuth): Promise<Caller> {
  const user = known ?? await userAuth(c.request, c.env);
  if (user.kind === 'config') return { kind: 'stop', outcome: configDeny(c, user.missing) };
  if (user.kind === 'user' && CLASS_RANK[user.principal.class] >= CLASS_RANK[min]) {
    return { kind: 'ok', principal: user.principal, rateKey: userRateKey(c, user.principal), user };
  }
  let wrongClass = user.kind === 'user';
  const access = ACTION_RULES[c.id].access;
  if (access === 'staff' || access === 'admin') {
    const machine = await machineAuth(c.request, c.env, c.url);
    if (machine.kind === 'config') return { kind: 'stop', outcome: configDeny(c, machine.missing) };
    if (machine.kind === 'machine') {
      if (machinesFor(c.id, c.r.action).includes(machine.name)) {
        return { kind: 'ok', principal: machine.principal, rateKey: rateKey('m', machine.name, c.r.endpoint), user };
      }
      wrongClass = true;
    }
  }
  let refusal: GateOutcome | null;
  if (user.kind === 'unavailable') refusal = refuse(c, 'auth', 503, 'auth_unavailable');
  else if (wrongClass) refusal = refuse(c, 'auth', 403, 'forbidden');
  else refusal = refuse(c, 'auth', 401, 'unauthorized');
  if (refusal) return { kind: 'stop', outcome: refusal };
  return { kind: 'ok', principal: user.kind === 'user' ? user.principal : ANON, rateKey: null, user };
}

async function callerWithRate(c: Ctx, min: 'STAFF' | 'ADMIN', known?: UserAuth): Promise<Caller> {
  const caller = await requireCaller(c, min, known);
  if (caller.kind === 'ok' && caller.rateKey) {
    const limited = await rateCheck(c, caller.rateKey);
    if (limited) return { kind: 'stop', outcome: limited };
  }
  return caller;
}

async function staffGate(c: Ctx, min: 'STAFF' | 'ADMIN' = 'STAFF'): Promise<GateOutcome> {
  const caller = await callerWithRate(c, min);
  return caller.kind === 'stop' ? caller.outcome : allowWith(c, caller.principal);
}

// ----- /api/emails -----

async function turnstileStep(c: Ctx, actions: readonly string[]): Promise<GateOutcome | null> {
  const check = await checkTurnstile(c.request, c.env, c.url, actions);
  if (check.kind === 'config') return configDeny(c, check.missing);
  if (check.kind === 'deny') return refuse(c, check.testSecretRefused ? null : 'turnstile', check.status, check.code);
  return null;
}

async function mailRateSteps(c: Ctx, recipient: unknown): Promise<GateOutcome | null> {
  const formLimited = await rateCheck(c, rateKey('form', c.ip));
  if (formLimited) return formLimited;
  if (typeof recipient === 'string' && recipient) {
    return rateCheck(c, rateKey('rcpt', await sha256Hex(recipient.toLowerCase())));
  }
  return null;
}

function applyMailBodyRules(c: Ctx): GateOutcome | null {
  const result = mailBodyRules(c.r, c.request.headers.get('content-type'));
  if (!result.ok) return denyWith(c, result.response);
  if (result.body) c.body = result.body;
  return null;
}

async function publicMailGate(c: Ctx): Promise<GateOutcome> {
  const bodyRefusal = applyMailBodyRules(c);
  if (bodyRefusal) return bodyRefusal;
  const turnstile = await turnstileStep(c, ACTION_RULES[c.id].turnstileActions ?? []);
  if (turnstile) return turnstile;
  const limited = await mailRateSteps(c, bodyFields(c.r).email);
  if (limited) return limited;
  return allowWith(c, ANON);
}

async function rfqMailGate(c: Ctx): Promise<GateOutcome> {
  const bodyRefusal = applyMailBodyRules(c);
  if (bodyRefusal) return bodyRefusal;
  const fields = bodyFields(c.r);
  const user = await userAuth(c.request, c.env);
  if (user.kind === 'config') return configDeny(c, user.missing);

  const staff = user.kind === 'user' && CLASS_RANK[user.principal.class] >= CLASS_RANK.STAFF;
  let principal: Principal = ANON;
  if (staff) {
    principal = user.principal;
    const key = userRateKey(c, principal);
    const limited = key ? await rateCheck(c, key) : null;
    if (limited) return limited;
  } else {
    const turnstile = await turnstileStep(c, ACTION_RULES[c.id].turnstileActions ?? []);
    if (turnstile) return turnstile;
    const limited = await mailRateSteps(c, fields.customerEmail);
    if (limited) return limited;
  }

  // The handler answers 400 before sending anything when a required field is missing.
  const { customerName, customerEmail, companyName, rfqNumber } = fields;
  if (!customerName || !customerEmail || !companyName || !rfqNumber) return allowWith(c, principal);

  const missing = missingNames(c.env, SERVICE_NAMES);
  if (missing.length) return configDeny(c, missing);
  const rfq = await rfqByNumber(c.env, String(rfqNumber));
  if (rfq === 'unavailable') return refuse(c, 'data', 503, 'auth_unavailable') ?? allowWith(c, principal);
  if (!rfq) return refuse(c, 'data', 422, 'recipient_mismatch') ?? allowWith(c, principal);
  if (!staff && !isFresh(rfq.createdAt)) {
    const stale = refuse(c, 'data', 403, 'forbidden');
    if (stale) return stale;
  }
  const email = await customerEmailById(c.env, rfq.customerId);
  if (email === 'unavailable') return refuse(c, 'data', 503, 'auth_unavailable') ?? allowWith(c, principal);
  if (!email || !sameAddress(email, String(customerEmail))) {
    return refuse(c, 'data', 422, 'recipient_mismatch') ?? allowWith(c, principal);
  }
  return allowWith(c, principal);
}

async function rfqPdfGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const { customerName, customerEmail, companyName, rfqNumber, pdfBase64 } = bodyFields(c.r);
  if (!customerName || !customerEmail || !companyName || !rfqNumber || !pdfBase64) return allowWith(c, caller.principal);

  const missing = missingNames(c.env, SERVICE_NAMES);
  if (missing.length) return configDeny(c, missing);
  const email = typeof rfqNumber === 'string' ? await rfqCustomerEmail(c.env, rfqNumber) : null;
  if (email === 'unavailable') return refuse(c, 'recipient', 503, 'auth_unavailable') ?? allowWith(c, caller.principal);
  if (!email || typeof customerEmail !== 'string' || !sameAddress(email, customerEmail)) {
    return refuse(c, 'recipient', 422, 'recipient_mismatch') ?? allowWith(c, caller.principal);
  }
  return allowWith(c, caller.principal);
}

// ----- /api/s3 -----

/** The body as the files handler reads it: a string is parsed as JSON, anything falsy is {}. */
function s3Fields(r: ResolvedApi): Record<string, unknown> {
  const value = r.body.ok ? r.body.value : undefined;
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function folderGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const { prefix } = s3Fields(c.r);
  // A missing prefix is answered by the handler ("prefix is required").
  if (prefix && (typeof prefix !== 'string' || !FOLDER_PREFIX_PATTERN.test(prefix))) {
    const refusal = refuse(c, 'data', 400, 'invalid_prefix');
    if (refusal) return refusal;
    return allowWith(c, caller.principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  return allowWith(c, caller.principal, { constraints: STAFF_FOLDER_CONSTRAINTS });
}

/** presign-download and delete: staff any key; a customer (and, for downloads, a partner) only keys of rows it sees. */
async function keyGate(c: Ctx, partnersAllowed: boolean): Promise<GateOutcome> {
  const user = await userAuth(c.request, c.env);
  if (user.kind === 'config') return configDeny(c, user.missing);
  if (user.kind === 'user' && CLASS_RANK[user.principal.class] >= CLASS_RANK.STAFF) {
    const key = userRateKey(c, user.principal);
    const limited = key ? await rateCheck(c, key) : null;
    return limited ?? allowWith(c, user.principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  if (user.kind !== 'user') {
    const refusal = user.kind === 'unavailable' ? refuse(c, 'auth', 503, 'auth_unavailable') : refuse(c, 'auth', 401, 'unauthorized');
    return refusal ?? allowWith(c, ANON, { constraints: NO_FILE_CONSTRAINTS });
  }
  const { principal } = user;
  if (principal.class === 'PARTNER' && !partnersAllowed) {
    return refuse(c, 'auth', 403, 'forbidden') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  const rate = userRateKey(c, principal);
  const limited = rate ? await rateCheck(c, rate) : null;
  if (limited) return limited;
  const { key } = s3Fields(c.r);
  // A missing key is answered by the handler ("key is required").
  if (!key) return allowWith(c, principal, { constraints: CUSTOMER_FILE_CONSTRAINTS });
  if (typeof key !== 'string') {
    return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  const visible = await rfqFileVisible(c.env, user.token, key);
  if (visible === 'unavailable') {
    return refuse(c, 'data', 503, 'auth_unavailable') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  if (!visible) return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
  return allowWith(c, principal, { constraints: CUSTOMER_FILE_CONSTRAINTS });
}

/** presign-upload: staff anywhere; a customer into its own RFQs; anyone into an RFQ created in the last 30 min. */
async function uploadGate(c: Ctx): Promise<GateOutcome> {
  const user = await userAuth(c.request, c.env);
  if (user.kind === 'config') return configDeny(c, user.missing);
  if (user.kind === 'unavailable') {
    const refusal = refuse(c, 'auth', 503, 'auth_unavailable');
    if (refusal) return refusal;
  }
  if (user.kind === 'user' && CLASS_RANK[user.principal.class] >= CLASS_RANK.STAFF) {
    const key = userRateKey(c, user.principal);
    const limited = key ? await rateCheck(c, key) : null;
    return limited ?? allowWith(c, user.principal, { constraints: NO_FILE_CONSTRAINTS });
  }
  const signedIn = user.kind === 'user' ? user : null;
  const principal = signedIn ? signedIn.principal : ANON;
  const limited = await rateCheck(c, signedIn ? (userRateKey(c, principal) ?? rateKey('upl', c.ip)) : rateKey('upl', c.ip));
  if (limited) return limited;

  const fields = s3Fields(c.r);
  // A missing file name is answered by the handler ("fileName is required").
  if (!fields.fileName) return allowWith(c, principal, { constraints: signedIn ? CUSTOMER_FILE_CONSTRAINTS : ANONYMOUS_FILE_CONSTRAINTS });

  const segment = typeof fields.prefix === 'string' ? fields.prefix.split('/')[0] : '';
  const isNumber = RFQ_NUMBER_RE.test(segment);
  let rfq: RfqRow | null | undefined;
  if (isNumber) {
    const missing = missingNames(c.env, SERVICE_NAMES);
    if (missing.length) return configDeny(c, missing);
    const found = await rfqByNumber(c.env, segment);
    if (found === 'unavailable') return refuse(c, 'data', 503, 'auth_unavailable') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
    rfq = found;
  }

  if (signedIn && (isNumber || UUID_RE.test(segment))) {
    const rfqId = isNumber ? rfq?.id : segment;
    if (rfqId) {
      const owned = await myRfqIds(c.env, signedIn.token);
      if (owned === 'unavailable') return refuse(c, 'data', 503, 'auth_unavailable') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
      if (owned.has(rfqId.toLowerCase())) return allowWith(c, principal, { constraints: CUSTOMER_FILE_CONSTRAINTS });
    }
  }
  if (rfq && isFresh(rfq.createdAt)) return allowWith(c, principal, { constraints: ANONYMOUS_FILE_CONSTRAINTS });
  return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, principal, { constraints: NO_FILE_CONSTRAINTS });
}

async function articlesOrListGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  return caller.kind === 'stop' ? caller.outcome : allowWith(c, caller.principal, { constraints: NO_FILE_CONSTRAINTS });
}

// ----- /api/marketing google-auth -----

function openerOriginOf(c: Ctx): string | undefined {
  const origin = c.url.origin;
  return isAllowedOrigin(origin, allowlistFor(c.url, c.env)) ? origin : undefined;
}

async function oauthAuthorizeGate(c: Ctx): Promise<GateOutcome> {
  const user = await userAuth(c.request, c.env);
  if (user.kind === 'config') return configDeny(c, user.missing);
  if (user.kind === 'user' && user.principal.class === 'ADMIN') {
    const key = userRateKey(c, user.principal);
    const limited = key ? await rateCheck(c, key) : null;
    return limited ?? allowWith(c, user.principal, { openerOrigin: openerOriginOf(c) });
  }
  // A JSON request (the dashboard's fetch) is refused here; a page navigation goes on to the sign-in page.
  const wantsJson = (c.request.headers.get('accept') ?? '').toLowerCase().includes('application/json');
  if (wantsJson) {
    const refusal = user.kind === 'unavailable'
      ? refuse(c, 'auth', 503, 'auth_unavailable')
      : user.kind === 'user' ? refuse(c, 'auth', 403, 'forbidden') : refuse(c, 'auth', 401, 'unauthorized');
    if (refusal) return refusal;
  }
  return allowWith(c, user.kind === 'user' ? user.principal : ANON);
}

const LS = String.fromCharCode(0x2028);
const LINE_SEPARATORS = new RegExp(`[${LS}${String.fromCharCode(0x2029)}]`, 'g');

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATORS, (ch) => (ch === LS ? '\\u2028' : '\\u2029'));
}

/** 429 page of the OAuth callback (a popup): tells the opening page, then closes. */
export function oauthRateLimitedPage(siteOrigin: string): Response {
  const html = `<!DOCTYPE html>
<html><head><title>Google Connection Failed</title></head>
<body>
<p>Too many attempts. Please wait a minute and try again. This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google-oauth-error', error: 'rate_limited' }, ${jsonForScript(siteOrigin)});
    window.close();
  }
</script>
</body></html>`;
  return new Response(html, {
    status: 429,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' },
  });
}

async function oauthCallbackGate(c: Ctx): Promise<GateOutcome> {
  const result = await checkRate(c.env, rateKey('oauth', c.ip));
  if (result.kind === 'config') return configDeny(c, result.missing);
  if (result.kind === 'limited') {
    if (c.modes.rate === 'report') console.log(`${LOG_PREFIX} gate would deny ${c.id} rate_limited`);
    else return denyWith(c, oauthRateLimitedPage(c.env.SITE_ORIGIN));
  }
  return allowWith(c, ANON);
}

// ----- /api/notifications -----

async function partnerGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const { partnerEmail, partnerName, orderId, orderTitle, startDate, deliveryDate } = bodyFields(c.r);
  if (!partnerEmail || !partnerName || !orderId || !orderTitle || !startDate || !deliveryDate) return allowWith(c, caller.principal);
  // The recipient of a partner notification must be an active production partner (never reported).
  if (typeof partnerEmail !== 'string') return denyWith(c, apiError(422, 'recipient_mismatch'));
  const missing = missingNames(c.env, SERVICE_NAMES);
  if (missing.length) return configDeny(c, missing);
  const known = await activePartnerEmail(c.env, partnerEmail);
  if (known === 'unavailable') return denyWith(c, apiError(503, 'auth_unavailable'));
  if (!known) return denyWith(c, apiError(422, 'recipient_mismatch'));
  return allowWith(c, caller.principal);
}

async function inventoryGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const rules = inventoryRequestRules(c.r, c.request.headers.get('content-type'));
  if (!rules.ok) return denyWith(c, rules.response);
  if (rules.functionUrl !== undefined) c.functionUrl = rules.functionUrl;
  if (rules.body !== undefined) c.body = rules.body;
  return allowWith(c, caller.principal);
}

// ----- staff tools -----

async function fundedScanGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const { priority } = bodyFields(c.r);
  if (priority !== undefined && priority !== null && priority !== '' && !/^[1-3]$/.test(String(priority))) {
    const refusal = refuse(c, 'data', 400, 'invalid_field');
    if (refusal) return refusal;
  }
  return allowWith(c, caller.principal);
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const DIRECTORY_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:europages|wlw)\.(?:co\.uk|com|[a-z]{2})$/;

function parsedHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Public web hosts only: no IP literals, no single-label or local names, none of our own or platform hosts. */
export function scrapeTargetAllowed(value: unknown, env: Env): boolean {
  const url = parsedHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || IPV4_RE.test(host)) return false;
  let zone = 'micronshub.eu';
  try {
    zone = new URL(env.SITE_ORIGIN).hostname.toLowerCase().replace(/^www\./, '') || zone;
  } catch {
    // keep the default zone
  }
  const blocked = ['localhost', zone, 'micronshub.eu', 'workers.dev', 'vercel.app'];
  return !blocked.some((b) => host === b || host.endsWith(`.${b}`));
}

/** Europages and wlw directory hosts. */
export function directoryTargetAllowed(value: unknown): boolean {
  const url = parsedHttpUrl(value);
  return !!url && DIRECTORY_HOST_RE.test(url.hostname.toLowerCase().replace(/\.$/, ''));
}

async function scrapeGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const fields = bodyFields(c.r);
  let allowed = true;
  if (c.id === 'SC-1') {
    const { urls } = fields;
    // Shapes the handler refuses itself (not an array, empty, more than 25) go through unchanged.
    if (Array.isArray(urls) && urls.length > 0 && urls.length <= 25) allowed = urls.every((u) => scrapeTargetAllowed(u, c.env));
  } else if (fields.url) {
    allowed = directoryTargetAllowed(fields.url);
  }
  if (!allowed) {
    const refusal = refuse(c, 'data', 400, 'url_not_allowed');
    if (refusal) return refusal;
  }
  return allowWith(c, caller.principal);
}

// ----- /api/agent/* (Phase 4) -----

const RELAY: Principal = { class: 'MACHINE', machine: 'telegram' };

/** The request body as JSON (whatever the Content-Type), or undefined when it is not JSON. */
function agentJsonBody(r: ResolvedApi): unknown {
  if (r.bodyBytes.byteLength === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(r.bodyBytes)) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function singleQuery(r: ResolvedApi, name: string): string {
  const value = r.query[name];
  return typeof value === 'string' ? value : '';
}

/** Body format refusal of the agent rows (never reported). */
function badAgentBody(c: Ctx): GateOutcome {
  return denyWith(c, apiError(400, 'bad_request'));
}

function approvalSecret(c: Ctx): string | undefined {
  const value = (c.env as AgentSiteEnv).AGENT_APPROVAL_SECRET;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** AG-1: a staff session deciding with run_id + token_sha256. */
async function dashboardDecisionGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const body = agentJsonBody(c.r);
  // A raw approval token is a relay credential; a session never presents one.
  if (isRecord(body) && Object.prototype.hasOwnProperty.call(body, 'token')) return badAgentBody(c);
  if (!isDecisionBodyDashboard(body)) return badAgentBody(c);
  return allowWith(c, caller.principal);
}

/** AG-2: the Telegram relay's signed request with the raw token and the button code. */
async function relayDecisionGate(c: Ctx): Promise<GateOutcome> {
  const secret = approvalSecret(c);
  if (!secret) return configDeny(c, ['AGENT_APPROVAL_SECRET']);
  const check = await verifyRelayRequest(c.request.headers, c.r.bodyBytes, secret, Date.now());
  if (!check.ok) {
    console.log(`${LOG_PREFIX} gate relay_refused ${check.reason}`);
    return refuse(c, 'auth', 401, 'unauthorized') ?? allowWith(c, ANON);
  }
  const limited = await rateCheck(c, rateKey('m', 'telegram', 'agent'));
  if (limited) return limited;
  const body = agentJsonBody(c.r);
  // A token hash is the dashboard's reference; the relay presents the raw token only.
  if (isRecord(body) && Object.prototype.hasOwnProperty.call(body, 'token_sha256')) return badAgentBody(c);
  if (!isDecisionBodyRelay(body)) return badAgentBody(c);
  return allowWith(c, RELAY);
}

/** AG-3: a signed partner download link (no session). */
async function signedFileGate(c: Ctx): Promise<GateOutcome> {
  const secret = approvalSecret(c);
  if (!secret) return configDeny(c, ['AGENT_APPROVAL_SECRET']);
  const limited = await rateCheck(c, ['file', c.ip].join(':'));
  if (limited) return limited;
  const valid = await verifyFileLink(secret, singleQuery(c.r, 'k'), singleQuery(c.r, 'exp'), singleQuery(c.r, 'sig'), Date.now());
  if (!valid) return refuse(c, 'auth', 403, 'forbidden') ?? allowWith(c, ANON);
  return allowWith(c, ANON);
}

/** AG-4: an admin editing an agent flag (agent.* or mcp.remote; never 'auto' for quote or post-order). */
async function flagEditGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'ADMIN');
  if (caller.kind === 'stop') return caller.outcome;
  const body = agentJsonBody(c.r);
  if (!isRecord(body)) return badAgentBody(c);
  if (typeof body.key === 'string' && !FLAG_EDIT_KEY_RE.test(body.key)) {
    return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, caller.principal);
  }
  if (!isFlagEditBody(body)) return badAgentBody(c);
  if (body.writes !== undefined && body.key !== 'mcp.remote') return badAgentBody(c);
  if (body.mode === 'auto' && (body.key === 'agent.quote' || body.key === 'agent.post_order')) {
    return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, caller.principal);
  }
  return allowWith(c, caller.principal);
}

/** AG-6: staff starting a quote or an intake run; the relay test card is admin only. */
async function startGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  const body = agentJsonBody(c.r);
  if (!isStartBody(body)) return badAgentBody(c);
  if (body.kind === 'test_card' && caller.principal.class !== 'ADMIN') {
    return refuse(c, 'auth', 403, 'forbidden') ?? allowWith(c, caller.principal);
  }
  return allowWith(c, caller.principal);
}

/** AG-7: a staff preview of a stored artefact under the fixed key patterns. */
async function staffFileGate(c: Ctx): Promise<GateOutcome> {
  const caller = await callerWithRate(c, 'STAFF');
  if (caller.kind === 'stop') return caller.outcome;
  if (staffFileKey(c.url.search) === null) return refuse(c, 'data', 403, 'forbidden') ?? allowWith(c, caller.principal);
  return allowWith(c, caller.principal);
}

// ----- Phase 5: marketing send-campaign (MK-8), CAD compat path (CD-1) -----

const CAD_COMPAT: Principal = { class: 'MACHINE', machine: 'cad-compat' };

/** 405 with Allow: POST (a new POST-only action; never dispatched). */
function postOnly(c: Ctx): GateOutcome {
  return denyWith(c, apiError(405, 'method_not_allowed', { Allow: 'POST' }));
}

/** MK-8: a staff session starting a campaign send. */
async function sendCampaignGate(c: Ctx): Promise<GateOutcome> {
  if (c.r.method !== 'POST') return postOnly(c);
  return staffGate(c);
}

/** CD-1: the CAD compat token in the request path. */
async function cadCompatGate(c: Ctx): Promise<GateOutcome> {
  if (c.r.action === 'not-found') return denyWith(c, apiError(404, 'not_found'));
  if (c.r.action !== 'flat-pattern' || c.r.method !== 'POST') return postOnly(c);
  const token = cadCompatTokenOf(c.url.pathname);
  if (token === null) return denyWith(c, apiError(404, 'not_found'));
  const check = await checkCadCompatToken(c.env as CadCompatEnv, token);
  if (check === 'not_configured') return configDeny(c, ['CAD_COMPAT_TOKEN']);
  if (check !== 'ok') return denyWith(c, apiError(401, 'unauthorized'));
  const limited = await rateCheck(c, rateKey('m', 'cad-compat'));
  if (limited) return limited;
  return allowWith(c, CAD_COMPAT);
}

// ----- entry point -----

export async function applyGate(r: ResolvedApi, request: Request, env: Env, ctx: ExecutionContext): Promise<GateOutcome> {
  void ctx;
  const policyId = actionIdOf(r);
  // Sentinels are dispatched before the gate; anything else without an ID is a resolver/policy mismatch.
  if (!policyId) throw new Error(`gate: no action id for endpoint ${r.endpoint}`);
  // A decision with a relay header is the relay's (AG-2).
  const id: ActionId = policyId === 'AG-1' && hasRelayHeaders(request.headers) ? 'AG-2' : policyId;
  const c: Ctx = {
    r,
    request,
    env,
    url: new URL(request.url),
    id,
    modes: parseGateModes(env.API_GATES_MODE),
    ip: request.headers.get('CF-Connecting-IP') ?? 'unknown',
  };

  switch (id) {
    case 'EM-1':
    case 'EM-2':
      return publicMailGate(c);
    case 'EM-3':
      return rfqMailGate(c);
    case 'EM-4':
      return rfqPdfGate(c);
    case 'S3-1':
      return uploadGate(c);
    case 'S3-2':
      return keyGate(c, true);
    case 'S3-3':
      return keyGate(c, false);
    case 'S3-4':
      return folderGate(c);
    case 'S3-5':
    case 'S3-6':
      return articlesOrListGate(c);
    case 'MK-1': {
      const result = await trackingGate(r, env, c.modes);
      if (result.kind === 'config') return configDeny(c, result.missing);
      if (result.kind === 'respond') return { kind: 'respond', actionId: id, response: result.response };
      if (result.functionUrl !== undefined) c.functionUrl = result.functionUrl;
      return allowWith(c, ANON);
    }
    case 'MK-2':
    case 'MK-6':
      return allowWith(c, ANON);
    case 'MK-3':
      return oauthAuthorizeGate(c);
    case 'MK-4':
      return oauthCallbackGate(c);
    case 'MK-5':
      return staffGate(c, 'ADMIN');
    case 'NT-1':
      return partnerGate(c);
    case 'NT-4':
    case 'NT-5':
    case 'NT-6':
      return inventoryGate(c);
    case 'NT-7':
      return staffGate(c, 'ADMIN');
    case 'FS-2':
      return fundedScanGate(c);
    case 'SC-1':
    case 'SC-2':
    case 'SC-3':
      return scrapeGate(c);
    case 'MK-7':
    case 'NT-2':
    case 'NT-3':
    case 'GS-1':
    case 'TD-1':
    case 'TD-2':
    case 'TS-1':
    case 'FS-1':
    case 'FS-3':
      return staffGate(c);
    case 'AG-1':
      return dashboardDecisionGate(c);
    case 'AG-2':
      return relayDecisionGate(c);
    case 'AG-3':
      return signedFileGate(c);
    case 'AG-4':
      return flagEditGate(c);
    case 'AG-5':
      return staffGate(c);
    case 'AG-6':
      return startGate(c);
    case 'AG-7':
      return staffFileGate(c);
    case 'MK-8':
      return sendCampaignGate(c);
    case 'CD-1':
      return cadCompatGate(c);
  }
}
