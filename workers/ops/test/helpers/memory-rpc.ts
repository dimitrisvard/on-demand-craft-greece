// In-memory versions of the service-role RPCs of the agent-layer migration (supabase/migrations/*_agent_layer.sql;
// contract docs/migration/specs/PHASE4_SPEC.md §4.13), plus the row write path they share: column defaults, the
// BEFORE triggers, NOT NULL and CHECK constraints, unique keys and the foreign-key actions the RPCs rely on.
//
// Users of this file
//   - MemoryDb (test/helpers/memory-db.ts): rpc(name, args) dispatches to MEMORY_RPCS.
//   - The mini-PostgREST of the T2 harness (workers/site/test/integration/stubs/postgrest.mjs).
//   - The RPC parity runner of the SQL tests (supabase/tests/agent_layer, `npm run test:rpc-parity`), which runs the
//     same vectors against the SQL functions on PGlite and against these functions and compares the rows.
// The file is self-contained (no imports) and uses only erasable TypeScript, so Node 22 loads it directly.
//
// Rules
//   - Every RPC has the signature (tables, args, now) => result: `tables` maps a table name to its rows (mutated in
//     place), `args` are the named JSON arguments PostgREST passes (p_*), `now` is the transaction time.
//   - Results have PostgREST's shapes: an array of rows for RETURNS TABLE / SETOF, the bare value for a scalar or
//     jsonb result.
//   - An RPC is atomic: when it throws, every table is restored to its state before the call.
//   - Errors are MemoryRpcError with the SQLSTATE PostgREST reports (P0001 raised by the function, 23505 unique,
//     23514 check, 23502 not null, 23503 foreign key, 22P02/22007 bad input, 42501 refused) and its HTTP status.
//   - Rows hold JSON values, as PostgREST returns them: timestamps as ISO strings, numerics as numbers rounded to the
//     column's scale, jsonb as plain values. Unknown columns of the seven agent tables are refused (PGRST204).
//   - Not emulated: row-level security and roles (callers are the service role), foreign keys other than the actions
//     listed in FK_ACTIONS, TOAST compression (jsonb size limits are measured on the JSON text, which is stricter).

export type MemoryRow = Record<string, unknown>;
export type MemoryTableSet = Record<string, MemoryRow[]>;
export type MemoryRpcFn = (tables: MemoryTableSet, args: Record<string, unknown>, now: Date) => unknown;

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const STAFF_ROLES: readonly string[] = ['admin', 'sales_rep', 'production_manager', 'accountant'];

/** A failed statement, with the SQLSTATE and HTTP status PostgREST would answer. */
export class MemoryRpcError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;
  constructor(status: number, code: string, message: string, details: string | null = null) {
    super(message);
    this.name = 'MemoryRpcError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = null;
  }
  /** PostgREST error body. */
  toJSON(): { code: string; message: string; details: string | null; hint: string | null } {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

/** RAISE EXCEPTION in a function body (SQLSTATE P0001). */
function raise(message: string): never {
  throw new MemoryRpcError(400, 'P0001', message);
}

// ---- values -----------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString();
const addMs = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

/** timestamp - interval 'n months' (calendar months, day clamped to the month's length), in UTC. */
function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
/** to_char(now(), 'DDMMYYYY') with the database time zone UTC. */
const ddmmyyyy = (d: Date): string => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
/** current_date in UTC. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** A timestamptz argument (ISO string or Date); NULL stays null. */
function tsArg(v: unknown, name: string): Date | null {
  if (v === null || v === undefined) return null;
  const t = toTime(v);
  if (t === null) throw new MemoryRpcError(400, '22007', `invalid input syntax for type timestamp with time zone: "${String(v)}" (${name})`);
  return new Date(t);
}

const UUID_RE = /^\{?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\}?$/;
/** text::uuid (canonical lower-case form); NULL stays null. */
export function uuidCast(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!UUID_RE.test(s)) throw new MemoryRpcError(400, '22P02', `invalid input syntax for type uuid: "${s}"`);
  const h = s.replace(/[{}-]/g, '').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** text::int; NULL stays null. */
function intCast(v: string | null): number | null {
  if (v === null) return null;
  if (!/^\s*[+-]?\d+\s*$/.test(v)) throw new MemoryRpcError(400, '22P02', `invalid input syntax for type integer: "${v}"`);
  const n = Number(v);
  if (n > 2147483647 || n < -2147483648) throw new MemoryRpcError(400, '22003', `value "${v}" is out of range for type integer`);
  return n;
}

const UTF8 = new TextEncoder();
/** Key order of jsonb output: shorter keys first, then byte order. */
function jsonbKeyOrder(a: string, b: string): number {
  const la = UTF8.encode(a).length;
  const lb = UTF8.encode(b).length;
  if (la !== lb) return la - lb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The value with object keys in jsonb order (what PostgREST returns for a jsonb value). */
export function jsonbOrder<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => jsonbOrder(x)) as T;
  if (!isObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort(jsonbKeyOrder)) out[k] = jsonbOrder(v[k]);
  return out as T;
}

