// /api/agent/* in microns-ops (endpoint 'agent'; the site resolves the action, gates the caller and never forwards
// these paths to Vercel).
//
//   decision  POST  dashboard (staff JWT) or relay (signed) -> decide() (src/agents/decision.ts)
//   file      GET   signed partner link (k, exp, sig) here; staff preview -> handleStaffFile
//   status, flag, start -> src/routes/agent-admin.ts
// Answers are JSON with Cache-Control: no-store (file: the object stream). Errors use {"error": <AgentApiError>}.
//
// Rules
//   - The principal comes from the OpsCall the site built (c.var.call), never from a header. A decision from the
//     relay principal (MACHINE 'telegram') must carry DecisionBodyRelay and decides on channel 'telegram' as
//     'telegram:<tg.user_id>'; a decision from STAFF or ADMIN must carry DecisionBodyDashboard and decides on channel
//     'dashboard' as 'user:<uid>'; any other principal or body shape is refused.
//   - Request bodies above 65,536 bytes answer 413; a method other than the action's answers 405 with Allow.
//   - Signed partner file links: sig = base64url(HMAC-SHA256(K, k + '|' + exp)) with K derived by HKDF-SHA256 from
//     AGENT_APPROVAL_SECRET (empty salt, info 'microns-file-link-v1', 256-bit HMAC key); exp is unix seconds, in
//     the future and at most 7 days ahead; k is a traveller PDF of an order or a drawing PDF / flat DXF of a CAD
//     job; the key must belong to an order with a production partner. Every refusal answers 403
//     {"error":"forbidden"} without detail. The object is sent as an attachment with Cache-Control
//     'private, no-store' and X-Robots-Tag 'noindex'.
//   - Log lines carry the action, outcome and run id only (never a token, hash, signature or key).

import type { Context, Hono } from 'hono';
import { isDecisionBodyDashboard, isDecisionBodyRelay, type AgentAction, type AgentApiError } from '../../../shared/src/agent-api';
import { jsonResponse } from '../../../shared/src/http/json';
import { formatLogLine } from '../../../shared/src/http/log';
import { DECIDE_STATUS, decide, type DecideInput } from '../agents/decision';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';
import { makePorts, type Ports } from '../ports/index';
import { handleFlag, handleStaffFile, handleStart, handleStatus } from './agent-admin';

/** Function path of every action: /api/agent/<action>. */
export const AGENT_ROUTE = '/api/agent/*';

export const AGENT_BODY_MAX_BYTES = 65_536;

/** Method of each action. */
export const AGENT_METHODS: Readonly<Record<AgentAction, 'GET' | 'POST'>> = Object.freeze({
  decision: 'POST',
  status: 'GET',
  flag: 'POST',
  start: 'POST',
  file: 'GET',
});

export const FILE_LINK_INFO = 'microns-file-link-v1';
export const FILE_LINK_MAX_SECONDS = 7 * 24 * 3600;
export const FILE_LINK_KEY_RE = /^(orders\/([0-9a-f-]{36})\/traveler\.pdf|cad\/([0-9a-f-]{36})\/output\/(drawing\.pdf|flat\.dxf))$/;

const NO_STORE = { 'Cache-Control': 'no-store' };

function agentJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return jsonResponse(status, body, { ...NO_STORE, ...headers });
}

function agentError(status: number, error: AgentApiError, headers: Record<string, string> = {}): Response {
  return agentJson(status, { error }, headers);
}

// ----- signed file links -----

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The HMAC key of file links, derived from AGENT_APPROVAL_SECRET (HKDF-SHA256, empty salt, info FILE_LINK_INFO). */
export async function fileLinkKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(FILE_LINK_INFO) },
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/** sig of a file link (base64url, no padding). */
export async function fileLinkSignature(secret: string, key: string, exp: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await fileLinkKey(secret), new TextEncoder().encode(`${key}|${exp}`));
  return base64Url(new Uint8Array(mac));
}

/** A signed partner download link for an R2 key, valid until `expiresAt` (at most 7 days ahead). */
export async function signedFileUrl(env: Pick<OpsEnv, 'AGENT_APPROVAL_SECRET' | 'SITE_ORIGIN'>, key: string, expiresAt: Date, now: Date = new Date()): Promise<string> {
  if (!env.AGENT_APPROVAL_SECRET) throw new Error('AGENT_APPROVAL_SECRET is not configured');
  if (!FILE_LINK_KEY_RE.test(key)) throw new Error('signedFileUrl: key is not a partner file');
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const nowS = Math.floor(now.getTime() / 1000);
  if (exp <= nowS || exp > nowS + FILE_LINK_MAX_SECONDS) throw new Error('signedFileUrl: expiry must be within 7 days');
  const sig = await fileLinkSignature(env.AGENT_APPROVAL_SECRET, key, exp);
  const q = new URLSearchParams({ k: key, exp: String(exp), sig });
  return `${env.SITE_ORIGIN.replace(/\/+$/, '')}/api/agent/file?${q}`;
}

