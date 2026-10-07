// Staff and admin actions of /api/agent/* served by microns-ops (called from src/routes/agent.ts):
//   status  GET   STAFF or ADMIN        AgentStatus
//   flag    POST  ADMIN                 FlagEditBody -> FlagEditResult (feature_flags row, then KV write-through)
//   start   POST  STAFF or ADMIN        StartBody -> StartResult ('test_card' ADMIN only)
//   file    GET   STAFF or ADMIN        staff preview of an R2 object under the fixed key patterns
// The principal comes from the OpsCall the site built (c.var.call), never from a request header. The site gate
// checks the same rules first (workers/site/src/auth/gate.ts, AG-4…AG-7); every rule is checked here again.
//
// Answers are JSON {"v":1,"ok":true,…} or {"error": <AgentApiError>}, always with Cache-Control: no-store (file:
// the object stream with Cache-Control: private, no-store). Request bodies above 65,536 bytes answer 413.
//
// status   actions the caller may use: ['decision', 'start', 'file'], plus 'flag' for ADMIN; no database call.
// flag     key agent.* or mcp.remote, else 403; the row must exist (404); 'mode' only where the row's value has a
//          mode (400); 'auto' refused for agent.quote and agent.post_order (403); 'writes' only for mcp.remote (400).
//          One PATCH filtered by key, tenant and rev = expected_rev with enabled, the merged value and updated_by =
//          the caller's uid; no row -> 409 'stale'. Then the write-through of the new row (feature_flags_kv_key,
//          feature_flags_kv_value, FLAGS.put, feature_flags_mark_synced): kv 'written', or 'pending' when KV is not
//          bound, the put fails or the row changed meanwhile (the every-minute flags-sync converges).
// start    quote       agent.quote on (else 409 flag_off); the RFQ exists (404); no active quote_workflows row of
//                      the RFQ (409 active_quote_exists); version n = highest quote_version + 1 (1 when none);
//                      QUOTE.create('quote-<rfq_id>-v<n>'); "already exists" -> created false.
//          rfq_intake  agent.rfq_intake on (409 flag_off); the inbound_emails row exists (404) in mailbox 'rfq'
//                      (400) with status received, needs_review or failed (409 stale); its intake run, when one
//                      exists, is not waiting for a human (409 stale). The intake's first step exits on a final
//                      run, so a final run row is reopened first (status running, human_action {channel
//                      dashboard, actor, verb 'rerun', decided_at}), before any instance is created or restarted.
//                      Then RFQ_INTAKE.create('rfq-intake-<32 hex>') (a new instance, also for a message whose
//                      earlier instance is past its retention period); "already exists": an instance that has
//                      ended is restarted from the beginning, a live instance is left alone. created is true only
//                      for a new instance. When nothing was started (live instance) or create/restart fails, the
//                      reopened row gets back its previous status, finished_at, error, parked_reason and
//                      human_action, only while it is still running with this request's rerun (compare-and-set
//                      on updated_at); a failure then answers 500.
//          test_card   ADMIN; one 'eval' run (trigger dashboard, key 'test-card:<uuid>') waiting on a 'test' card
//                      with the single verb 'dismiss' (approval.request sends it to Telegram); instance_id = run id.
// file     key in parameter k: exactly one, no encoded slash or backslash, no '..' or backslash, and one of the
//          patterns of STAFF_FILE_KEY_RE, else 403 {"error":"forbidden"} without detail; a missing object 404.
//          PDFs are served inline (dashboard preview), everything else as an attachment; .eml files as
//          application/octet-stream; X-Content-Type-Options: nosniff.
// A binding a start or file request needs (QUOTE, RFQ_INTAKE, PRIVATE_FILES) that is not configured answers 500
// text/plain for that request only (names logged, never values). Log lines carry the action, kind, flag key and
// outcome; never a uid, an address, a key of a stored object or a body.