/** jsonb text output (`->>` of an object or array). */
function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(', ')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort(jsonbKeyOrder).map((k) => `${JSON.stringify(k)}: ${jsonbText(v[k])}`).join(', ')}}`;
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

/** jsonb ->> key: text of the value, NULL for a missing key or JSON null. */
function txt(obj: unknown, key: string): string | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return jsonbText(v);
}

/** jsonb equality (object key order ignored, numbers compared by value). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

/** Characters, as char_length counts them. */
const charLength = (s: string): number => [...s].length;

// Exact decimals for numeric arithmetic (value = n / 10^s).
interface Dec {
  n: bigint;
  s: number;
}

function toDec(v: unknown): Dec {
  const t = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'x') : typeof v === 'string' ? v.trim() : 'x';
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new MemoryRpcError(400, '22P02', `invalid input syntax for type numeric: "${String(v)}"`);
  let digits = (m[2] ?? '') + (m[3] ?? '');
  let scale = (m[3] ?? '').length - Number(m[4] ?? 0);
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  const n = BigInt(digits === '' ? '0' : digits);
  return { n: m[1] === '-' ? -n : n, s: scale };
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);
function decAdd(a: Dec, b: Dec): Dec {
  const s = Math.max(a.s, b.s);
  return { n: a.n * pow10(s - a.s) + b.n * pow10(s - b.s), s };
}
const decMul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s });
/** Round half away from zero to `scale` digits (numeric(p, scale) assignment). */
function decRound(a: Dec, scale: number): Dec {
  if (a.s <= scale) return a;
  const f = pow10(a.s - scale);
  const q = a.n / f;
  const r = a.n % f;
  const half = (r < 0n ? -r : r) * 2n >= f;
  return { n: half ? q + (a.n < 0n ? -1n : 1n) : q, s: scale };
}
function decToNumber(a: Dec): number {
  const neg = a.n < 0n;
  const digits = (neg ? -a.n : a.n).toString();
  if (a.s === 0) return Number((neg ? '-' : '') + digits);
  const p = digits.padStart(a.s + 1, '0');
  return Number(`${neg ? '-' : ''}${p.slice(0, -a.s)}.${p.slice(-a.s)}`);
}

// ---- tables -------------------------------------------------------------------------------------

type Check = readonly [name: string, ok: (r: MemoryRow) => boolean];

interface UniqueIndex {
  name: string;
  /** Columns of the key (for on_conflict matching). */
  columns: readonly string[];
  /** Key of a row, or null when the row is not in the index (partial index, or a NULL with NULLs distinct). */
  key: (r: MemoryRow) => unknown[] | null;
}

interface TableSpec {
  /** gen_random_uuid() primary key 'id'. */
  id: boolean;
  defaults: (now: Date) => MemoryRow;
  /** NOT NULL columns. */
  notNull: readonly string[];
  /** When set, a write naming any other column is refused. */
  columns?: readonly string[];
  checks: readonly Check[];
  unique: readonly UniqueIndex[];
  /** numeric(p, s) columns: column -> s. */
  scale?: Readonly<Record<string, number>>;
  /** BEFORE UPDATE trigger update_updated_at_column(). */
  updatedAt?: boolean;
}

const nn = (v: unknown): boolean => v !== null && v !== undefined;
const isNull = (v: unknown): boolean => v === null || v === undefined;
const inList = (v: unknown, list: readonly string[]): boolean => typeof v === 'string' && list.includes(v);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const matches = (v: unknown, re: RegExp): boolean => typeof v === 'string' && re.test(v);
const jsonSize = (v: unknown): number => UTF8.encode(JSON.stringify(v)).length;

/** Unique key over plain columns; NULLs distinct unless nullsNotDistinct. */
function plainKey(name: string, columns: readonly string[], o: { nullsNotDistinct?: boolean; where?: (r: MemoryRow) => boolean } = {}): UniqueIndex {
  return {
    name,
    columns,
    key: (r) => {
      if (o.where && !o.where(r)) return null;
      const k = columns.map((c) => (r[c] === undefined ? null : r[c]));
      if (!o.nullsNotDistinct && k.some((x) => x === null)) return null;
      return k;
    },
  };
}
const pkey = (table: string): UniqueIndex => plainKey(`${table}_pkey`, ['id']);
const idOnly = (table: string): Pick<TableSpec, 'id' | 'unique' | 'checks' | 'notNull' | 'defaults'> => ({
  id: true,
  unique: [pkey(table)],
  checks: [],
  notNull: [],
  defaults: () => ({}),
});

const RUN_STATUSES = ['running', 'waiting_human', 'succeeded', 'failed', 'cancelled', 'skipped'];
const RUN_TRIGGERS = ['email', 'cron', 'queue', 'workflow', 'dashboard', 'telegram', 'mcp', 'manual'];
const PARKED_REASONS = ['flag_off', 'budget', 'llm_unavailable', 'failed'];
const QUOTE_STATUSES = ['started', 'cad_pending', 'pricing', 'awaiting_approval', 'approved', 'sent', 'follow_up', 'won', 'lost',
  'counter_offer', 'expired', 'rejected', 'failed', 'cancelled'];
const QUOTE_FINAL = ['won', 'lost', 'expired', 'rejected', 'failed', 'cancelled'];
const INBOUND_STATUSES = ['received', 'parsed', 'needs_review', 'rfq_created', 'attached', 'matched', 'rejected', 'duplicate', 'spam', 'failed'];
const CAD_STATUSES = ['queued', 'dispatched', 'running', 'succeeded', 'failed', 'timed_out', 'dead_letter', 'cancelled'];
const SOURCES = ['web', 'email', 'techpilot', 'manual'];
const RELEASE_REASONS = ['cancelled', 'consumed', 'expired', 'manual'];
const FLAG_MODES = ['shadow', 'assist', 'auto'];

/**
 * The status / enum lists the CHECK constraints of the migration name, by constraint name. A T1 test compares each
 * with the migration file (test/helpers/check-lists.ts), so these copies cannot drift.
 */
export const CHECK_LISTS: Readonly<Record<string, readonly string[]>> = {
  agent_runs_trigger_check: RUN_TRIGGERS,
  agent_runs_status_check: RUN_STATUSES,
  agent_runs_parked_reason_check: PARKED_REASONS,
  pricing_rules_process_check: ['cnc', 'sheet_metal', 'finishing', 'shipping', 'global'],
  quote_workflows_status_check: QUOTE_STATUSES,
  quote_workflows_process_check: ['cnc', 'sheet_metal', 'mixed', 'other'],
  quote_workflows_approved_via_check: ['telegram', 'dashboard', 'mcp'],
  inbound_emails_mailbox_check: ['rfq', 'replies', 'gmail'],
  inbound_emails_source_check: ['email_routing', 'gmail_poller'],
  inbound_emails_kind_check: ['rfq', 'techpilot', 'reply', 'auto_reply', 'spam', 'other'],
  inbound_emails_status_check: INBOUND_STATUSES,
  cad_jobs_job_type_check: ['analyse', 'drawing_pdf', 'flat_dxf', 'flat_svg'],
  cad_jobs_backend_check: ['vps', 'container', 'inline', 'mac_mini'],
  cad_jobs_status_check: CAD_STATUSES,
  stock_reservations_status_check: ['held', 'committed', 'released'],
  stock_reservations_reason_check: RELEASE_REASONS,
  rfqs_source_check: SOURCES,
  rfq_files_source_check: SOURCES,
  feature_flags_mode_check: FLAG_MODES,
};

const HEX64 = /^[0-9a-f]{64}$/;

const AGENT_RUNS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), workflow_name: null, workflow_instance_id: null,
    parent_run_id: null, subject_type: null, subject_id: null, status: 'running', parked_reason: null, prompt_version: null,
    llm_calls: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_cents: 0, approval_token_sha256: null,
    human_action: null, output: null, error: null, started_at: iso(now), finished_at: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'agent', 'trigger', 'idempotency_key', 'status', 'llm_calls',
    'input_tokens', 'output_tokens', 'cached_input_tokens', 'cost_cents', 'started_at'],
  checks: [
    ['agent_runs_agent_check', (r) => isNull(r.agent) || (matches(r.agent, /^[a-z0-9_]+(\.[a-z0-9_]+)*$/) && charLength(String(r.agent)) <= 64)],
    ['agent_runs_trigger_check', (r) => isNull(r.trigger) || inList(r.trigger, RUN_TRIGGERS)],
    ['agent_runs_idempotency_key_check', (r) => isNull(r.idempotency_key) || (charLength(String(r.idempotency_key)) >= 1 && charLength(String(r.idempotency_key)) <= 512)],
    ['agent_runs_instance_check', (r) => isNull(r.workflow_instance_id)
      || (matches(r.workflow_instance_id, /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/) && charLength(String(r.workflow_instance_id)) <= 100)],
    ['agent_runs_subject_check', (r) => isNull(r.subject_type) || matches(r.subject_type, /^[a-z_]+$/)],
    ['agent_runs_status_check', (r) => isNull(r.status) || inList(r.status, RUN_STATUSES)],
    ['agent_runs_finished_check', (r) => isNull(r.status) || inList(r.status, ['running', 'waiting_human']) === isNull(r.finished_at)],
    ['agent_runs_parked_reason_check', (r) => isNull(r.parked_reason) || inList(r.parked_reason, PARKED_REASONS)],
    ['agent_runs_parked_status_check', (r) => isNull(r.parked_reason) || r.status === 'waiting_human'],
    ['agent_runs_counts_check', (r) => ['llm_calls', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cost_cents']
      .every((c) => isNull(r[c]) || num(r[c]) >= 0)],
    ['agent_runs_token_check', (r) => isNull(r.approval_token_sha256) || (matches(r.approval_token_sha256, HEX64) && r.status === 'waiting_human')],
    ['agent_runs_human_action_check', (r) => isNull(r.human_action) || isObject(r.human_action)],
    ['agent_runs_output_check', (r) => isNull(r.output) || jsonSize(r.output) <= 65536],
  ],
  unique: [
    pkey('agent_runs'),
    plainKey('agent_runs_agent_key', ['agent', 'idempotency_key']),
    plainKey('agent_runs_approval_token_idx', ['approval_token_sha256']),
  ],
  scale: { cost_cents: 4 },
  updatedAt: true,
};

const FEATURE_FLAGS: TableSpec = {
  id: false,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), enabled: false, value: {}, description: null,
    updated_by: null, rev: 0, kv_synced_rev: null, kv_synced_at: null, kv_seed_pending: false,
  }),
  notNull: ['key', 'tenant_id', 'created_at', 'updated_at', 'enabled', 'value', 'rev', 'kv_seed_pending'],
  checks: [
    ['feature_flags_key_check', (r) => isNull(r.key) || (matches(r.key, /^[a-z0-9_]+(\.[a-z0-9_]+)*$/) && charLength(String(r.key)) <= 64)],
    ['feature_flags_value_check', (r) => isNull(r.value) || (isObject(r.value) && jsonSize(r.value) <= 8192)],
    ['feature_flags_mode_check', (r) => !isObject(r.value) || !('mode' in r.value) || inList(r.value.mode, FLAG_MODES)],
  ],
  unique: [plainKey('feature_flags_pkey', ['key', 'tenant_id'])],
};

const PRICING_RULES: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), material_match: null, qty_min: null, qty_max: null,
    currency: 'EUR', version: 1, valid_from: isoDate(now), valid_to: null, is_active: true, notes: null, updated_by: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'process', 'rule_key', 'value', 'unit', 'currency', 'version', 'valid_from', 'is_active'],
  checks: [
    ['pricing_rules_process_check', (r) => isNull(r.process) || inList(r.process, CHECK_LISTS.pricing_rules_process_check)],
    ['pricing_rules_rule_key_check', (r) => isNull(r.rule_key) || matches(r.rule_key, /^[a-z0-9_]+$/)],
    ['pricing_rules_match_check', (r) => isNull(r.material_match) || isObject(r.material_match)],
    ['pricing_rules_qty_check', (r) => (isNull(r.qty_min) || num(r.qty_min) >= 0)
      && (isNull(r.qty_max) || isNull(r.qty_min) || num(r.qty_max) >= num(r.qty_min))],
    ['pricing_rules_currency_check', (r) => isNull(r.currency) || matches(r.currency, /^[A-Z]{3}$/)],
    ['pricing_rules_version_check', (r) => isNull(r.version) || num(r.version) >= 1],
    ['pricing_rules_validity_check', (r) => isNull(r.valid_to) || isNull(r.valid_from) || String(r.valid_to) >= String(r.valid_from)],
  ],
  unique: [
    pkey('pricing_rules'),
    {
      name: 'pricing_rules_scope_idx',
      columns: ['tenant_id', 'process', 'rule_key', 'version', 'material_match', 'qty_min', 'qty_max'],
      key: (r) => ['tenant_id', 'process', 'rule_key', 'version', 'material_match', 'qty_min', 'qty_max']
        .map((c) => (c === 'material_match' && isObject(r[c]) ? JSON.stringify(jsonbOrder(r[c])) : r[c] ?? null)),
    },
  ],
  scale: { value: 4 },
  updatedAt: true,
};

const QUOTE_WORKFLOWS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), quote_version: 1, status: 'started', current_step: null,
    process: null, pricing: null, total_amount: null, currency: 'EUR', quote_pdf_r2_key: null, pdf_sha256: null, drafts: null,
    outbound_message_ids: [], resend_email_ids: [], approved_by: null, approved_via: null, approved_at: null, sent_at: null,
    follow_ups_sent: 0, outcome_reason: null, last_event_at: null, error: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'rfq_id', 'quote_version', 'workflow_instance_id', 'status', 'currency',
    'outbound_message_ids', 'resend_email_ids', 'follow_ups_sent'],
  checks: [
    ['quote_workflows_version_check', (r) => isNull(r.quote_version) || num(r.quote_version) >= 1],
    ['quote_workflows_instance_check', (r) => isNull(r.workflow_instance_id) || isNull(r.rfq_id) || isNull(r.quote_version)
      || r.workflow_instance_id === `quote-${String(r.rfq_id)}-v${String(r.quote_version)}`],
    ['quote_workflows_status_check', (r) => isNull(r.status) || inList(r.status, QUOTE_STATUSES)],
    ['quote_workflows_process_check', (r) => isNull(r.process) || inList(r.process, CHECK_LISTS.quote_workflows_process_check)],
    ['quote_workflows_currency_check', (r) => isNull(r.currency) || matches(r.currency, /^[A-Z]{3}$/)],
    ['quote_workflows_pdf_key_check', (r) => isNull(r.quote_pdf_r2_key) || isNull(r.rfq_id) || isNull(r.quote_version)
      || r.quote_pdf_r2_key === `quotes/${String(r.rfq_id)}/v${String(r.quote_version)}/quote.pdf`],
    ['quote_workflows_pdf_sha256_check', (r) => isNull(r.pdf_sha256) || matches(r.pdf_sha256, HEX64)],
    ['quote_workflows_drafts_check', (r) => isNull(r.drafts) || (isObject(r.drafts) && jsonSize(r.drafts) <= 65536)],
    ['quote_workflows_approved_by_check', (r) => isNull(r.approved_by) || matches(r.approved_by, /^(user:[0-9a-f-]{36}|telegram:-?[0-9]+)$/)],
    ['quote_workflows_approved_via_check', (r) => isNull(r.approved_via) || inList(r.approved_via, CHECK_LISTS.quote_workflows_approved_via_check)],
    ['quote_workflows_follow_ups_check', (r) => isNull(r.follow_ups_sent) || (num(r.follow_ups_sent) >= 0 && num(r.follow_ups_sent) <= 10)],
    ['quote_workflows_pricing_check', (r) => isNull(r.pricing) || isObject(r.pricing)],
  ],
  unique: [
    pkey('quote_workflows'),
    plainKey('quote_workflows_version_key', ['rfq_id', 'quote_version']),
    plainKey('quote_workflows_instance_key', ['workflow_instance_id']),
    plainKey('quote_workflows_one_active_idx', ['rfq_id'], { where: (r) => !inList(r.status, QUOTE_FINAL) }),
  ],
  scale: { total_amount: 2 },
  updatedAt: true,
};

const INBOUND_EMAILS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), source: 'email_routing', sender_account_id: null,
    in_reply_to: null, references_ids: [], from_name: null, to_email: null, subject: null, raw_r2_key: null, raw_size_bytes: null,
    body_excerpt: null, attachments: [], auth_results: null, kind: null, status: 'received', parsed: null, parse_confidence: null,
    classification: null, rfq_id: null, customer_id: null, quote_workflow_id: null, agent_run_id: null, error: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'message_id', 'message_id_sha256', 'mailbox', 'source', 'references_ids',
    'from_email', 'received_at', 'attachments', 'status'],
  checks: [
    ['inbound_emails_sha_check', (r) => isNull(r.message_id_sha256) || matches(r.message_id_sha256, HEX64)],
    ['inbound_emails_mailbox_check', (r) => isNull(r.mailbox) || inList(r.mailbox, CHECK_LISTS.inbound_emails_mailbox_check)],
    ['inbound_emails_source_check', (r) => isNull(r.source) || inList(r.source, CHECK_LISTS.inbound_emails_source_check)],
    ['inbound_emails_source_mailbox_check', (r) => isNull(r.source) || isNull(r.mailbox) || (r.source === 'gmail_poller') === (r.mailbox === 'gmail')],
    ['inbound_emails_gmail_account_check', (r) => isNull(r.source) || r.source !== 'gmail_poller' || nn(r.sender_account_id)],
    ['inbound_emails_raw_key_check', (r) => isNull(r.raw_r2_key) || isNull(r.message_id_sha256) || r.raw_r2_key === `email/${String(r.message_id_sha256)}/raw.eml`],
    ['inbound_emails_excerpt_check', (r) => isNull(r.body_excerpt) || charLength(String(r.body_excerpt)) <= 4000],
    ['inbound_emails_attachments_check', (r) => isNull(r.attachments) || Array.isArray(r.attachments)],
    ['inbound_emails_kind_check', (r) => isNull(r.kind) || inList(r.kind, CHECK_LISTS.inbound_emails_kind_check)],
    ['inbound_emails_status_check', (r) => isNull(r.status) || inList(r.status, INBOUND_STATUSES)],
    ['inbound_emails_confidence_check', (r) => isNull(r.parse_confidence) || (num(r.parse_confidence) >= 0 && num(r.parse_confidence) <= 1)],
  ],
  unique: [pkey('inbound_emails'), plainKey('inbound_emails_message_key', ['tenant_id', 'message_id_sha256'])],
  scale: { parse_confidence: 3 },
  updatedAt: true,
};

const CAD_JOBS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), backend: null, rfq_id: null, rfq_file_id: null,
    quote_workflow_id: null, params: {}, output_r2_keys: [], result: null, status: 'queued', attempts: 0, requested_by_run_id: null,
    enqueued_at: iso(now), started_at: null, finished_at: null, duration_ms: null, error: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'idempotency_key', 'job_type', 'input_r2_key', 'input_sha256', 'params',
    'output_r2_keys', 'status', 'attempts', 'enqueued_at'],
  checks: [
    ['cad_jobs_job_type_check', (r) => isNull(r.job_type) || inList(r.job_type, CHECK_LISTS.cad_jobs_job_type_check)],
    ['cad_jobs_backend_check', (r) => isNull(r.backend) || inList(r.backend, CHECK_LISTS.cad_jobs_backend_check)],
    ['cad_jobs_sha_check', (r) => isNull(r.input_sha256) || matches(r.input_sha256, HEX64)],
    ['cad_jobs_idem_check', (r) => isNull(r.idempotency_key) || (matches(r.idempotency_key, /^[0-9a-f]{64}:[a-z_]+:[0-9a-f]{64}$/)
      && (isNull(r.input_sha256) || isNull(r.job_type) || String(r.idempotency_key).startsWith(`${String(r.input_sha256)}:${String(r.job_type)}:`)))],
    ['cad_jobs_status_check', (r) => isNull(r.status) || inList(r.status, CAD_STATUSES)],
    ['cad_jobs_attempts_check', (r) => isNull(r.attempts) || num(r.attempts) >= 0],
    ['cad_jobs_params_check', (r) => (isNull(r.params) || isObject(r.params)) && (isNull(r.output_r2_keys) || Array.isArray(r.output_r2_keys))],
  ],
  unique: [pkey('cad_jobs'), plainKey('cad_jobs_idem_key', ['rfq_id', 'idempotency_key'], { nullsNotDistinct: true })],
  updatedAt: true,
};

const ACTIVE_HOLD = ['held', 'committed'];
const STOCK_RESERVATIONS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, created_at: iso(now), updated_at: iso(now), stock_item_id: null, area_mm2: null, quantity: null,
    status: 'held', release_reason: null, expires_at: null, nesting_session_id: null, reserve_txn_id: null, release_txn_id: null,
    released_at: null, held_by: null,
  }),
  notNull: ['id', 'tenant_id', 'created_at', 'updated_at', 'order_item_id', 'order_id', 'material_id', 'status'],
  checks: [
    ['stock_reservations_amount_check', (r) => (nn(r.area_mm2) && num(r.area_mm2) > 0) || (nn(r.quantity) && num(r.quantity) > 0)],
    ['stock_reservations_status_check', (r) => isNull(r.status) || inList(r.status, CHECK_LISTS.stock_reservations_status_check)],
    ['stock_reservations_reason_check', (r) => (r.status === 'released') === nn(r.release_reason)
      && (isNull(r.release_reason) || inList(r.release_reason, RELEASE_REASONS))],
    ['stock_reservations_held_check', (r) => r.status !== 'held' || nn(r.expires_at)],
    ['stock_reservations_committed_check', (r) => r.status !== 'committed' || (isNull(r.expires_at) && nn(r.nesting_session_id))],
    ['stock_reservations_released_check', (r) => (r.status === 'released') === nn(r.released_at)],
    ['stock_reservations_held_by_check', (r) => isNull(r.held_by) || matches(r.held_by, /^[0-9a-f-]{36}:[0-9a-f-]{36}$/)],
  ],
  unique: [
    pkey('stock_reservations'),
    plainKey('stock_reservations_item_active_idx', ['order_item_id', 'stock_item_id'], { where: (r) => inList(r.status, ACTIVE_HOLD) && nn(r.stock_item_id) }),
    plainKey('stock_reservations_material_active_idx', ['order_item_id', 'material_id'], { where: (r) => inList(r.status, ACTIVE_HOLD) && isNull(r.stock_item_id) }),
  ],
  scale: { area_mm2: 2, quantity: 3 },
  updatedAt: true,
};

const RFQS: TableSpec = {
  id: true,
  defaults: (now) => ({
    vat_id: null, address: null, city: null, zip_code: null, country: null, contact_first_name: null, contact_last_name: null,
    contact_position: null, contact_email: null, contact_phone: null, general_notes: null, internal_request_number: null,
    delivery_speed: null, max_delivery_date: null, latest_offer_date: null, terms_accepted: null, captcha_token: null,
    created_at: iso(now), updated_at: iso(now), customer_id: null, total_amount: 0, currency: 'EUR', due_date: null, version: 1,
    title: 'New RFQ', description: null, status: 'draft', parts_details: [], rfq_number: null, mobile: null, shipping_cost: 0,
    tenant_id: DEFAULT_TENANT_ID, source: 'web', inbound_email_id: null,
  }),
  notNull: ['id', 'company_name', 'source'],
  checks: [['rfqs_source_check', (r) => isNull(r.source) || inList(r.source, SOURCES)]],
  unique: [pkey('rfqs')],
};

const RFQ_FILES: TableSpec = {
  id: true,
  defaults: (now) => ({
    created_at: iso(now), part_id: null, tenant_id: DEFAULT_TENANT_ID, source: 'web', r2_key: null, sha256: null, content_type: null,
  }),
  notNull: ['id', 'rfq_id', 'file_name', 'file_path', 'file_type', 'file_size', 'created_at', 'source'],
  checks: [
    ['rfq_files_source_check', (r) => isNull(r.source) || inList(r.source, SOURCES)],
    ['rfq_files_sha256_check', (r) => isNull(r.sha256) || matches(r.sha256, HEX64)],
    ['rfq_files_r2_key_check', (r) => isNull(r.r2_key) || isNull(r.rfq_id) || String(r.r2_key).startsWith(`rfq/${String(r.rfq_id)}/`)],
  ],
  unique: [pkey('rfq_files'), plainKey('rfq_files_rfq_sha256_key', ['rfq_id', 'sha256'])],
};

const CUSTOMERS: TableSpec = {
  id: true,
  defaults: (now) => ({
    company_name: null, contact_name: null, email: null, phone: null, address: null, country: null, created_at: iso(now),
    updated_at: iso(now), status: 'lead', vat_tax_id: '', street_address: '', city: '', zip_code: '', first_name: null,
    last_name: null, position: null, mobile: null, tenant_id: DEFAULT_TENANT_ID, user_id: null,
  }),
  notNull: ['id', 'status'],
  checks: [],
  unique: [
    pkey('customers'),
    plainKey('customers_email_unique', ['email']),
    { name: 'customers_email_unique_idx', columns: [], key: (r) => (typeof r.email === 'string' ? [r.email.toLowerCase()] : null) },
  ],
};

const ORDERS: TableSpec = {
  id: true,
  defaults: (now) => ({
    customer_id: null, rfq_id: null, status: 'new', total_amount: 0, currency: 'USD', created_at: iso(now), updated_at: iso(now),
    start_date: null, delivery_date: null, partner_id: null, production_status: 'pending', material_costs: 0,
    working_hours_costs: 0, total_production_costs: 0, vat_amount: 0, total_with_vat: 0, po_number: null, from_rfq_number: null,
    tenant_id: DEFAULT_TENANT_ID,
  }),
  notNull: ['id', 'status', 'title'],
  checks: [['check_production_status', (r) => isNull(r.production_status) || inList(r.production_status, ['pending', 'in_production', 'ready', 'completed'])]],
  unique: [pkey('orders')],
};

const ORDER_ITEMS: TableSpec = {
  id: true,
  defaults: (now) => ({
    description: null, quantity: 1, unit_price: 0, total_price: 0, created_at: iso(now), product_id: null, sku: null, tenant_id: DEFAULT_TENANT_ID,
  }),
  notNull: ['id', 'order_id', 'product_name', 'quantity', 'unit_price', 'total_price'],
  checks: [],
  unique: [pkey('order_items')],
};

const STOCK_TRANSACTIONS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, area_change_mm2: 0, quantity_change: 0, reference_type: null, reference_id: null, session_id: null,
    notes: null, created_by: null, created_at: iso(now),
  }),
  notNull: ['id', 'tenant_id', 'stock_item_id', 'transaction_type', 'created_at'],
  checks: [],
  unique: [pkey('stock_transactions')],
};

const STOCK_ITEMS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, status: 'available', origin: 'purchased', width_mm: null, height_mm: null, total_area_mm2: null,
    remaining_area_mm2: null, quantity: 1, remaining_quantity: null, qr_code: null, parent_stock_id: null, location: null,
    batch_number: null, supplier: null, unit_cost: null, notes: null, received_at: iso(now), created_at: iso(now), updated_at: iso(now),
  }),
  notNull: ['id', 'tenant_id', 'material_id', 'status', 'origin', 'quantity', 'created_at', 'updated_at'],
  checks: [],
  unique: [pkey('stock_items')],
};

const MATERIALS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, grade: null, thickness_mm: null, base_unit: 'sheet', density_kg_m3: null, cost_per_unit: null,
    cost_currency: 'EUR', low_stock_threshold: 5, reorder_threshold: 10, notes: null, is_active: true, created_at: iso(now), updated_at: iso(now),
  }),
  notNull: ['id', 'tenant_id', 'name', 'category', 'base_unit', 'is_active', 'created_at', 'updated_at'],
  checks: [],
  unique: [pkey('materials')],
};

const NESTING_SESSIONS: TableSpec = {
  id: true,
  defaults: (now) => ({
    tenant_id: DEFAULT_TENANT_ID, session_date: isoDate(now), status: 'draft', total_parts: 0, total_sheets: 0, total_area_required_mm2: 0,
    total_area_consumed_mm2: 0, overall_utilization_pct: 0, nesting_data: null, notes: null, completed_at: null, created_by: null,
    created_at: iso(now), updated_at: iso(now),
  }),
  notNull: ['id', 'tenant_id', 'material_id', 'session_date', 'status', 'created_at', 'updated_at'],
  checks: [],
  unique: [pkey('nesting_sessions')],
};

const USER_ROLES: TableSpec = {
  id: true,
  defaults: (now) => ({ created_at: iso(now) }),
  notNull: ['id', 'user_id', 'role'],
  checks: [],
  unique: [pkey('user_roles'), plainKey('user_roles_user_id_role_key', ['user_id', 'role'])],
};

/** Columns of the seven agent tables (writes naming another column are refused, as PostgREST does). */
function withColumns(spec: TableSpec, required: readonly string[]): TableSpec {
  const cols = new Set<string>([...(spec.id ? ['id'] : []), ...Object.keys(spec.defaults(new Date(0))), ...required, ...spec.notNull]);
  return { ...spec, columns: [...cols] };
}

export const TABLE_SPECS: Readonly<Record<string, TableSpec>> = {
  agent_runs: withColumns(AGENT_RUNS, ['agent', 'trigger', 'idempotency_key']),
  feature_flags: withColumns(FEATURE_FLAGS, ['key']),
  pricing_rules: withColumns(PRICING_RULES, ['process', 'rule_key', 'value', 'unit']),
  quote_workflows: withColumns(QUOTE_WORKFLOWS, ['rfq_id', 'workflow_instance_id']),
  inbound_emails: withColumns(INBOUND_EMAILS, ['message_id', 'message_id_sha256', 'mailbox', 'from_email', 'received_at']),
  cad_jobs: withColumns(CAD_JOBS, ['idempotency_key', 'job_type', 'input_r2_key', 'input_sha256']),
  stock_reservations: withColumns(STOCK_RESERVATIONS, ['order_item_id', 'order_id', 'material_id']),
  rfqs: RFQS,
  rfq_files: RFQ_FILES,
  customers: CUSTOMERS,
  orders: ORDERS,
  order_items: ORDER_ITEMS,
  stock_transactions: STOCK_TRANSACTIONS,
  stock_items: STOCK_ITEMS,
  materials: MATERIALS,
  nesting_sessions: NESTING_SESSIONS,
  user_roles: USER_ROLES,
};

/** Seven tables created by the agent-layer migration. */
export const AGENT_TABLES: readonly string[] = ['agent_runs', 'feature_flags', 'pricing_rules', 'quote_workflows', 'inbound_emails',
  'cad_jobs', 'stock_reservations'];

/**
 * Unique constraints usable as a PostgREST on_conflict target (full constraints or indexes on plain columns), by
 * table. Partial indexes are enforced on write but are not conflict targets.
 */
export const UNIQUE_KEYS: Readonly<Record<string, ReadonlyArray<readonly string[]>>> = {
  agent_runs: [['id'], ['agent', 'idempotency_key']],
  feature_flags: [['key', 'tenant_id']],
  pricing_rules: [['id'], ['tenant_id', 'process', 'rule_key', 'version', 'material_match', 'qty_min', 'qty_max']],
  quote_workflows: [['id'], ['rfq_id', 'quote_version'], ['workflow_instance_id']],
  inbound_emails: [['id'], ['tenant_id', 'message_id_sha256']],
  cad_jobs: [['id'], ['rfq_id', 'idempotency_key']],
  stock_reservations: [['id']],
  rfqs: [['id']],
  rfq_files: [['id'], ['rfq_id', 'sha256']],
  customers: [['id'], ['email']],
  orders: [['id']],
  order_items: [['id']],
  stock_transactions: [['id']],
  stock_items: [['id']],
  materials: [['id']],
  nesting_sessions: [['id']],
  user_roles: [['id'], ['user_id', 'role']],
};

/** Foreign-key actions on delete of a parent row that the RPCs and the retention purge exercise. */
const FK_ACTIONS: Readonly<Record<string, ReadonlyArray<{ table: string; column: string; action: 'set_null' | 'cascade' | 'restrict' }>>> = {
  agent_runs: [
    { table: 'agent_runs', column: 'parent_run_id', action: 'set_null' },
    { table: 'inbound_emails', column: 'agent_run_id', action: 'set_null' },
    { table: 'cad_jobs', column: 'requested_by_run_id', action: 'set_null' },
  ],
  inbound_emails: [{ table: 'rfqs', column: 'inbound_email_id', action: 'set_null' }],
  quote_workflows: [
    { table: 'inbound_emails', column: 'quote_workflow_id', action: 'set_null' },
    { table: 'cad_jobs', column: 'quote_workflow_id', action: 'set_null' },
  ],
  rfqs: [
    { table: 'rfq_files', column: 'rfq_id', action: 'cascade' },
    { table: 'quote_workflows', column: 'rfq_id', action: 'cascade' },
    { table: 'cad_jobs', column: 'rfq_id', action: 'cascade' },
    { table: 'inbound_emails', column: 'rfq_id', action: 'set_null' },
    { table: 'orders', column: 'rfq_id', action: 'set_null' },
  ],
  rfq_files: [{ table: 'cad_jobs', column: 'rfq_file_id', action: 'set_null' }],
  order_items: [{ table: 'stock_reservations', column: 'order_item_id', action: 'restrict' }],
  orders: [{ table: 'order_items', column: 'order_id', action: 'cascade' }],
  customers: [{ table: 'inbound_emails', column: 'customer_id', action: 'set_null' }],
  stock_transactions: [
    { table: 'stock_reservations', column: 'reserve_txn_id', action: 'set_null' },
    { table: 'stock_reservations', column: 'release_txn_id', action: 'set_null' },
  ],
};

// ---- write path ----------------------------------------------------------------------------------

/** The rows of a table (created empty when missing). */
export function rowsOf(tables: MemoryTableSet, table: string): MemoryRow[] {
  if (!Array.isArray(tables[table])) tables[table] = [];
  return tables[table];
}

const REV_STATE = new WeakMap<MemoryTableSet, number>();
/** Forgets the sequence values handed out for these tables (a fresh database after a reset). */
export function resetSequences(tables: MemoryTableSet): void {
  REV_STATE.delete(tables);
}
/** nextval('feature_flags_rev_seq'): above every rev present and every value handed out before. */
function nextRev(tables: MemoryTableSet): number {
  const present = rowsOf(tables, 'feature_flags').reduce((m, r) => Math.max(m, num(r.rev) || 0), 0);
  const next = Math.max(present, REV_STATE.get(tables) ?? 0) + 1;
  REV_STATE.set(tables, next);
  return next;
}

/** A row with the column defaults of its table filled in (a generated id included); no trigger, no check. */
export function withDefaults(table: string, row: MemoryRow, now: Date): MemoryRow {
  const spec = TABLE_SPECS[table];
  const base: MemoryRow = spec ? spec.defaults(now) : {};
  const out: MemoryRow = { ...base };
  if ((spec ? spec.id : true) && row.id === undefined) out.id = crypto.randomUUID();
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
  return out;
}

function rejectUnknownColumns(table: string, row: MemoryRow): void {
  const cols = TABLE_SPECS[table]?.columns;
  if (!cols) return;
  for (const k of Object.keys(row)) {
    if (!cols.includes(k)) throw new MemoryRpcError(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
  }
}

function applyScale(table: string, row: MemoryRow): void {
  const scale = TABLE_SPECS[table]?.scale;
  if (!scale) return;
  for (const [col, s] of Object.entries(scale)) {
    if (nn(row[col])) row[col] = decToNumber(decRound(toDec(row[col]), s));
  }
}

function beforeInsert(tables: MemoryTableSet, table: string, row: MemoryRow, now: Date): MemoryRow {
  if (table === 'feature_flags') {
    row.rev = nextRev(tables);
    row.created_at = iso(now);
    row.updated_at = iso(now);
  }
  if (table === 'stock_items') stockRemaining(row, true, now);
  return row;
}

function beforeUpdate(tables: MemoryTableSet, table: string, next: MemoryRow, prev: MemoryRow, now: Date): MemoryRow {
  if (table === 'feature_flags') {
    if (next.key !== prev.key || next.tenant_id !== prev.tenant_id) {
      throw new MemoryRpcError(403, '42501', 'feature_flags key and tenant_id are immutable');
    }
    const changed = next.enabled !== prev.enabled || !jsonEqual(next.value, prev.value);
    next.rev = changed ? nextRev(tables) : prev.rev;
    if (changed || (next.description ?? null) !== (prev.description ?? null) || (next.updated_by ?? null) !== (prev.updated_by ?? null)) {
      next.kv_seed_pending = false;
      next.updated_at = iso(now);
    } else {
      next.updated_at = prev.updated_at;
    }
    return next;
  }
  if (table === 'stock_items') stockRemaining(next, false, now);
  if (TABLE_SPECS[table]?.updatedAt) next.updated_at = iso(now);
  return next;
}

/** fn_stock_remaining() of stock_items. */
function stockRemaining(r: MemoryRow, insert: boolean, now: Date): void {
  if (nn(r.width_mm) && nn(r.height_mm) && (isNull(r.total_area_mm2) || insert)) r.total_area_mm2 = num(r.width_mm) * num(r.height_mm);
  if (insert) {
    if (isNull(r.remaining_area_mm2) && nn(r.total_area_mm2)) r.remaining_area_mm2 = r.total_area_mm2;
    if (isNull(r.remaining_quantity)) r.remaining_quantity = r.quantity;
  }
  if (nn(r.remaining_area_mm2) && num(r.remaining_area_mm2) <= 0) { r.status = 'depleted'; r.remaining_area_mm2 = 0; }
  if (nn(r.remaining_quantity) && num(r.remaining_quantity) <= 0) { r.status = 'depleted'; r.remaining_quantity = 0; }
  r.updated_at = iso(now);
}

function checkConstraints(table: string, row: MemoryRow): void {
  const spec = TABLE_SPECS[table];
  if (!spec) return;
  for (const col of spec.notNull) {
    if (isNull(row[col])) {
      throw new MemoryRpcError(400, '23502', `null value in column "${col}" of relation "${table}" violates not-null constraint`);
    }
  }
  for (const [name, ok] of spec.checks) {
    if (!ok(row)) throw new MemoryRpcError(400, '23514', `new row for relation "${table}" violates check constraint "${name}"`);
  }
}

const keyText = (k: unknown[]): string => JSON.stringify(k.map((x) => (isObject(x) || Array.isArray(x) ? jsonbOrder(x) : x)));

/** The unique index a row would violate (ignoring the row at `self`), or null. */
function uniqueViolation(tables: MemoryTableSet, table: string, row: MemoryRow, self: number): UniqueIndex | null {
  const spec = TABLE_SPECS[table];
  const indexes = spec ? spec.unique : nn(row.id) ? [pkey(table)] : [];
  const rows = rowsOf(tables, table);
  for (const ix of indexes) {
    const k = ix.key(row);
    if (k === null) continue;
    const kt = keyText(k);
    for (let i = 0; i < rows.length; i++) {
      if (i === self) continue;
      const other = ix.key(rows[i]);
      if (other !== null && keyText(other) === kt) return ix;
    }
  }
  return null;
}

function uniqueError(table: string, ix: UniqueIndex, row: MemoryRow): MemoryRpcError {
  const cols = ix.columns.length ? ix.columns : ['lower(email)'];
  const vals = ix.columns.map((c) => String(row[c] ?? ''));
  return new MemoryRpcError(409, '23505', `duplicate key value violates unique constraint "${ix.name}"`,
    `Key (${cols.join(', ')})=(${vals.join(', ')}) already exists.`);
}

/** INSERT of one row: defaults, BEFORE INSERT trigger, NOT NULL and CHECK constraints, unique keys. */
export function insertRow(tables: MemoryTableSet, table: string, row: MemoryRow, now: Date): MemoryRow {
  rejectUnknownColumns(table, row);
  const next = beforeInsert(tables, table, withDefaults(table, row, now), now);
  applyScale(table, next);
  checkConstraints(table, next);
  const ix = uniqueViolation(tables, table, next, -1);
  if (ix) throw uniqueError(table, ix, next);
  rowsOf(tables, table).push(next);
  return next;
}

/**
 * INSERT ... ON CONFLICT (onConflict) DO NOTHING (merge false) or DO UPDATE SET <the given columns> (merge true), as
 * PostgREST sends for resolution=ignore-duplicates / merge-duplicates. A conflict on another unique key is an error.
 */
export function upsertRow(
  tables: MemoryTableSet,
  table: string,
  row: MemoryRow,
  now: Date,
  o: { onConflict: readonly string[]; merge: boolean },
): { row: MemoryRow; inserted: boolean; updated: boolean } {
  rejectUnknownColumns(table, row);
  const next = beforeInsert(tables, table, withDefaults(table, row, now), now);
  applyScale(table, next);
  checkConstraints(table, next);
  const target = [...o.onConflict].sort().join(',');
  const spec = TABLE_SPECS[table];
  const indexes = spec ? spec.unique : [pkey(table)];
  const ix = indexes.find((i) => [...i.columns].sort().join(',') === target);
  if (!ix) {
    throw new MemoryRpcError(400, '42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
  }
  const k = ix.key(next);
  const rows = rowsOf(tables, table);
  const at = k === null ? -1 : rows.findIndex((r) => {
    const other = ix.key(r);
    return other !== null && keyText(other) === keyText(k);
  });
  if (at < 0) {
    const bad = uniqueViolation(tables, table, next, -1);
    if (bad) throw uniqueError(table, bad, next);
    rows.push(next);
    return { row: next, inserted: true, updated: false };
  }
  if (!o.merge) return { row: rows[at], inserted: false, updated: false };
  const patch: MemoryRow = {};
  for (const c of Object.keys(row)) patch[c] = next[c];
  return { row: updateRow(tables, table, at, patch, now), inserted: false, updated: true };
}

/** UPDATE of the row at `index`: BEFORE UPDATE trigger, constraints, unique keys. */
export function updateRow(tables: MemoryTableSet, table: string, index: number, patch: MemoryRow, now: Date): MemoryRow {
  rejectUnknownColumns(table, patch);
  const rows = rowsOf(tables, table);
  const prev = rows[index];
  const merged: MemoryRow = { ...prev };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
  const next = beforeUpdate(tables, table, merged, prev, now);
  applyScale(table, next);
  checkConstraints(table, next);
  const ix = uniqueViolation(tables, table, next, index);
  if (ix) throw uniqueError(table, ix, next);
  rows[index] = next;
  return next;
}

/** DELETE of the row at `index`, with the foreign-key actions of FK_ACTIONS. */
export function deleteRow(tables: MemoryTableSet, table: string, index: number, now: Date): MemoryRow {
  if (table === 'feature_flags') throw new MemoryRpcError(403, '42501', 'feature_flags rows are not deleted; set enabled = false instead');
  const rows = rowsOf(tables, table);
  const row = rows[index];
  for (const fk of FK_ACTIONS[table] ?? []) {
    const children = rowsOf(tables, fk.table);
    if (fk.action === 'restrict' && children.some((c) => c[fk.column] === row.id)) {
      throw new MemoryRpcError(409, '23503', `update or delete on table "${table}" violates foreign key constraint on table "${fk.table}"`);
    }
  }
  rows.splice(index, 1);
  for (const fk of FK_ACTIONS[table] ?? []) {
    const children = rowsOf(tables, fk.table);
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i][fk.column] !== row.id || isNull(row.id)) continue;
      if (fk.action === 'cascade') deleteRow(tables, fk.table, i, now);
      else if (fk.action === 'set_null') updateRow(tables, fk.table, i, { [fk.column]: null }, now);
    }
  }
  return row;
}

/** Existing data for a test: defaults filled in, no trigger and no check (feature_flags rows get a rev when missing). */
export function seedRows(tables: MemoryTableSet, table: string, rows: readonly MemoryRow[], now: Date): MemoryRow[] {
  const out = rows.map((r) => {
    const row = withDefaults(table, r, now);
    if (table === 'feature_flags' && r.rev === undefined) row.rev = nextRev(tables);
    if (table === 'stock_items') stockRemaining(row, true, now);
    applyScale(table, row);
    return row;
  });
  rowsOf(tables, table).push(...out);
  return out;
}

/** Runs fn as one transaction: on an exception every table is restored. */
export function atomically<T>(tables: MemoryTableSet, fn: () => T): T {
  const saved = new Map<string, MemoryRow[]>(Object.entries(tables).map(([k, v]) => [k, v.slice()]));
  try {
    return fn();
  } catch (e) {
    for (const k of Object.keys(tables)) {
      const before = saved.get(k);
      if (before === undefined) delete tables[k];
      else tables[k].splice(0, tables[k].length, ...before);
    }
    throw e;
  }
}

const sortBy = <T>(rows: T[], ...keys: Array<(r: T) => unknown>): T[] =>
  rows.sort((a, b) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const tx = toTime(x);
      const ty = toTime(y);
      if (tx !== null && ty !== null && typeof x === 'string' && typeof y === 'string' && /^\d{4}-\d\d-\d\dT/.test(x)) {
        if (tx !== ty) return tx - ty;
        continue;
      }
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });

const indexWhere = (tables: MemoryTableSet, table: string, pred: (r: MemoryRow) => boolean): number[] =>
  rowsOf(tables, table).flatMap((r, i) => (pred(r) ? [i] : []));

/** Index of the row with this id (the row was just read or written in the same call). */
function indexOfId(tables: MemoryTableSet, table: string, id: unknown): number {
  const i = rowsOf(tables, table).findIndex((r) => r.id === id);
  if (i < 0) throw new Error(`memory-rpc: ${table} row ${String(id)} vanished`);
  return i;
}

/** a IS DISTINCT FROM b for numbers and NULLs. */
const distinct = (a: unknown, b: unknown): boolean => (isNull(a) || isNull(b) ? isNull(a) !== isNull(b) : num(a) !== num(b));

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const copy = (r: MemoryRow): MemoryRow => ({ ...r });

// ---- feature flags --------------------------------------------------------------------------------

/** feature_flags_kv_key(): the flag key for the default tenant, 't:<tenant_id>:<key>' otherwise. */
export function flagKvKey(key: string | null, tenantId: string | null): string | null {
  if (key === null || tenantId === null) return null;
  return uuidCast(tenantId) === DEFAULT_TENANT_ID ? key : `t:${uuidCast(tenantId)}:${key}`;
}

/** feature_flags_kv_value(): the KV record of a flag (keys in jsonb order, as PostgREST returns it). */
export function flagKvValue(enabled: unknown, value: unknown, updatedAt: unknown, rev: unknown): Record<string, unknown> {
  const t = toTime(updatedAt);
  const out: Record<string, unknown> = {
    enabled: enabled === undefined ? null : enabled,
    value: value === undefined ? null : value,
    updated_at: t === null ? null : new Date(t).toISOString(),
    rev: rev === null || rev === undefined ? null : num(rev),
  };
  if (isObject(value) && 'mode' in value) out.mode = value.mode;
  return jsonbOrder(out);
}

function featureFlagsKvKey(_t: MemoryTableSet, a: Record<string, unknown>): unknown {
  return flagKvKey(str(a.p_key), str(a.p_tenant_id));
}

function featureFlagsKvValue(_t: MemoryTableSet, a: Record<string, unknown>): unknown {
  return flagKvValue(a.p_enabled, a.p_value, a.p_updated_at, a.p_rev);
}

function featureFlagsSyncBatch(tables: MemoryTableSet): unknown {
  const rows = rowsOf(tables, 'feature_flags').filter((r) => r.kv_seed_pending !== true && distinct(r.kv_synced_rev, r.rev));
  return sortBy(rows.slice(), (r) => r.tenant_id, (r) => r.key).map((r) => ({
    flag_key: r.key,
    flag_tenant_id: r.tenant_id,
    kv_key: flagKvKey(str(r.key), str(r.tenant_id)),
    kv_value: flagKvValue(r.enabled, r.value, r.updated_at, r.rev),
    rev: num(r.rev),
  }));
}

function featureFlagsMarkSynced(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const tenant = uuidCast(a.p_tenant_id);
  const hits = indexWhere(tables, 'feature_flags', (r) => r.key === a.p_key && r.tenant_id === tenant && nn(a.p_rev) && num(r.rev) === num(a.p_rev));
  for (const i of hits) updateRow(tables, 'feature_flags', i, { kv_synced_rev: num(a.p_rev), kv_synced_at: iso(now) }, now);
  return hits.length > 0;
}

function featureFlagsSeedFromKv(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const tenant = uuidCast(a.p_tenant_id);
  const [i] = indexWhere(tables, 'feature_flags', (r) => r.key === a.p_key && r.tenant_id === tenant);
  if (i === undefined) return 'not_pending';
  const row = rowsOf(tables, 'feature_flags')[i];
  if (row.kv_seed_pending !== true) return 'not_pending';
  const kv = a.p_kv;
  if (kv === null || kv === undefined) {
    updateRow(tables, 'feature_flags', i, { kv_seed_pending: false, kv_synced_rev: row.rev, kv_synced_at: iso(now) }, now);
    return 'absent';
  }
  // jsonb_typeof checks; a JSON null mode passes this test and then fails feature_flags_mode_check, as in SQL.
  if (!isObject(kv)
    || typeof kv.enabled !== 'boolean'
    || ('value' in kv && !isObject(kv.value))
    || ('mode' in kv && kv.mode !== null && !inList(kv.mode, FLAG_MODES))) {
    return 'invalid';
  }
  const fromKv: Record<string, unknown> = { ...(isObject(kv.value) ? kv.value : {}) };
  if ('mode' in kv) fromKv.mode = kv.mode;
  const merged = { ...(isObject(row.value) ? row.value : {}), ...fromKv };
  updateRow(tables, 'feature_flags', i, { enabled: kv.enabled, value: merged, kv_seed_pending: false }, now);
  return 'imported';
}

// ---- runs ----------------------------------------------------------------------------------------

function agentRunBegin(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const fields = a.p_fields === undefined ? {} : a.p_fields;
  const row: MemoryRow = {
    tenant_id: a.p_tenant_id === undefined ? DEFAULT_TENANT_ID : uuidCast(a.p_tenant_id),
    agent: str(a.p_agent),
    trigger: str(a.p_trigger),
    idempotency_key: str(a.p_idempotency_key),
    workflow_name: txt(fields, 'workflow_name'),
    workflow_instance_id: txt(fields, 'workflow_instance_id'),
    parent_run_id: uuidCast(txt(fields, 'parent_run_id')),
    subject_type: txt(fields, 'subject_type'),
    subject_id: uuidCast(txt(fields, 'subject_id')),
    prompt_version: txt(fields, 'prompt_version'),
  };
  const r = upsertRow(tables, 'agent_runs', row, now, { onConflict: ['agent', 'idempotency_key'], merge: false });
  return [{ run_id: r.row.id, created: r.inserted, run_status: r.inserted ? 'running' : r.row.status }];
}

function agentRunClaimApproval(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const hits = indexWhere(tables, 'agent_runs', (r) => nn(a.p_token_sha256) && r.approval_token_sha256 === a.p_token_sha256 && r.status === 'waiting_human');
  const action = a.p_human_action === null || a.p_human_action === undefined ? {} : a.p_human_action;
  return hits.map((i) => {
    const human = isObject(action) ? { ...action, decided_at: iso(now) } : action;
    const r = updateRow(tables, 'agent_runs', i, { approval_token_sha256: null, status: 'running', parked_reason: null, human_action: human }, now);
    return { run_id: r.id, agent: r.agent, workflow_name: r.workflow_name, workflow_instance_id: r.workflow_instance_id, output: r.output };
  });
}

// ---- e-mail RFQs ----------------------------------------------------------------------------------

/** create_public_rfq(p_payload) as called by the service role (auth.uid() is NULL). */
function createPublicRfq(tables: MemoryTableSet, p: unknown, now: Date): { id: string; rfq_number: string; customer_id: string | null } {
  const isOrder = txt(p, 'is_order') === null ? false : txt(p, 'is_order') === 'true';
  const prefix = isOrder ? 'ORD' : 'RFQ';
  const date = ddmmyyyy(now);
  const company = txt(p, 'company_name') === '' ? null : txt(p, 'company_name');
  const contactEmail = txt(p, 'contact_email') === '' ? null : txt(p, 'contact_email');
  if (company === null) raise('company_name is required');
  const matchEmail = contactEmail;
  let customerId: string | null = null;
  if (matchEmail !== null) {
    const candidates = rowsOf(tables, 'customers').filter((c) => typeof c.email === 'string' && c.email.toLowerCase() === matchEmail.toLowerCase());
    const first = sortBy(candidates.slice(), (c) => c.created_at)[0];
    if (first) customerId = String(first.id);
  }
  if (customerId === null && matchEmail !== null) {
    const first = txt(p, 'contact_first_name');
    const last = txt(p, 'contact_last_name');
    const contact = [first, last].filter((x) => x !== null).join(' ').trim();
    const c = insertRow(tables, 'customers', {
      user_id: null, email: matchEmail, first_name: first, last_name: last, contact_name: contact === '' ? null : contact,
      company_name: company, phone: txt(p, 'contact_phone'), mobile: txt(p, 'mobile'), vat_tax_id: txt(p, 'vat_id'),
      address: txt(p, 'address'), city: txt(p, 'city'), zip_code: txt(p, 'zip_code'), country: txt(p, 'country'),
      status: 'active', created_at: iso(now), updated_at: iso(now),
    }, now);
    customerId = String(c.id);
  }
  const re = new RegExp(`^${prefix}-${date}-(\\d+)$`);
  const seq = rowsOf(tables, 'rfqs').reduce((m, r) => {
    const hit = typeof r.rfq_number === 'string' ? re.exec(r.rfq_number) : null;
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0) + 1;
  const number = `${prefix}-${date}-${seq}`;
  const id = crypto.randomUUID();
  // COALESCE(p_payload->'parts', '[]'): only a missing key falls back; a JSON null or scalar is an error, as in SQL.
  const partsIn = isObject(p) && p.parts !== undefined ? p.parts : [];
  if (!Array.isArray(partsIn)) {
    throw new MemoryRpcError(400, '22023', `cannot extract elements from ${isObject(partsIn) ? 'an object' : 'a scalar'}`);
  }
  const parts = partsIn.map((part, k) => {
    if (!isObject(part)) throw new MemoryRpcError(400, '22023', 'cannot delete from scalar');
    const rest: Record<string, unknown> = { ...part };
    delete rest.rfq_id;
    delete rest.product_name;
    return jsonbOrder({ ...rest, rfq_id: id, product_name: `Part ${k + 1} ${number}-${k + 1}` });
  });
  const due = txt(p, 'due_date');
  insertRow(tables, 'rfqs', {
    id, title: `${number} - ${company}`, company_name: company, vat_id: txt(p, 'vat_id'), address: txt(p, 'address'),
    city: txt(p, 'city'), zip_code: txt(p, 'zip_code'), country: txt(p, 'country'), contact_first_name: txt(p, 'contact_first_name'),
    contact_last_name: txt(p, 'contact_last_name'), contact_position: txt(p, 'contact_position'), contact_email: txt(p, 'contact_email'),
    contact_phone: txt(p, 'contact_phone'), mobile: txt(p, 'mobile'), customer_id: customerId, status: isOrder ? 'approved' : 'draft',
    currency: 'EUR', due_date: due === null || due === '' ? iso(addMs(now, 7 * DAY_MS)) : iso(tsArg(due, 'due_date') as Date), version: 1,
    description: txt(p, 'description'), parts_details: parts, rfq_number: number,
  }, now);
  return { id, rfq_number: number, customer_id: customerId };
}

function createEmailRfq(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const source = str(a.p_source);
  if (source !== 'email' && source !== 'techpilot') raise(`create_email_rfq: source must be email or techpilot, got ${source ?? ''}`);
  const emailId = uuidCast(a.p_inbound_email_id);
  const [i] = indexWhere(tables, 'inbound_emails', (r) => r.id === emailId);
  if (i === undefined) raise(`create_email_rfq: inbound e-mail ${emailId ?? ''} not found`);
  const linked = rowsOf(tables, 'inbound_emails')[i].rfq_id;
  if (isNull(linked)) {
    const created = createPublicRfq(tables, a.p_payload, now);
    updateRow(tables, 'rfqs', indexOfId(tables, 'rfqs', created.id), { source, inbound_email_id: emailId }, now);
    updateRow(tables, 'inbound_emails', i, { rfq_id: created.id, customer_id: created.customer_id, status: 'rfq_created' }, now);
    return [{ rfq_id: created.id, rfq_number: created.rfq_number, customer_id: created.customer_id }];
  }
  const rfq = rowsOf(tables, 'rfqs').find((r) => r.id === linked);
  return [{ rfq_id: linked, rfq_number: rfq ? rfq.rfq_number ?? null : null, customer_id: rfq ? rfq.customer_id ?? null : null }];
}

// ---- stock -----------------------------------------------------------------------------------------

const activeHolds = (tables: MemoryTableSet, orderItemId: string | null, statuses: readonly string[]): MemoryRow[] =>
  sortBy(rowsOf(tables, 'stock_reservations').filter((r) => r.order_item_id === orderItemId && inList(r.status, statuses)).map(copy),
    (r) => r.created_at, (r) => r.id);

function stockHold(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const orderItemId = uuidCast(a.p_order_item_id);
  const materialId = uuidCast(a.p_material_id);
  const existing = activeHolds(tables, orderItemId, ACTIVE_HOLD);
  if (existing.length > 0) return existing;
  const expires = tsArg(a.p_expires_at, 'p_expires_at');
  if (expires === null || expires.getTime() <= now.getTime()) raise('stock_hold: expires_at must be in the future');
  const holds = a.p_holds;
  if (!Array.isArray(holds) || holds.length === 0) raise('stock_hold: holds must be a non-empty JSON array');
  const item = rowsOf(tables, 'order_items').find((r) => r.id === orderItemId);
  if (!item) raise(`stock_hold: order item ${orderItemId ?? ''} not found`);
  const orderId = (item as MemoryRow).order_id;
  const tenant = isNull((item as MemoryRow).tenant_id) ? DEFAULT_TENANT_ID : (item as MemoryRow).tenant_id;
  if (!rowsOf(tables, 'materials').some((m) => m.id === materialId)) raise(`stock_hold: material ${materialId ?? ''} not found`);
  for (const hold of holds as unknown[]) {
    const stockText = txt(hold, 'stock_item_id');
    const stock = stockText === null || stockText === '' ? null : uuidCast(stockText);
    const areaText = txt(hold, 'area_mm2');
    const qtyText = txt(hold, 'quantity');
    const area = areaText === null ? null : decToNumber(toDec(areaText));
    const qty = qtyText === null ? null : decToNumber(toDec(qtyText));
    if (stock !== null && !rowsOf(tables, 'stock_items').some((s) => s.id === stock && s.material_id === materialId)) {
      raise(`stock_hold: stock item ${stock} does not belong to material ${materialId ?? ''}`);
    }
    const res = insertRow(tables, 'stock_reservations', {
      tenant_id: tenant, order_item_id: orderItemId, order_id: orderId, material_id: materialId, stock_item_id: stock,
      area_mm2: area, quantity: qty, status: 'held', expires_at: iso(expires as Date), held_by: str(a.p_held_by),
    }, now);
    if (stock !== null) {
      const txn = insertRow(tables, 'stock_transactions', {
        tenant_id: tenant, stock_item_id: stock, transaction_type: 'reserve',
        area_change_mm2: area === null ? 0 : -area || 0, quantity_change: qty === null ? 0 : -qty || 0,
        reference_type: 'order_item', reference_id: orderItemId, notes: `stock_reservation ${String(res.id)}`,
      }, now);
      updateRow(tables, 'stock_reservations', indexOfId(tables, 'stock_reservations', res.id), { reserve_txn_id: txn.id }, now);
    }
  }
  return activeHolds(tables, orderItemId, ACTIVE_HOLD);
}

function stockCommit(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const orderItemId = uuidCast(a.p_order_item_id);
  const session = uuidCast(a.p_nesting_session_id);
  if (rowsOf(tables, 'stock_reservations').some((r) => r.order_item_id === orderItemId && r.status === 'committed' && (r.nesting_session_id ?? null) !== session)) {
    raise(`stock_commit: holds of order item ${orderItemId ?? ''} are committed to another nesting session`);
  }
  for (const i of indexWhere(tables, 'stock_reservations', (r) => r.order_item_id === orderItemId && r.status === 'held')) {
    updateRow(tables, 'stock_reservations', i, { status: 'committed', expires_at: null, nesting_session_id: session }, now);
  }
  return activeHolds(tables, orderItemId, ['committed']);
}

function stockRelease(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const orderItemId = uuidCast(a.p_order_item_id);
  const reason = str(a.p_reason);
  if (!inList(reason, RELEASE_REASONS)) raise(`stock_release: unknown reason ${reason ?? ''}`);
  const out: MemoryRow[] = [];
  for (const r of activeHolds(tables, orderItemId, ACTIVE_HOLD)) {
    let txnId: unknown = null;
    if (nn(r.stock_item_id)) {
      txnId = insertRow(tables, 'stock_transactions', {
        tenant_id: r.tenant_id, stock_item_id: r.stock_item_id, transaction_type: 'unreserve',
        area_change_mm2: isNull(r.area_mm2) ? 0 : num(r.area_mm2), quantity_change: isNull(r.quantity) ? 0 : num(r.quantity),
        reference_type: 'order_item', reference_id: orderItemId, notes: `stock_reservation ${String(r.id)} ${String(reason)}`,
      }, now).id;
    }
    out.push(copy(updateRow(tables, 'stock_reservations', indexOfId(tables, 'stock_reservations', r.id), {
      status: 'released', release_reason: reason, released_at: iso(now), expires_at: null, release_txn_id: txnId,
    }, now)));
  }
  return out;
}

// ---- retention -------------------------------------------------------------------------------------

function agentRetentionPurge(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const at = a.p_now === undefined ? now : tsArg(a.p_now, 'p_now');
  if (at === null) return { excerpts_cleared: 0, emails_deleted: 0, run_outputs_cleared: 0, runs_deleted: 0 };
  const before = (v: unknown, limit: Date): boolean => {
    const t = toTime(v);
    return t !== null && t < limit.getTime();
  };
  const open = ['running', 'waiting_human'];
  let emails = 0;
  for (const i of indexWhere(tables, 'inbound_emails', (r) => before(r.received_at, addMonths(at, -24))).reverse()) {
    deleteRow(tables, 'inbound_emails', i, now);
    emails++;
  }
  const excerpts = indexWhere(tables, 'inbound_emails', (r) => nn(r.body_excerpt) && before(r.received_at, addMs(at, -90 * DAY_MS)));
  for (const i of excerpts) updateRow(tables, 'inbound_emails', i, { body_excerpt: null }, now);
  let runs = 0;
  for (;;) {
    const [i] = indexWhere(tables, 'agent_runs', (r) => before(r.started_at, addMonths(at, -13)) && !inList(r.status, open));
    if (i === undefined) break;
    deleteRow(tables, 'agent_runs', i, now);
    runs++;
  }
  const outputs = indexWhere(tables, 'agent_runs', (r) => nn(r.output) && before(r.started_at, addMs(at, -90 * DAY_MS)) && !inList(r.status, open));
  for (const i of outputs) updateRow(tables, 'agent_runs', i, { output: null }, now);
  return jsonbOrder({ excerpts_cleared: excerpts.length, emails_deleted: emails, run_outputs_cleared: outputs.length, runs_deleted: runs });
}

// ---- orders (AM-4) and staff (AM-5) -----------------------------------------------------------------

/** next_po_number(): 'PO-<DDMMYYYY>-<n>' with n one above today's highest. */
function nextPoNumber(tables: MemoryTableSet, _a: Record<string, unknown>, now: Date): unknown {
  const date = ddmmyyyy(now);
  const re = new RegExp(`^PO-${date}-(\\d+)$`);
  const seq = rowsOf(tables, 'orders').reduce((m, o) => {
    const hit = typeof o.po_number === 'string' ? re.exec(o.po_number) : null;
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0) + 1;
  return `PO-${date}-${seq}`;
}

const VAT_FACTOR: Dec = { n: 124n, s: 2 };

function createOrderFromQuote(tables: MemoryTableSet, a: Record<string, unknown>, now: Date): unknown {
  const qwId = uuidCast(a.p_quote_workflow_id);
  const qw = rowsOf(tables, 'quote_workflows').find((r) => r.id === qwId);
  if (!qw) raise(`create_order_from_quote: quote workflow ${qwId ?? ''} not found`);
  const rfqId = (qw as MemoryRow).rfq_id;
  const rfq = rowsOf(tables, 'rfqs').find((r) => r.id === rfqId) ?? {};
  const rfqNo = typeof rfq.rfq_number === 'string' ? rfq.rfq_number : '';
  const existing = sortBy(rowsOf(tables, 'orders').filter((o) => o.rfq_id === rfqId && o.from_rfq_number === rfqNo).map(copy),
    (o) => o.created_at, (o) => o.id)[0];
  if (existing) return [{ order_id: existing.id, po_number: existing.po_number ?? null, created: false }];

  const parts = Array.isArray(rfq.parts_details) ? (rfq.parts_details as unknown[]) : [];
  const numericOrZero = (p: unknown, key: string): Dec => {
    const t = txt(p, key);
    return t === null || t === '' ? { n: 0n, s: 0 } : toDec(t);
  };
  const subtotal = parts.reduce<Dec>((sum, p) => decAdd(sum, numericOrZero(p, 'total_price')), { n: 0n, s: 0 });
  const shipping = isNull(rfq.shipping_cost) ? { n: 0n, s: 0 } : toDec(rfq.shipping_cost);
  const tenant = isNull(rfq.tenant_id) ? (qw as MemoryRow).tenant_id : rfq.tenant_id;
  const [ri] = indexWhere(tables, 'rfqs', (r) => r.id === rfqId);
  if (ri !== undefined) updateRow(tables, 'rfqs', ri, { status: 'approved' }, now);
  const po = nextPoNumber(tables, {}, now) as string;
  const currency = typeof rfq.currency === 'string' && rfq.currency !== '' ? rfq.currency : 'EUR';
  const order = insertRow(tables, 'orders', {
    customer_id: rfq.customer_id ?? null, rfq_id: rfqId, status: 'new',
    total_amount: decToNumber(decMul(decAdd(subtotal, shipping), VAT_FACTOR)), currency, title: po, po_number: po,
    from_rfq_number: rfqNo, start_date: iso(now), delivery_date: iso(addMs(now, 14 * DAY_MS)), tenant_id: tenant,
  }, now);
  for (const p of parts) {
    const pn = txt(p, 'product_name');
    const desc = txt(p, 'description');
    const q = txt(p, 'quantity');
    insertRow(tables, 'order_items', {
      order_id: order.id, product_name: pn ?? '', description: desc ?? '', quantity: intCast(q === '' ? null : q) ?? 0,
      unit_price: decToNumber(numericOrZero(p, 'unit_price')), total_price: decToNumber(numericOrZero(p, 'total_price')),
      tenant_id: tenant,
    }, now);
  }
  return [{ order_id: order.id, po_number: po, created: true }];
}

function agentStaffForEmail(tables: MemoryTableSet, a: Record<string, unknown>): unknown {
  const email = str(a.p_email);
  if (email === null) return [];
  const users = rowsOf(tables, 'auth.users').filter((u) => typeof u.email === 'string' && u.email.toLowerCase() === email.toLowerCase());
  const out: Array<{ user_id: unknown; roles: string[] }> = [];
  for (const u of sortBy(users.slice(), (x) => x.id)) {
    const roles = rowsOf(tables, 'user_roles').filter((r) => r.user_id === u.id && inList(r.role, STAFF_ROLES)).map((r) => String(r.role)).sort();
    if (roles.length > 0) out.push({ user_id: u.id, roles });
  }
  return out;
}

// ---- registry ----------------------------------------------------------------------------------------

const RAW_RPCS: Record<string, MemoryRpcFn> = {
  feature_flags_kv_key: featureFlagsKvKey,
  feature_flags_kv_value: featureFlagsKvValue,
  feature_flags_sync_batch: featureFlagsSyncBatch,
  feature_flags_mark_synced: featureFlagsMarkSynced,
  feature_flags_seed_from_kv: featureFlagsSeedFromKv,
  create_email_rfq: createEmailRfq,
  agent_run_begin: agentRunBegin,
  agent_run_claim_approval: agentRunClaimApproval,
  stock_hold: stockHold,
  stock_commit: stockCommit,
  stock_release: stockRelease,
  agent_retention_purge: agentRetentionPurge,
  create_order_from_quote: createOrderFromQuote,
  agent_staff_for_email: agentStaffForEmail,
  next_po_number: nextPoNumber,
};

/** RPC name -> implementation; each call is atomic (see the rules at the top). */
export const MEMORY_RPCS: Readonly<Record<string, MemoryRpcFn>> = Object.freeze(Object.fromEntries(
  Object.entries(RAW_RPCS).map(([name, fn]) => [name, (tables: MemoryTableSet, args: Record<string, unknown>, now: Date) =>
    atomically(tables, () => fn(tables, args ?? {}, now))]),
));

/** RPCs that return a scalar or jsonb value (the others return rows). */
export const SCALAR_RPCS: readonly string[] = ['feature_flags_kv_key', 'feature_flags_kv_value', 'feature_flags_mark_synced',
  'feature_flags_seed_from_kv', 'agent_retention_purge', 'next_po_number'];

/** Calls one RPC by name (PGRST202 when there is no such function). */
export function callRpc(tables: MemoryTableSet, name: string, args: Record<string, unknown>, now: Date): unknown {
  const fn = MEMORY_RPCS[name];
  if (!fn) throw new MemoryRpcError(404, 'PGRST202', `Could not find the function public.${name} in the schema cache`);
  return fn(tables, args, now);
}

// ---- the migration's flag seed ------------------------------------------------------------------------

/**
 * The rows of the migration's `INSERT INTO public.feature_flags (key, enabled, value, description, kv_seed_pending)`
 * statement, for tests that start from the state the migration leaves.
 */
export function seededFlagsFromMigration(sql: string): MemoryRow[] {
  const start = sql.search(/^INSERT INTO public\.feature_flags \(key, enabled, value, description, kv_seed_pending\) VALUES/m);
  if (start < 0) throw new Error('no feature_flags seed INSERT in the migration');
  const end = sql.indexOf(';\n', start);
  const body = sql.slice(start, end);
  const rows: MemoryRow[] = [];
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*\)/g;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    const unq = (s: string): string => s.replace(/''/g, "'");
    rows.push({ key: unq(m[1]), enabled: m[2] === 'true', value: JSON.parse(unq(m[3])), description: unq(m[4]), kv_seed_pending: m[5] === 'true' });
  }
  return rows;
}

export default MEMORY_RPCS;