/** True when the link parameters carry a valid signature and expiry (constant-time comparison by HMAC verify). */
export async function verifyFileLink(secret: string, key: string, expText: string, sig: string, now: Date): Promise<boolean> {
  if (!FILE_LINK_KEY_RE.test(key) || !/^\d{1,12}$/.test(expText)) return false;
  const exp = Number(expText);
  const nowS = Math.floor(now.getTime() / 1000);
  if (exp <= nowS || exp > nowS + FILE_LINK_MAX_SECONDS) return false;
  const mac = base64UrlBytes(sig);
  if (!mac || mac.length !== 32) return false;
  return crypto.subtle.verify('HMAC', await fileLinkKey(secret), mac, new TextEncoder().encode(`${key}|${exp}`));
}

/** True when the key belongs to an order that has a production partner. */
async function belongsToPartnerOrder(ports: Ports, key: string): Promise<boolean> {
  const match = FILE_LINK_KEY_RE.exec(key);
  if (!match) return false;
  if (match[2]) {
    const orders = await ports.db.select('orders', { columns: 'id,partner_id', filters: [['id', 'eq', match[2]]], limit: 1 });
    return orders.length === 1 && orders[0].partner_id !== null && orders[0].partner_id !== undefined;
  }
  const jobs = await ports.db.select<{ rfq_id: string | null }>('cad_jobs', { columns: 'rfq_id', filters: [['id', 'eq', match[3]]], limit: 1 });
  const rfqId = jobs[0]?.rfq_id;
  if (!rfqId) return false;
  const orders = await ports.db.select('orders', { columns: 'id,partner_id', filters: [['rfq_id', 'eq', rfqId]], limit: 20 });
  return orders.some((o) => o.partner_id !== null && o.partner_id !== undefined);
}

async function signedFile(c: Context<OpsHono>, ports: Ports): Promise<Response> {
  const forbidden = () => agentError(403, 'forbidden');
  const url = new URL(c.req.url);
  const key = url.searchParams.get('k') ?? '';
  const exp = url.searchParams.get('exp') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  const secret = c.env.AGENT_APPROVAL_SECRET;
  if (!secret) {
    console.error(formatLogLine(LOG_PREFIX, 'agent config missing', { names: 'AGENT_APPROVAL_SECRET' }));
    return forbidden();
  }
  if (!(await verifyFileLink(secret, key, exp, sig, ports.clock.now()))) return forbidden();
  if (!(await belongsToPartnerOrder(ports, key))) return forbidden();
  const object = await ports.blob.get(key);
  if (!object) return forbidden();
  const name = key.slice(key.lastIndexOf('/') + 1);
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': object.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ----- decision -----

async function readJsonBody(c: Context<OpsHono>): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > AGENT_BODY_MAX_BYTES) return { ok: false, response: agentError(413, 'payload_too_large') };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: agentError(400, 'bad_request') };
  }
}

async function decision(c: Context<OpsHono>, ports: Ports): Promise<Response> {
  const principal = c.var.call.principal;
  const read = await readJsonBody(c);
  if (!read.ok) return read.response;
  let input: DecideInput;
  if (principal.class === 'MACHINE' && principal.machine === 'telegram') {
    if (!isDecisionBodyRelay(read.body)) return agentError(400, 'bad_request');
    const b = read.body;
    input = { channel: 'telegram', actor: `telegram:${b.tg.user_id}`, token: b.token, code: b.code };
  } else if ((principal.class === 'STAFF' || principal.class === 'ADMIN') && principal.uid) {
    if (!isDecisionBodyDashboard(read.body)) return agentError(400, 'bad_request');
    const b = read.body;
    input = { channel: 'dashboard', actor: `user:${principal.uid}`, run_id: b.run_id, token_sha256: b.token_sha256, verb: b.verb };
    if (b.edits !== undefined) input.edits = b.edits;
    if (b.note !== undefined) input.note = b.note;
  } else {
    return agentError(403, 'forbidden');
  }
  const result = await decide(c.env, ports, input);
  if (!result.ok) {
    console.log(formatLogLine(LOG_PREFIX, 'decision refused', { channel: input.channel, error: result.error }));
    return agentError(DECIDE_STATUS[result.error], result.error);
  }
  return agentJson(200, result.result);
}

/** The handler of every /api/agent/* request; portsFor builds the ports of the request (tests pass fakes). */
export function createAgentHandler(portsFor: (env: OpsEnv) => Ports = (env) => makePorts(env)) {
  return async function handleAgent(c: Context<OpsHono>): Promise<Response> {
    const action = c.var.call.action as AgentAction;
    const method = AGENT_METHODS[action];
    if (!method) return agentError(404, 'not_found');
    if (c.req.method !== method) return agentError(405, 'method_not_allowed', { Allow: method });
    switch (action) {
      case 'decision':
        return decision(c, portsFor(c.env));
      case 'file': {
        const query = new URL(c.req.url).searchParams;
        if (query.has('sig')) return signedFile(c, portsFor(c.env));
        const principal = c.var.call.principal;
        if (principal.class === 'STAFF' || principal.class === 'ADMIN') return handleStaffFile(c);
        return agentError(403, 'forbidden');
      }
      case 'status':
        return handleStatus(c);
      case 'flag':
        return handleFlag(c);
      case 'start':
        return handleStart(c);
    }
  };
}

export const handleAgent = createAgentHandler();

export function register(app: Hono<OpsHono>): void {
  app.all(AGENT_ROUTE, handleAgent);
}