import type { Context } from 'hono';
import {
  FLAG_EDIT_KEY_RE,
  isFlagEditBody,
  isStartBody,
  type AgentAction,
  type AgentApiError,
  type AgentStatus,
  type FlagEditResult,
  type StartResult,
} from '../../../shared/src/agent-api';
import { configError } from '../../../shared/src/http/env-check';
import { jsonResponse } from '../../../shared/src/http/json';
import { formatLogLine } from '../../../shared/src/http/log';
import type { Principal } from '../../../shared/src/http/rpc';
import { request as requestApproval } from '../agents/approval';
import { testCard } from '../agents/cards/test';
import { ConfigMissingError, need } from '../agents/config';
import { readFlag } from '../agents/flags';
import { isAlreadyExists, quoteInstanceId, rfqIntakeInstanceId } from '../agents/ids';
import { openRun, type RunStatus } from '../agents/runs';
import type { Filter } from '../db/postgrest';
import { DEFAULT_TENANT_ID, getFlagRow, updateFlagIfRev, writeThrough } from '../db/repos/feature-flags';
import { getInboundEmail, type InboundStatus } from '../db/repos/inbound-emails';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';
import { makePorts, type Ports } from '../ports/index';

export const AGENT_ADMIN_BODY_MAX_BYTES = 65_536;

/** Staff previews: quote PDFs, traveller PDFs, CAD outputs, stored raw e-mails and their attachments. */
export const STAFF_FILE_KEY_RE =
  /^(quotes\/[0-9a-f-]{36}\/v\d+\/quote\.pdf|orders\/[0-9a-f-]{36}\/traveler\.pdf|cad\/[0-9a-f-]{36}\/output\/[a-z_.]+|email\/[0-9a-f]{64}\/(raw\.eml|att\/[0-9]+-[A-Za-z0-9._-]{1,100}))$/;

/** inbound_emails statuses from which an intake may be started again. */
export const RERUNNABLE_INBOUND: readonly InboundStatus[] = ['received', 'needs_review', 'failed'];

/** quote_workflows statuses that end a quote (= the partial unique index quote_workflows_one_active_idx). */
export const QUOTE_FINAL: readonly string[] = ['won', 'lost', 'expired', 'rejected', 'failed', 'cancelled'];

/** Workflow instance states after which restart() runs the instance again. */
const ENDED_INSTANCE = new Set(['complete', 'errored', 'terminated']);
const FINAL_RUN: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped'];

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The intake run columns a rerun changes, as read before it. */
type IntakeRunRow = {
  id: string;
  status: RunStatus;
  finished_at: string | null;
  error: string | null;
  parked_reason: string | null;
  human_action: Record<string, unknown> | null;
};

/** A final intake run reopened by this request: its previous columns and the rerun written. */
interface ReopenedRun {
  previous: IntakeRunRow;
  human_action: { channel: 'dashboard'; actor: string; verb: 'rerun'; decided_at: string };
}

type IntakeStart = 'created' | 'running' | 'restarted';

function ok(body: unknown): Response {
  return jsonResponse(200, body, NO_STORE);
}

function fail(status: number, error: AgentApiError, headers: Record<string, string> = {}): Response {
  return jsonResponse(status, { error }, { ...NO_STORE, ...headers });
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

function staffPrincipal(p: Principal): p is Principal & { class: 'STAFF' | 'ADMIN'; uid: string } {
  return (p.class === 'STAFF' || p.class === 'ADMIN') && typeof p.uid === 'string' && /^[0-9a-f-]{36}$/.test(p.uid);
}

function tenantOf(env: OpsEnv): string {
  return env.AGENT_TENANT_ID ?? DEFAULT_TENANT_ID;
}

type BodyRead = { ok: true; body: unknown } | { ok: false; response: Response };

async function readJson(c: Context<OpsHono>): Promise<BodyRead> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > AGENT_ADMIN_BODY_MAX_BYTES) return { ok: false, response: fail(413, 'payload_too_large') };
  try {
    return { ok: true, body: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, response: fail(400, 'bad_request') };
  }
}

/** The staff preview key of a query string (rules in the header), or null. */
export function staffFileKeyOf(search: string): string | null {
  const text = search.startsWith('?') ? search.slice(1) : search;
  const raw = text
    .split('&')
    .filter((part) => part === 'k' || part.startsWith('k='))
    .map((part) => (part === 'k' ? '' : part.slice(2)));
  if (raw.length !== 1 || /%(2f|5c)/i.test(raw[0])) return null;
  let key: string;
  try {
    key = decodeURIComponent(raw[0].replace(/\+/g, ' '));
  } catch {
    return null;
  }
  if (key.includes('..') || key.includes('\\')) return null;
  return STAFF_FILE_KEY_RE.test(key) ? key : null;
}

/** Status of a Workflow instance, or null when it cannot be read. */
async function instanceStatus(instance: WorkflowInstance): Promise<string | null> {
  try {
    return (await instance.status()).status;
  } catch {
    return null;
  }
}

/**
 * A new intake instance ('created'); when the id already exists, an ended instance is restarted from the beginning
 * ('restarted') and a live or unreadable one is left alone ('running'). Throws what create, get or restart throw.
 */
async function createOrRestart<P>(workflow: Workflow<P>, id: string, params: P): Promise<IntakeStart> {
  try {
    await workflow.create({ id, params });
    return 'created';
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  const instance = await workflow.get(id);
  const state = await instanceStatus(instance);
  if (state === null || !ENDED_INSTANCE.has(state)) return 'running';
  await instance.restart();
  return 'restarted';
}

export interface AgentAdminHandlers {
  handleStatus(c: Context<OpsHono>): Promise<Response>;
  handleFlag(c: Context<OpsHono>): Promise<Response>;
  handleStart(c: Context<OpsHono>): Promise<Response>;
  handleStaffFile(c: Context<OpsHono>): Promise<Response>;
}

/** The four handlers; portsFor builds the ports of a request (tests pass fakes). */
export function createAgentAdminHandlers(portsFor: (env: OpsEnv) => Ports = (env) => makePorts(env)): AgentAdminHandlers {
  async function handleStatus(c: Context<OpsHono>): Promise<Response> {
    const principal = c.var.call.principal;
    if (!staffPrincipal(principal)) return fail(403, 'forbidden');
    const actions: AgentAction[] = principal.class === 'ADMIN' ? ['decision', 'flag', 'start', 'file'] : ['decision', 'start', 'file'];
    const body: AgentStatus = { v: 1, ok: true, actions, principal: principal.class };
    return ok(body);
  }

  async function handleFlag(c: Context<OpsHono>): Promise<Response> {
    const principal = c.var.call.principal;
    if (!staffPrincipal(principal) || principal.class !== 'ADMIN') return fail(403, 'forbidden');
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const body = read.body as Record<string, unknown> | null;
    if (body && typeof body === 'object' && typeof body.key === 'string' && !FLAG_EDIT_KEY_RE.test(body.key)) return fail(403, 'forbidden');
    if (!isFlagEditBody(read.body)) return fail(400, 'bad_request');
    const edit = read.body;
    if (edit.writes !== undefined && edit.key !== 'mcp.remote') return fail(400, 'bad_request');
    if (edit.mode === 'auto' && (edit.key === 'agent.quote' || edit.key === 'agent.post_order')) return fail(403, 'forbidden');

    const ports = portsFor(c.env);
    const tenant = tenantOf(c.env);
    const row = await getFlagRow(ports.db, edit.key, tenant);
    if (!row) return fail(404, 'not_found');
    const value: Record<string, unknown> = { ...(row.value ?? {}) };
    if (edit.mode !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(value, 'mode')) return fail(400, 'bad_request');
      value.mode = edit.mode;
    }
    if (edit.writes !== undefined) value.writes = edit.writes;

    const updated = await updateFlagIfRev(ports.db, { key: edit.key, tenant_id: tenant, expected_rev: edit.expected_rev, enabled: edit.enabled, value, updated_by: principal.uid });
    if (!updated) {
      log('agent flag', { key: edit.key, outcome: 'stale' });
      return fail(409, 'stale');
    }
    let kv: FlagEditResult['kv'] = 'pending';
    if (c.env.FLAGS) {
      try {
        kv = await writeThrough(ports.db, c.env.FLAGS, updated);
      } catch {
        kv = 'pending';
      }
    }
    log('agent flag', { key: edit.key, rev: updated.rev, kv, outcome: 'updated' });
    const result: FlagEditResult = { v: 1, ok: true, key: edit.key, rev: Number(updated.rev), kv };
    return ok(result);
  }

  async function startQuote(c: Context<OpsHono>, ports: Ports, uid: string, rfqId: string): Promise<Response> {
    const env = c.env;
    const flag = await readFlag(env, 'agent.quote');
    if (!flag.enabled) return fail(409, 'flag_off');
    const rfqs = await ports.db.select<{ id: string; tenant_id: string | null }>('rfqs', { columns: 'id,tenant_id', filters: [['id', 'eq', rfqId]], limit: 1 });
    if (rfqs.length === 0) return fail(404, 'not_found');
    const quotes = await ports.db.select<{ quote_version: number; status: string }>('quote_workflows', {
      columns: 'quote_version,status',
      filters: [['rfq_id', 'eq', rfqId]],
      order: [{ column: 'quote_version', ascending: false }],
      limit: 1000,
    });
    if (quotes.some((q) => !QUOTE_FINAL.includes(q.status))) return fail(409, 'active_quote_exists');
    const version = quotes.reduce((max, q) => Math.max(max, Number(q.quote_version) || 0), 0) + 1;
    need(env, 'QUOTE');
    const instance_id = quoteInstanceId(rfqId, version);
    const tenant_id = rfqs[0].tenant_id ?? tenantOf(env);
    let created = true;
    try {
      await env.QUOTE.create({ id: instance_id, params: { v: 1, rfq_id: rfqId, quote_version: version, tenant_id, trigger: 'dashboard', requested_by: `user:${uid}` } });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      created = false;
    }
    log('agent start', { kind: 'quote', version, outcome: created ? 'created' : 'exists' });
    const result: StartResult = { v: 1, ok: true, instance_id, created };
    return ok(result);
  }

  async function startIntake(c: Context<OpsHono>, ports: Ports, uid: string, inboundId: string): Promise<Response> {
    const env = c.env;
    const flag = await readFlag(env, 'agent.rfq_intake');
    if (!flag.enabled) return fail(409, 'flag_off');
    const row = await getInboundEmail(ports.db, inboundId);
    if (!row) return fail(404, 'not_found');
    if (row.mailbox !== 'rfq') return fail(400, 'bad_request');
    if (!RERUNNABLE_INBOUND.includes(row.status)) return fail(409, 'stale');
    const runs = await ports.db.select<IntakeRunRow>('agent_runs', {
      columns: 'id,status,finished_at,error,parked_reason,human_action',
      filters: [['agent', 'eq', 'rfq_intake'], ['idempotency_key', 'eq', row.message_id_sha256]],
      limit: 1,
    });
    const run = runs[0] ?? null;
    if (run?.status === 'waiting_human') return fail(409, 'stale');
    need(env, 'RFQ_INTAKE');
    const instance_id = rfqIntakeInstanceId(row.message_id_sha256);
    // Reopened before the instance starts: its first step reads the run.
    const reopened = run && FINAL_RUN.includes(run.status) ? await reopenRun(ports, run, uid) : null;
    let started: IntakeStart;
    try {
      started = await createOrRestart(env.RFQ_INTAKE, instance_id, { v: 1, inbound_email_id: row.id, message_id_sha256: row.message_id_sha256, tenant_id: row.tenant_id });
    } catch (error) {
      if (reopened) await restoreRun(ports, reopened);
      log('agent start', { kind: 'rfq_intake', outcome: 'start_failed' });
      throw error;
    }
    if (started === 'running' && reopened) await restoreRun(ports, reopened);
    log('agent start', { kind: 'rfq_intake', outcome: started });
    return ok({ v: 1, ok: true, instance_id, created: started === 'created' } satisfies StartResult);
  }

  /** Sets a final intake run back to running with this user's rerun; null when the row is no longer final. */
  async function reopenRun(ports: Ports, run: IntakeRunRow, uid: string): Promise<ReopenedRun | null> {
    const human_action: ReopenedRun['human_action'] = { channel: 'dashboard', actor: `user:${uid}`, verb: 'rerun', decided_at: ports.clock.now().toISOString() };
    const written = await ports.db.update(
      'agent_runs',
      { status: 'running', finished_at: null, error: null, parked_reason: null, approval_token_sha256: null, human_action },
      { filters: [['id', 'eq', run.id], ['status', 'in', FINAL_RUN]], returning: 'id' },
    );
    return written.length > 0 ? { previous: run, human_action } : null;
  }

  /**
   * Gives a reopened run back its previous columns, only while it is still running with the rerun this request
   * wrote (read, then a PATCH conditional on the updated_at read). Never throws: the caller's outcome stands.
   */
  async function restoreRun(ports: Ports, reopened: ReopenedRun): Promise<void> {
    const { previous, human_action } = reopened;
    try {
      const [current] = await ports.db.select<{ status: string; human_action: Record<string, unknown> | null; updated_at: string | null }>('agent_runs', {
        columns: 'status,human_action,updated_at',
        filters: [['id', 'eq', previous.id]],
        limit: 1,
      });
      const ours =
        current?.status === 'running' &&
        current.human_action?.verb === human_action.verb &&
        current.human_action?.actor === human_action.actor &&
        current.human_action?.decided_at === human_action.decided_at;
      if (!ours) {
        log('agent start', { kind: 'rfq_intake', outcome: 'restore_skipped' });
        return;
      }
      const filters: [Filter, ...Filter[]] = [['id', 'eq', previous.id], ['status', 'eq', 'running']];
      if (typeof current.updated_at === 'string') filters.push(['updated_at', 'eq', current.updated_at]);
      const written = await ports.db.update(
        'agent_runs',
        { status: previous.status, finished_at: previous.finished_at, error: previous.error, parked_reason: previous.parked_reason, human_action: previous.human_action },
        { filters, returning: 'id' },
      );
      log('agent start', { kind: 'rfq_intake', outcome: written.length > 0 ? 'run_restored' : 'restore_skipped' });
    } catch {
      log('agent start', { kind: 'rfq_intake', outcome: 'restore_failed' });
    }
  }

  async function startTestCard(c: Context<OpsHono>, ports: Ports): Promise<Response> {
    const key = `test-card:${crypto.randomUUID()}`;
    const opened = await openRun(ports.db, { agent: 'eval', trigger: 'dashboard', idempotency_key: key, tenant_id: tenantOf(c.env) });
    await requestApproval(c.env, ports, { run_id: opened.run_id, card: testCard({ run_id: opened.run_id, site_origin: c.env.SITE_ORIGIN }) });
    log('agent start', { kind: 'test_card', outcome: 'created' });
    return ok({ v: 1, ok: true, instance_id: opened.run_id, created: true } satisfies StartResult);
  }

  async function handleStart(c: Context<OpsHono>): Promise<Response> {
    const principal = c.var.call.principal;
    if (!staffPrincipal(principal)) return fail(403, 'forbidden');
    const read = await readJson(c);
    if (!read.ok) return read.response;
    if (!isStartBody(read.body)) return fail(400, 'bad_request');
    const body = read.body;
    if (body.kind === 'test_card' && principal.class !== 'ADMIN') return fail(403, 'forbidden');
    const ports = portsFor(c.env);
    try {
      switch (body.kind) {
        case 'quote':
          return await startQuote(c, ports, principal.uid, body.rfq_id);
        case 'rfq_intake':
          return await startIntake(c, ports, principal.uid, body.inbound_email_id);
        case 'test_card':
          return await startTestCard(c, ports);
      }
    } catch (error) {
      if (error instanceof ConfigMissingError) return configError(LOG_PREFIX, error.names);
      throw error;
    }
  }

  async function handleStaffFile(c: Context<OpsHono>): Promise<Response> {
    const principal = c.var.call.principal;
    if (!staffPrincipal(principal)) return fail(403, 'forbidden');
    const key = staffFileKeyOf(new URL(c.req.url).search);
    if (key === null) return fail(403, 'forbidden');
    if (!c.env.PRIVATE_FILES) return configError(LOG_PREFIX, ['PRIVATE_FILES']);
    const object = await portsFor(c.env).blob.get(key);
    if (!object) return fail(404, 'not_found');
    const name = key.slice(key.lastIndexOf('/') + 1);
    const pdf = name.endsWith('.pdf');
    const type = pdf ? 'application/pdf' : name.endsWith('.eml') ? 'application/octet-stream' : (object.contentType ?? 'application/octet-stream');
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(object.size),
        'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

  return { handleStatus, handleFlag, handleStart, handleStaffFile };
}

const handlers = createAgentAdminHandlers();

export const handleStatus: (c: Context<OpsHono>) => Promise<Response> = handlers.handleStatus;
export const handleFlag: (c: Context<OpsHono>) => Promise<Response> = handlers.handleFlag;
export const handleStart: (c: Context<OpsHono>) => Promise<Response> = handlers.handleStart;
export const handleStaffFile: (c: Context<OpsHono>) => Promise<Response> = handlers.handleStaffFile;
